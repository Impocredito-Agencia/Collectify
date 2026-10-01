import { ConceptCategory } from '../../interestConceptTypes/entities/interestConceptType.entity';
import {
  calculateDaysUntilDue,
  calculateMoratoryCharges,
  calculateOverdueDays,
  calculateTotalDue,
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
  // Human correction, 2026-09-30 — when this installment's period began:
  // the previous installment's own dueDate, or the loan's disbursedAt for
  // the very first installment on the loan. Anchors
  // CalculatePayoffOptions.interestAccrualGraceDays — see that option's
  // own comment. Irrelevant (any value works) when that option is
  // omitted, since maturity then falls back to dueDate alone.
  periodStartDate: string;
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
  // The part of the interest true-up (see calculateInterestTrueUp.ts) that
  // could NOT be placed inside a pending installment's own row — it comes
  // from installments already paid. Already included in
  // totalInterestOwed/totalDue. 0 when not supplied.
  interestTrueUp: number;
  totalInterestOwed: number;
  totalPrincipalOwed: number;
  totalDue: number;
}

export interface CalculatePayoffOptions {
  // Phase 25 (reunión 2026-08-25), corrected 2026-09-30 (human correction —
  // see loans.service.ts's INTEREST_ACCRUAL_GRACE_DAYS for the full story).
  // Originally implemented — wrongly — as a window counting backward from
  // dueDate ("matured once due within the next N days"), which left a cliff
  // at N+1 days out where an installment still owed zero interest: paying
  // off 6 days before a cuota fell due skipped that cuota's interest
  // entirely, exactly the loophole this option exists to close. The
  // confirmed rule instead counts FORWARD from when the installment's
  // period started (see PayoffInstallmentInput.periodStartDate): once this
  // many days have passed since then, its corriente interest is treated as
  // fully caused even though the cuota itself isn't due for possibly
  // weeks — only the first `interestAccrualGraceDays` days of each period
  // are free of interest. Moratory interest is untouched either way — it
  // still only starts once the cuota is genuinely overdue (dueDate-based,
  // see calculateInstallmentPayoff below).
  //
  // Both LoansService.getRefinanceQuote() and the real early-payoff routes
  // (getPayoffQuote()/payoff()) pass the same LoansService
  // INTEREST_ACCRUAL_GRACE_DAYS, so closing a loan the same day never costs
  // different interest depending on which route is used. Omitted entirely
  // (not 0 — 0 would make every installment matured from the first instant
  // of its period, which is never what's wanted), maturity falls back to
  // dueDate alone — the original Phase 16 rule, still always in effect on
  // top of whatever this option adds.
  interestAccrualGraceDays?: number;
  // Computed by the caller from the loan's FULL installment list (this
  // function only ever sees the pending ones) via calculateInterestTrueUp.
  // Added on top of the per-installment interest. Defaults to 0.
  interestTrueUp?: number;
  // Optional: the share of the true-up that belongs to specific pending,
  // matured installments (keyed by installmentNumber). It is added to that
  // row's interestApplied/totalDue and listed in its conceptBreakdown, so
  // the table rows add up to the quote total. NOT added on top of
  // `interestTrueUp` — callers pass only the unattributed remainder there
  // (see calculateInterestTrueUpBreakdown).
  interestTrueUpByInstallment?: Map<number, number>;
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
//     hasn't happened yet). This is still true even once
//     `interestAccrualGraceDays` below has elapsed since the period
//     started — see that option's own comment for why only the
//     concept/corriente portion is added there.
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
  const attributed = options.interestTrueUpByInstallment;
  const breakdown = installments.map((installment) => {
    const item = calculateInstallmentPayoff(installment, today, options);
    const adjustment = attributed?.get(installment.installmentNumber) ?? 0;
    return adjustment === 0 ? item : withTrueUpAdjustment(item, adjustment);
  });

