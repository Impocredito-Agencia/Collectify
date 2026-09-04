// Feature request, 2026-09-03 — mirrors
// apps/api/src/usuryRates/convertAnnualToMonthlyRate.ts EXACTLY (same
// compounding formula, same 4-decimal rounding). Used ONLY for an instant
// live preview in UsuryRatesPage.tsx as the admin types the annual rate —
// the value that actually gets persisted always comes from the API's own
// computation in UsuryRateService.setRate, never from this. If the backend
// formula ever changes, update this one to match or the preview will
// disagree with what gets saved.
export function convertAnnualToMonthlyRate(
  annualRatePercentage: number,
): number {
  const annualDecimal = annualRatePercentage / 100;
  const monthlyDecimal = Math.pow(1 + annualDecimal, 1 / 12) - 1;
  const monthlyPercentage = monthlyDecimal * 100;
  return Math.round(monthlyPercentage * 10000) / 10000;
}
