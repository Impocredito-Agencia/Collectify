// Pure UTC date-string arithmetic for generating installment due dates.
//
// date-fns' addMonths/addWeeks + format operate on the JS Date's LOCAL
// getters/setters. Since disbursedAt/dueDate are 'date' columns (parsed as
// UTC midnight, no time-of-day), that combination silently shifts the
// result by a day on any server running behind UTC (e.g. America/Bogota,
// UTC-5) — verified empirically before writing this. Everything here uses
// Date.UTC / getUTC*/toISOString exclusively to stay timezone-proof.

function parseDateString(dateString: string): {
  year: number;
  month: number;
  day: number;
} {
  const [year, month, day] = dateString.split('-').map(Number);
  return { year, month: month - 1, day }; // month is 0-indexed to match Date.UTC
}

function toDateString(year: number, month: number, day: number): string {
  return new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
}

export function addMonthsToDateString(
  dateString: string,
  months: number,
): string {
  const { year, month, day } = parseDateString(dateString);
  const totalMonths = month + months;
  const targetYear = year + Math.floor(totalMonths / 12);
  const targetMonth = ((totalMonths % 12) + 12) % 12;

  // Clamp to the last day of the target month instead of overflowing into
  // the next one (e.g. Jan 31 + 1 month -> Feb 28/29, not Mar 3).
  const daysInTargetMonth = new Date(
    Date.UTC(targetYear, targetMonth + 1, 0),
  ).getUTCDate();
  const targetDay = Math.min(day, daysInTargetMonth);

  return toDateString(targetYear, targetMonth, targetDay);
}

export function addWeeksToDateString(
  dateString: string,
  weeks: number,
): string {
  const { year, month, day } = parseDateString(dateString);
  return toDateString(year, month, day + weeks * 7);
}

export function addDaysToDateString(dateString: string, days: number): string {
  const { year, month, day } = parseDateString(dateString);
  return toDateString(year, month, day + days);
}

// Colombia has no DST, so this fixed offset holds year-round — same
// precedent as installmentCalculations.ts's identical fix (see
// docs/DATABASE.md's "Bug fix, 2026-09-04" note under `installments`).
const BOGOTA_UTC_OFFSET_MS = 5 * 60 * 60 * 1000;

// Bogotá's current CALENDAR DATE as 'YYYY-MM-DD', matching how a 'date'
// column is parsed (UTC midnight) — so addDaysToDateString/direct string
// comparisons against dueDate stay both timezone-proof (never depends on
// the server process's own local timezone) AND correct for the business's
// actual Bogotá calendar day, not raw UTC "now".
//
// Bug fixed 2026-09-04: this used to be plain `new Date().toISOString()
// .slice(0, 10)` — the UTC calendar date — which is wrong for roughly 5
// hours a day (UTC 00:00-05:00, i.e. 7pm-midnight in Bogotá), where UTC's
// date is already a day ahead of Bogotá's. Used by the overdue/upcoming-due
// reminder crons (via reminderInstallmentQueries.ts and each service's own
// upcomingTargetDates()) to decide which installments are "due today" or
// "due in N days" — see installmentCalculations.ts's own note for the
// identical root cause affecting mora/refinancing money calculations.
export function todayDateString(): string {
  return new Date(Date.now() - BOGOTA_UTC_OFFSET_MS).toISOString().slice(0, 10);
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Same root cause as todayDateString() above, applied to a date-range
// filter instead of "today": a UI date input gives a plain 'YYYY-MM-DD',
// which `new Date(dateString)` parses as UTC midnight of that day — 5
// hours BEFORE midnight in Bogotá. Used as-is, a "dateFrom" filter starts
// too early (it leaks in the last 5 hours of the previous Bogotá day) and
// a "dateTo" filter is far worse: its cutoff lands hours before the
// selected day even begins locally, so the ENTIRE selected day (and part
// of the day before) gets silently excluded from results instead of
// included. Bug found 2026-09-05 in AuditLogsPage's date-range filter;
// same pattern, same day, also fixed in messageLogs.service.ts (see that
// file's own "Bug fix, 2026-09-05" comment) — both now use
// bogotaStartOfDayUtc/bogotaEndOfDayUtc below instead of a raw `new Date()`.
//
// bogotaStartOfDayUtc('2026-01-31') -> the UTC instant that IS local
// midnight at the start of Jan 31 in Bogotá (2026-01-31T05:00:00.000Z).
export function bogotaStartOfDayUtc(dateString: string): Date {
  return new Date(new Date(dateString).getTime() + BOGOTA_UTC_OFFSET_MS);
}

// bogotaEndOfDayUtc('2026-01-31') -> the UTC instant one millisecond
// before local midnight at the START of Feb 1 in Bogotá — i.e. the last
// millisecond of Jan 31, Bogotá time (2026-02-01T04:59:59.999Z).
export function bogotaEndOfDayUtc(dateString: string): Date {
  return new Date(
    new Date(dateString).getTime() + BOGOTA_UTC_OFFSET_MS + MS_PER_DAY - 1,
  );
}
