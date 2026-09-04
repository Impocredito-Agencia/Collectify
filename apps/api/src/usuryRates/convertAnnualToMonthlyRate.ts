// Feature request, 2026-09-03 (human) — converts the Superintendencia
// Financiera's published ANNUAL effective rate ("interés bancario
// corriente", certified monthly for crédito de consumo y ordinario — see
// https://www.superfinanciera.gov.co/publicaciones/10829/sala-de-prensacomunicados-de-prensa-interes-bancario-corriente-10829/)
// into the equivalent MONTHLY effective rate, using the standard compounding
// conversion the Superintendencia itself publishes for going between
// periodic effective rates: monthly = (1 + annual)^(1/12) - 1.
//
// Verified against a real example the human provided: 29.24% annual → the
// Superintendencia's own monthly-conversion page gives 2.1605% monthly.
// This formula reproduces that to 4 decimal places (2.16051%, rounds to
// 2.1605%).
//
// Pulled out as its own pure function (rather than inlined in the service)
// so it's directly unit-testable and reusable if another surface ever needs
// the same conversion — e.g. a live preview before the admin submits the
// form. The frontend's LIVE preview (UsuryRatesPage.tsx) intentionally
// re-implements this same one-line formula client-side purely for instant
// feedback as the admin types — it is NOT the value that gets persisted;
// the actual stored monthlyRatePercentage always comes from this function,
// run server-side, in UsuryRateService.setRate.
export function convertAnnualToMonthlyRate(
  annualRatePercentage: number,
): number {
  const annualDecimal = annualRatePercentage / 100;
  const monthlyDecimal = Math.pow(1 + annualDecimal, 1 / 12) - 1;
  const monthlyPercentage = monthlyDecimal * 100;
  // Round to 4 decimal places — matches rate_percentage's decimal(7,4)
  // column and the Superintendencia's own published precision (e.g.
  // "2.1605%", not "2.16%" or "2.16051%").
  return Math.round(monthlyPercentage * 10000) / 10000;
}
