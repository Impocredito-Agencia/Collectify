// Phase 35 — same rule as apps/api/src/loans/deletion/
// promissoryNoteNumberMatch.ts, so the "Eliminar definitivamente" button
// enables exactly when the api will accept the typed number: surrounding
// spaces and a leading "#" are ignored on either side (legacy pagarés were
// stored as "743"), never the number itself. The api re-checks it anyway.
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
