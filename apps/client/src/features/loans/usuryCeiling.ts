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
