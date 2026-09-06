// Converts between a friendly day-of-week+time picker (what the admin
// actually interacts with) and the cron expression the api's
// PATCH /whatsapp/cron/:type/schedule endpoint still expects. Added after
// client QA (2026-08-18): typing a raw cron expression was confirmed as
// too error-prone for day-to-day use — see
// docs/phasesClient/PHASE_18_MESSAGE_AUDIENCES.md.
//
// Simplified 2026-09-05 (human request): the periodicity picker (cada
// día/semana/15 días/mes) is gone — every reminder schedule is now always
// weekly, with the admin picking which day(s) of the week it fires on.
// "Cada 15 días"/"cada mes" never had a clean cron equivalent anyway (cron
// only understands calendar fields, not a rolling N-day interval, and a
// single day-of-month isn't a fixed day of week) — this removes that
// approximation instead of trying to preserve it.

export interface ScheduleConfig {
  hour: number; // 0-23
  minute: number; // 0-59
  // 0 = Sunday, matching cron's own day-of-week field. At least one day
  // is required — the UI is responsible for not submitting an empty list.
  daysOfWeek: number[];
}

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

export const DEFAULT_SCHEDULE_CONFIG: ScheduleConfig = {
  hour: 9,
  minute: 0,
  daysOfWeek: ALL_DAYS,
};

export function buildCronExpression(config: ScheduleConfig): string {
  const minute = String(config.minute);
  const hour = String(config.hour);
  const daysOfWeek = [...config.daysOfWeek].sort((a, b) => a - b).join(',');
  return `${minute} ${hour} * * ${daysOfWeek}`;
}

// Best-effort reverse parse — only recognizes expressions shaped like a
// day-of-week-only schedule (day-of-month and month wildcarded). A
// pre-existing "cada 15 días"/"cada mes" expression (day-of-month based)
// or any other hand-written expression has no equivalent in this
// simplified model and returns null; the caller falls back to
// DEFAULT_SCHEDULE_CONFIG rather than guessing a lossy approximation. A
// wildcarded day-of-week field ("every day", the old "cada día" shape)
// parses cleanly as every day of the week selected — same actual
// behavior, just expressed as an explicit list now.
export function parseCronExpression(
  expression: string | null | undefined,
): ScheduleConfig | null {
  if (!expression) return null;
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return null;

  const [minuteStr, hourStr, dayOfMonthStr, monthStr, dayOfWeekStr] = parts;
  const minute = Number(minuteStr);
  const hour = Number(hourStr);
  if (
    !Number.isInteger(minute) ||
    minute < 0 ||
    minute > 59 ||
    !Number.isInteger(hour) ||
    hour < 0 ||
    hour > 23
  ) {
    return null;
  }
  if (monthStr !== '*' || dayOfMonthStr !== '*') return null;

  if (dayOfWeekStr === '*') {
    return { hour, minute, daysOfWeek: ALL_DAYS };
  }

  const daysOfWeek = dayOfWeekStr.split(',').map(Number);
  const isValidDayList = daysOfWeek.every(
    (day) => Number.isInteger(day) && day >= 0 && day <= 6,
  );
  if (!isValidDayList || daysOfWeek.length === 0) return null;

  return { hour, minute, daysOfWeek };
}
