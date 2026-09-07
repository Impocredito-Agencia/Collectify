// Shared by InterestConceptTypesService and LoansService (2026-09-06,
// human request) — both need to cap how many decimal places a value can
// carry DIFFERENTLY depending on a sibling field (calculationType):
// percentage concepts can go to 4 decimals (see WidenConceptValuePrecision
// migration and InterestConceptType.defaultValue's own comment), a
// fixed_amount concept — a plain currency figure, no legitimate use for
// more — stays capped at 2. That's a cross-field rule a single-property
// class-validator decorator can't express cleanly (same reasoning already
// used elsewhere in this codebase for cross-field checks, e.g.
// LoansService.assertCoDebtorIsValid/assertDownPaymentIsValid), so it's
// enforced here in the service layer instead of on the DTOs.
//
// Counts digits after the decimal point in the value's own string form —
// the same approach class-validator's own IsNumber({ maxDecimalPlaces })
// option uses internally, so behavior stays consistent with how a plain
// numeric field would otherwise validate.
export function countDecimalPlaces(value: number): number {
  const asString = value.toString();
  // Guard against scientific notation (e.g. 1e-7) — no legitimate concept
  // value should ever be that small, so treat it as "too many decimals"
  // rather than mis-parsing the exponent as part of the fractional part.
  if (asString.includes('e') || asString.includes('E')) {
    return Number.POSITIVE_INFINITY;
  }
  const dotIndex = asString.indexOf('.');
  return dotIndex === -1 ? 0 : asString.length - dotIndex - 1;
}
