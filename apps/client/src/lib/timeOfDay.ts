// Phase 36 — 12-hour clock helpers for TimePicker (components/ui), the
// app-styled replacement for <input type="time">. Hours are 0–23 inside the
// app (cron expressions use them); only the display is 12-hour, the way
// es-CO shows times ("9:00 a. m.").

export type DayPeriod = 'am' | 'pm';

export interface Hour12 {
  hour: number; // 1–12
  period: DayPeriod;
}

export function toHour12(hour24: number): Hour12 {
  return {
    hour: hour24 % 12 === 0 ? 12 : hour24 % 12,
    period: hour24 < 12 ? 'am' : 'pm',
  };
}

export function toHour24({ hour, period }: Hour12): number {
  const base = hour % 12;
  return period === 'pm' ? base + 12 : base;
}

export function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

export function formatTimeOfDay(hour24: number, minute: number): string {
  const { hour, period } = toHour12(hour24);
  return `${pad2(hour)}:${pad2(minute)} ${period === 'am' ? 'a. m.' : 'p. m.'}`;
}

// Every `step` minutes (0, 5, … 55 by default), plus the current minute when
// it isn't on the grid (e.g. a schedule saved at 9:07 elsewhere), so the
// selected value is always one of the options.
export function minuteOptions(step: number, current: number): number[] {
  const options = Array.from(
    { length: Math.ceil(60 / step) },
    (_, index) => index * step,
  );
  return options.includes(current)
    ? options
    : [...options, current].sort((a, b) => a - b);
}
