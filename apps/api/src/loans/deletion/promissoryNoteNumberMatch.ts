// Phase 35 — the typed confirmation in the deletion dialog. Lenient on
// format only: surrounding spaces and a leading "#" are ignored on either
// side, since legacy rows were stored without one ("743") while every
// number created since 2026-09-03 has it ("#0743"). Never lenient on the
// number itself — no trimming of zeros, no partial match.
function normalize(promissoryNoteNumber: string): string {
  return promissoryNoteNumber.trim().replace(/^#/, '').trim();
}

export function matchesPromissoryNoteNumber(
  typed: string,
  actual: string,
): boolean {
  const normalized = normalize(typed);
  return normalized.length > 0 && normalized === normalize(actual);
}
