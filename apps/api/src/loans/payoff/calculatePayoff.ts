import { ConceptCategory } from '../../interestConceptTypes/entities/interestConceptType.entity';
import {
  calculateDaysUntilDue,
  calculateMoratoryCharges,
  calculateOverdueDays,
  MoratoryConceptAssignment,
} from '../installments/installmentCalculations';

import type { ConceptBreakdownItem } from '../installments/enrichInstallment';

export interface PayoffInstallmentInput {
  installmentId: string;
  installmentNumber: number;
  amount: number;
  // Nullable for installments predating Phase 14 (no capital/interest
  // split) — treated as fully principal in that legacy case, same fallback
  // used elsewhere for this column.
  principalPortion: number | null;
  dueDate: string;
  // Phase 23 — moratory concepts assigned to this installment. Every loan
  // created through LoansService.create()/refinance() always has at
  // least one (see enrichInstallment.ts's own note) — empty here just
  // means zero moratory interest for that installment, same as
  // calculateMoratoryCharges's own behavior for an empty array.
  moratoryConcepts: MoratoryConceptAssignment[];
  // Style cleanup, 2026-09-04 (client feedback — the payoff dialog's table
  // was "too simple", no per-cargo detail) — the corriente (Phase 14)
  // charges already stored on this installment at schedule-generation
  // time (LoanInstallmentConcept rows, category Corriente), pre-computed
  // (`computedAmount`), same values enrichInstallment.ts reads for its own
  // `corrienteBreakdown`. Purely descriptive: interestApplied below is
  // still derived from `amount - principalPortion` exactly as before, NOT
  // recomputed from this list, so this addition cannot change any actual
  // charged amount — only what the quote can additionally display.
  // Defaults to [] for the (now legacy) case of a caller not passing it.
  corrienteConcepts?: { name: string; amount: number }[];
  // Bug fix, 2026-09-15 (human report) — how much has already been paid
  // toward this Pending installment (see sumPaymentsByInstallmentId).
  // Before this, a quote/payoff/refinance-suggestion recharged an
  // installment's full nominal cost even when a prior PARTIAL payment
  // already existed on it — the same class of bug as préstamo #0920's
  // overcharge, in this function's own separate code path (see
  // docs/DATABASE.md's "Known gap, flagged 2026-09-07" note). Netted
  // interest-first, then principal, per Art. 1653 — the same imputación
  // rule this file's own header comment already invokes for how a FRESH
  // payoff payment gets split. Defaults to 0.
  totalPaid?: number;
}

export interface PayoffInstallmentBreakdown {
  installmentId: string;
  installmentNumber: number;
  interestApplied: number;
  principalApplied: number;
  totalDue: number;
  // Style cleanup, 2026-09-04 — per-cargo detail for the payoff dialog's
  // table, mirroring enrichInstallment.ts's ConceptBreakdownItem exactly
  // (same name/amount/category shape, same Corriente-stored/
  // Moratorio-computed-live split). Empty for a not-yet-matured
  // installment: nothing is owed yet, so there is nothing to itemize.
  conceptBreakdown: ConceptBreakdownItem[];
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
  today: Date = new Date(),
  options: CalculatePayoffOptions = {},
): PayoffQuote {
  const breakdown = installments.map((installment) =>
    calculateInstallmentPayoff(installment, today, options),
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
  today: Date,
  options: CalculatePayoffOptions,
): PayoffInstallmentBreakdown {
  const principalPortion = installment.principalPortion ?? installment.amount;
  const totalPaid = installment.totalPaid ?? 0;

  const dueDate = new Date(installment.dueDate);
  // 0 once the due date is today or has already passed — same "matured"
  // check calculateOverdueDays itself effectively uses, kept consistent
  // with the codebase's existing timezone-safe date-diff engine rather
  // than a fresh Date comparison (see installmentCalculations.ts's own
  // note on computing whole Bogotá calendar days — bug fixed 2026-09-04,
  // see that file and docs/DATABASE.md's note of that date). With the
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
    // Bug fix, 2026-09-15 — a not-yet-due installment can still carry a
    // prior payment (an eager/ahead-of-schedule abono); nets straight off
    // principal since there's no interest here to absorb it first (none
    // has accrued on an installment that isn't even due yet).
    const principalApplied = Math.max(0, principalPortion - totalPaid);
    return {
      installmentId: installment.installmentId,
      installmentNumber: installment.installmentNumber,
      interestApplied: 0,
      principalApplied,
      totalDue: principalApplied,
      conceptBreakdown: [],
    };
  }

  const conceptsInterest = installment.amount - principalPortion;
  const overdueDays = calculateOverdueDays(dueDate, today);
  const moratoryChargeItems = calculateMoratoryCharges(
    installment.amount,
    overdueDays,
    installment.moratoryConcepts,
  );
  const moratoryInterest = moratoryChargeItems.reduce(
    (sum, item) => sum + item.amount,
    0,
  );
  const grossInterest = conceptsInterest + moratoryInterest;

  const conceptBreakdown: ConceptBreakdownItem[] = [
    ...(installment.corrienteConcepts ?? []).map((concept) => ({
      name: concept.name,
      amount: concept.amount,
      category: ConceptCategory.Corriente,
    })),
    ...moratoryChargeItems.map((item) => ({
      ...item,
      category: ConceptCategory.Moratorio,
    })),
  ];

  // Bug fix, 2026-09-15 — see PayoffInstallmentInput.totalPaid's own
  // comment. A prior payment already collected on this installment
  // settles its interest before touching principal (Art. 1653), so it's
  // subtracted from grossInterest first; only whatever's left over after
  // that reduces principal.
  const interestApplied = Math.max(0, grossInterest - totalPaid);
  const principalCoveredByPriorPayment = Math.max(0, totalPaid - grossInterest);
  const principalApplied = Math.max(
    0,
    principalPortion - principalCoveredByPriorPayment,
  );

  return {
    installmentId: installment.installmentId,
    installmentNumber: installment.installmentNumber,
    interestApplied,
    principalApplied,
    totalDue: interestApplied + principalApplied,
    conceptBreakdown,
  };
}
