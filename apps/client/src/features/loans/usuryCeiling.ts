// Redesign, 2026-09-03 — "editable solo hacia abajo": corrienteInterestRate/
// moratoryInterestRate can be at or below the current usury ceiling, never
// above it. Mirrors the backend's assertInterestRateWithinCeiling
// (loans.service.ts). Shared by LoanForm and RefinanceLoanForm so both
// surface the same client-side error before hitting the API. Same EPSILON
// as the backend, to absorb float rounding from the annual→monthly
// conversion (docs/GLOSSARY.md "Tasa de usura").
const EPSILON = 0.0001;

export function exceedsUsuryCeiling(
  value: number | '',
  ceiling: number,
): boolean {
  return typeof value === 'number' && value > ceiling + EPSILON;
}

// Human request, 2026-09-30 (paraphrased) — the client wants the corriente/
// moratorio fields to start at a round, whole-number rate instead of the
// usury ceiling's own decimal figure (e.g. 2.1176%), so creating or
// refinancing a loan doesn't mean typing extra-charge math with decimals.
// Still fully editable afterward, up to the ceiling or down to 0 — this
// only changes the starting value. Math.min, not a conditional: it can
// never return more than `ceiling` by definition, so on a month where the
// certified rate itself lands below 2% this quietly falls back to that
// lower, real ceiling instead of overshooting it — the same guarantee the
// backend's identical default enforces (DEFAULT_INTEREST_RATE_PERCENTAGE in
// loans.service.ts), kept here only so the field starts already matching
// what submitting the form blank would resolve to.
const DEFAULT_INTEREST_RATE_PERCENTAGE = 2;

export function defaultInterestRate(ceiling: number): number {
  return Math.min(DEFAULT_INTEREST_RATE_PERCENTAGE, ceiling);
}