  const interestTrueUp = options.interestTrueUp ?? 0;
  const totalInterestOwed =
    breakdown.reduce((sum, item) => sum + item.interestApplied, 0) +
    interestTrueUp;
  const totalPrincipalOwed = breakdown.reduce(
    (sum, item) => sum + item.principalApplied,
    0,
  );

  return {
    installments: breakdown,
    interestTrueUp,
    totalInterestOwed,
    totalPrincipalOwed,
    totalDue: totalInterestOwed + totalPrincipalOwed,
  };
}

function withTrueUpAdjustment(
  item: PayoffInstallmentBreakdown,
  adjustment: number,
): PayoffInstallmentBreakdown {
  const interestApplied = Math.max(0, item.interestApplied + adjustment);
  return {
    ...item,
    interestApplied,
    totalDue: interestApplied + item.principalApplied,
    conceptBreakdown: [
      ...item.conceptBreakdown,
      {
        name: 'Ajuste de interés causado',
        amount: adjustment,
        category: ConceptCategory.Corriente,
      },
    ],
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
  // The original Phase 16 rule: matured once the due date is today or has
  // already passed. calculateDaysUntilDue floors at 0, so "=== 0" covers
  // both "due today" and "overdue" in one check — same timezone-safe
  // Bogotá-calendar-day engine used throughout this file rather than a
  // fresh Date comparison (see installmentCalculations.ts's own note, bug
  // fixed 2026-09-04, and docs/DATABASE.md's note of that date). Always in
  // effect, regardless of interestAccrualGraceDays below.
  const dueDateReached = calculateDaysUntilDue(dueDate, today) === 0;
  // Human correction, 2026-09-30 — see CalculatePayoffOptions.
  // interestAccrualGraceDays's own comment for the full story: counts
  // forward from the period's start, not backward from dueDate. Omitted
  // entirely (not 0), this never fires and hasMatured falls back to
  // dueDateReached alone.
  const graceDays = options.interestAccrualGraceDays;
  const maturedByGrace =
    graceDays !== undefined &&
    calculateOverdueDays(new Date(installment.periodStartDate), today) >=
      graceDays;
  const hasMatured = dueDateReached || maturedByGrace;

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

  // Bug fix, 2026-09-15 — rounds the gross total to the nearest $100, the
  // exact same call (same inputs: installment.amount, moratoryInterest)
  // enrichInstallment.ts's own totalDue already uses — without this, a
  // payoff quote and the loan detail view disagreed on this installment's
  // total by however much that rounding moved it (human report).
  //
  // Changed, 2026-09-23 (human report: two loans with nothing paid showed a
  // "saldo capital a la fecha" of 999.994 / 999.983 instead of 1.000.000) —
  // that rounding delta (±$50 per matured installment) used to be absorbed
  // by PRINCIPAL. It now lands on INTEREST instead, so principalApplied is
  // always the real remaining capital while totalDue stays exactly the same.
  const roundedGrossTotal = calculateTotalDue(
    installment.amount,
    moratoryInterest,
  );
  const roundedGrossPrincipal = roundedGrossTotal - grossInterest;

  // Bug fix, 2026-09-15 — see PayoffInstallmentInput.totalPaid's own
  // comment. A prior payment already collected on this installment
  // settles its interest before touching principal (Art. 1653), so it's
  // subtracted from grossInterest first; only whatever's left over after
  // that reduces principal.
  const interestBeforeRedistribution = Math.max(0, grossInterest - totalPaid);
  const principalCoveredByPriorPayment = Math.max(0, totalPaid - grossInterest);
  const totalDue =
    interestBeforeRedistribution +
    Math.max(0, roundedGrossPrincipal - principalCoveredByPriorPayment);

  const principalApplied = Math.min(
    totalDue,
    Math.max(0, principalPortion - principalCoveredByPriorPayment),
  );
  const interestApplied = totalDue - principalApplied;

  return {
    installmentId: installment.installmentId,
    installmentNumber: installment.installmentNumber,
    interestApplied,
    principalApplied,
    totalDue,
    conceptBreakdown,
  };
}
