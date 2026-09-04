import {
  calculateDaysUntilDue,
  calculateInterest,
  calculateMoratoryCharges,
  calculateOverdueDays,
  MoratoryConceptAssignment,
} from '../installments/installmentCalculations';

export interface PayoffInstallmentInput {
  installmentId: string;
  installmentNumber: number;
  amount: number;
  // Nullable for installments predating Phase 14 (no capital/interest
  // split) — treated as fully principal in that legacy case, same fallback
  // used elsewhere for this column.
  principalPortion: number | null;
  dueDate: string;
  // Phase 23 — moratory concepts assigned to this installment, if any.
  // Empty means the loan predates Phase 23 (or was never given any),
  // falling back to the legacy interestRate formula below — kept
  // consistent with enrichInstallment.ts's identical fallback rule, so a
  // payoff quote never disagrees with what the installment view shows.
  moratoryConcepts: MoratoryConceptAssignment[];
}

export interface PayoffInstallmentBreakdown {
  installmentId: string;
  installmentNumber: number;
  interestApplied: number;
  principalApplied: number;
  totalDue: number;
}

export interface PayoffQuote {
  installments: PayoffInstallmentBreakdown[];
  totalInterestOwed: number;
  totalPrincipalOwed: number;
  totalDue: number;
}

export interface CalculatePayoffOptions {
  // Phase 25 — LoansService.getRefinanceQuote() passes 5 here so an
  // installment due within the next 5 days (not yet actually overdue) is
  // also folded into the new principal, per the confirmed rule (reunión
  // 2026-08-25): "de la cuarta cuota entran los intereses al capital
  // también, así no haya llegado a su fecha de vencimiento como tal."
  // Deliberately NOT the same "5 días" as MessageTemplate's
  // upcomingDueReminderDays (Phase 9) — that only ever triggers a WhatsApp
  // message and has no bearing on money; confirmed with the human this is
  // a separate, refinance-only rule after an initial mix-up between the
  // two. Defaults to 0 (today-or-past only), which is byte-for-byte the
  // original Phase 16 payoff-quote behavior — every other caller of this
  // function (the actual early-payoff endpoint) must keep omitting this
  // option so a real payoff quote is never inflated by not-yet-due cuotas.
  earlyMaturityWindowDays?: number;
}

// Colombian Civil Code Art. 1653 ("imputación del pago a intereses"): a
// payment settles interest owed before principal, and a client can never be
// forced to pay interest that hasn't been caused yet. Confirmed with the
// human (docs/phases/PHASE_16_EARLY_PAYOFF.md "Resolved") for this
// project's specifics:
//   - "Interest" = moratory interest + every Phase 14 concept baked into an
//     installment's `amount` (everything above `principalPortion`) — not
//     just moratory interest alone.
//   - A not-yet-due installment contributes only its principalPortion, at
//     face value, with ZERO interest — no moratory interest (none has
//     accrued) and no concept charges either (they cover a period that
//     hasn't happened yet). This is still true even inside the
//     `earlyMaturityWindowDays` window below — see that option's own
//     comment for why only the concept/corriente portion is added there.
//   - A matured installment (due today or already overdue) contributes its
//     full concept charges plus any moratory interest, in addition to its
//     principal.
//   - The "cuota inicial" (down payment) is installment #1 like any other
//     when a loan has one (see Installment.isDownPayment) — it's
//     interest-free by construction (no concepts assigned to it), so it
//     naturally contributes only its own principalPortion here once
//     matured, same as every other installment. No special-casing needed.
//   - Allocation across multiple installments is interest-globally-then-
//     principal-globally, not a per-installment waterfall — see the phase
//     doc's "Resolved" point 2 for why this doesn't change the numbers
//     within this phase's own full-payoff-only scope, but matters for
//     Phase 17's reuse of this function.
export function calculatePayoff(
  installments: PayoffInstallmentInput[],
  interestRate: number,
  today: Date = new Date(),
  options: CalculatePayoffOptions = {},
): PayoffQuote {
  const breakdown = installments.map((installment) =>
    calculateInstallmentPayoff(installment, interestRate, today, options),
  );

  const totalInterestOwed = breakdown.reduce(
    (sum, item) => sum + item.interestApplied,
    0,
  );
  const totalPrincipalOwed = breakdown.reduce(
    (sum, item) => sum + item.principalApplied,
    0,
  );

  return {
    installments: breakdown,
    totalInterestOwed,
    totalPrincipalOwed,
    totalDue: totalInterestOwed + totalPrincipalOwed,
  };
}

function calculateInstallmentPayoff(
  installment: PayoffInstallmentInput,
  interestRate: number,
  today: Date,
  options: CalculatePayoffOptions,
): PayoffInstallmentBreakdown {
  const principalPortion = installment.principalPortion ?? installment.amount;

  const dueDate = new Date(installment.dueDate);
  // 0 once the due date is today or has already passed — same "matured"
  // check calculateOverdueDays itself effectively uses, kept consistent
  // with the codebase's existing timezone-safe date-diff engine rather
  // than a fresh Date comparison (see installmentCalculations.ts's own
  // note on differenceInDays vs differenceInCalendarDays). With the
  // default earlyMaturityWindowDays of 0, this is exactly the original
  // Phase 16 check (daysUntilDue === 0). A non-zero window (Phase 25)
  // widens "matured" to include a not-yet-due installment within that many
  // days — calculateOverdueDays still correctly returns 0 for it below, so
  // its moratory interest comes out to 0 naturally, with no extra branching
  // needed to keep this rule "corriente only."
  const hasMatured =
    calculateDaysUntilDue(dueDate, today) <=
    (options.earlyMaturityWindowDays ?? 0);

  if (!hasMatured) {
    return {
      installmentId: installment.installmentId,
      installmentNumber: installment.installmentNumber,
      interestApplied: 0,
      principalApplied: principalPortion,
      totalDue: principalPortion,
    };
  }

  const conceptsInterest = installment.amount - principalPortion;
  const overdueDays = calculateOverdueDays(dueDate, today);
  const moratoryInterest =
    installment.moratoryConcepts.length > 0
      ? calculateMoratoryCharges(
          installment.amount,
          overdueDays,
          installment.moratoryConcepts,
        ).reduce((sum, item) => sum + item.amount, 0)
      : calculateInterest(installment.amount, interestRate, overdueDays);
  const interestApplied = conceptsInterest + moratoryInterest;

  return {
    installmentId: installment.installmentId,
    installmentNumber: installment.installmentNumber,
    interestApplied,
    principalApplied: principalPortion,
    totalDue: interestApplied + principalPortion,
  };
}
