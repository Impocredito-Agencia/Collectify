// Extracted 2026-09-15 from loans.service.ts (unchanged behavior) so the
// overdue-installments Excel report can sort by pagaré the same
// numeric-aware way the "Préstamos" list already does — promissoryNoteNumber
// is free text (e.g. "#743"), so a plain text sort would put "101" before
// "2".

// Mirrors NULLIF(regexp_replace(promissory_note_number, '\D', '', 'g'),
// '')::bigint from the previous SQL-level sort: strip everything but
// digits, null when nothing's left. BigInt (not parseInt) to match
// Postgres's bigint precision for unusually long numbers.
export function extractNumericPart(
  promissoryNoteNumber: string,
): bigint | null {
  const digits = promissoryNoteNumber.replace(/\D/g, '');
  return digits === '' ? null : BigInt(digits);
}

// NULLS LAST for the numeric part, then a plain text compare as the
// tiebreaker.
export function comparePromissoryNoteNumbers(a: string, b: string): number {
  const numericA = extractNumericPart(a);
  const numericB = extractNumericPart(b);

  if (numericA === null && numericB !== null) {
    return 1;
  }
  if (numericA !== null && numericB === null) {
    return -1;
  }
  if (numericA !== null && numericB !== null && numericA !== numericB) {
    return numericA < numericB ? -1 : 1;
  }

  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
}
