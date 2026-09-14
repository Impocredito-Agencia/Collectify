// Human report, 2026-09-14 — the audit log's "Entidad" column showed the
// raw cron expression verbatim ("0 9 * * 1,3,6"), unreadable to anyone who
// doesn't already know cron syntax. Mirrors
// apps/client/src/features/messageTemplates/cronScheduleUtils.ts's own
// parseCronExpression — same shape recognized (minute/hour fixed,
// day-of-month and month wildcarded, day-of-week a list or wildcard),
// since that's the only shape the admin UI's day-of-week+time picker can
// ever produce. Anything else (a hand-set expression predating that
// picker, or truly malformed input) falls back to the raw string rather
// than guessing at a lossy translation.
const DAY_LABELS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

export function formatCronScheduleLabel(cronExpression: string): string {
  const parts = cronExpression.trim().split(/\s+/);
  if (parts.length !== 5) return cronExpression;

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
    return cronExpression;
  }
  if (monthStr !== '*' || dayOfMonthStr !== '*') return cronExpression;

  let days: number[];
  if (dayOfWeekStr === '*') {
    days = [0, 1, 2, 3, 4, 5, 6];
  } else {
    const parsed = dayOfWeekStr.split(',').map(Number);
    const isValid = parsed.every(
      (day) => Number.isInteger(day) && day >= 0 && day <= 6,
    );
    if (!isValid || parsed.length === 0) return cronExpression;
    days = parsed;
  }

  const daysLabel =
    days.length === 7
      ? 'Todos los días'
      : [...days]
          .sort((a, b) => a - b)
          .map((day) => DAY_LABELS[day])
          .join(', ');

  const period = hour < 12 ? 'a. m.' : 'p. m.';
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  const timeLabel = `${hour12}:${String(minute).padStart(2, '0')} ${period}`;

  return `${daysLabel} a las ${timeLabel}`;
}
