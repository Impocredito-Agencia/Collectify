// Bug fix, 2026-09-07 — formats a promissoryNoteNumber for display in
// audit-log labels and WhatsApp free-text messages as "#NNNN", tolerating
// both shapes that coexist in the data: loans created since the 2026-09-03
// #0000 standardization already store the "#" as part of the value itself
// (see CreateLoanDto.promissoryNoteNumber), while the ~1190 pre-existing
// loans that predate it were never reformatted and stay bare numbers
// ("743", "124"...) or occasionally already had one ("#743") — confirmed
// with the human not to touch that historical data.
//
// Several call sites used to hand-write `#${promissoryNoteNumber}`,
// assuming the old bare-number convention — for any loan in the new
// format that produced a visible "##0917" in real audit-log entries and
// WhatsApp messages sent to clients. This is the one place that decides
// whether the "#" is already there, so every caller gets it right without
// having to know which convention a given loan happens to use.
export function formatPromissoryNoteLabel(
  promissoryNoteNumber: string,
): string {
  return promissoryNoteNumber.startsWith('#')
    ? promissoryNoteNumber
    : `#${promissoryNoteNumber}`;
}
