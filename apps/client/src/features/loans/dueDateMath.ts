// Mirrors apps/api/src/loans/dueDateSchedule.ts's UTC-safe date-string
// arithmetic (kept as its own small copy here rather than importing backend
// code across the app boundary — apps/api and apps/client don't share a
// lib). Used only to work backward from "fecha de la primera cuota" — what
// LoanForm asks the admin for, since that's what's actually written on the
// physical pagaré — to `disbursedAt`, which POST /loans still requires as a
// record of when the money was actually given.
//
// Bug fix, 2026-09-09 — this subtraction is NOT perfectly invertible for a
// due date on the 29th-31st whenever the previous month is shorter (e.g.
// subtracting a month from Mar 31 clamps disbursedAt to Feb 28, and adding
// a month back to Feb 28 lands on Mar 28, not Mar 31 — every installment
// from then on was silently stuck on that clamped day, not just the one in
// the short month). This used to matter because the API regenerated every
// due date from disbursedAt alone; it no longer does. LoanForm/
// RefinanceLoanForm now also send `firstInstallmentDueDate` (the exact
// value the admin entered, unmodified) alongside the disbursedAt computed
// here, and the API anchors the whole schedule on that instead — see
// CreateLoanInput.firstInstallmentDueDate and LoansService.calculateDueDate
// (api). disbursedAt computed by this file is therefore only ever used for
// the informational `disbursed_at` column now, where an approximated value
// is harmless.

function parseDateString(dateString: string): {
  year: number;
  month: number;
  day: number;
} {
  const [year, month, day] = dateString.split('-').map(Number);
  return { year, month: month - 1, day };
}

function toDateString(year: number, month: number, day: number): string {
  return new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
}

export function subtractMonthsFromDateString(
  dateString: string,
  months: number,
): string {
  const { year, month, day } = parseDateString(dateString);
  const totalMonths = month - months;
  const targetYear = year + Math.floor(totalMonths / 12);
  const targetMonth = ((totalMonths % 12) + 12) % 12;
  const daysInTargetMonth = new Date(
    Date.UTC(targetYear, targetMonth + 1, 0),
  ).getUTCDate();
  const targetDay = Math.min(day, daysInTargetMonth);
  return toDateString(targetYear, targetMonth, targetDay);
}

export function subtractDaysFromDateString(
  dateString: string,
  days: number,
): string {
  const { year, month, day } = parseDateString(dateString);
  return toDateString(year, month, day - days);
}
