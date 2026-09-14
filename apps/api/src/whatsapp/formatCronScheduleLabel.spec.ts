import { formatCronScheduleLabel } from './formatCronScheduleLabel';

describe('formatCronScheduleLabel', () => {
  it('formats a single day in the morning', () => {
    expect(formatCronScheduleLabel('0 8 * * 1')).toBe('Lun a las 8:00 a. m.');
  });

  it('formats several days, sorted regardless of input order', () => {
    expect(formatCronScheduleLabel('0 9 * * 6,1,3')).toBe(
      'Lun, Mié, Sáb a las 9:00 a. m.',
    );
  });

  it('formats an afternoon hour as 12-hour with p. m.', () => {
    expect(formatCronScheduleLabel('30 14 * * 5')).toBe('Vie a las 2:30 p. m.');
  });

  it('formats noon as 12:00 p. m.', () => {
    expect(formatCronScheduleLabel('0 12 * * 0')).toBe('Dom a las 12:00 p. m.');
  });

  it('formats midnight as 12:00 a. m.', () => {
    expect(formatCronScheduleLabel('0 0 * * 2')).toBe('Mar a las 12:00 a. m.');
  });

  it('collapses a day-of-week wildcard into "Todos los días"', () => {
    expect(formatCronScheduleLabel('0 9 * * *')).toBe(
      'Todos los días a las 9:00 a. m.',
    );
  });

  it('collapses an explicit list of all 7 days the same as a wildcard', () => {
    expect(formatCronScheduleLabel('0 9 * * 0,1,2,3,4,5,6')).toBe(
      'Todos los días a las 9:00 a. m.',
    );
  });

  // Falls back to the raw string for anything the admin UI's day-of-week
  // picker could never itself produce — a hand-set expression predating
  // it, or genuinely malformed input — rather than guessing at a lossy
  // translation. Mirrors cronScheduleUtils.ts's parseCronExpression
  // exactly (same shape recognized).
  it('falls back to the raw expression when day-of-month is not a wildcard', () => {
    expect(formatCronScheduleLabel('0 9 15 * *')).toBe('0 9 15 * *');
  });

  it('falls back to the raw expression when month is not a wildcard', () => {
    expect(formatCronScheduleLabel('0 9 * 6 1')).toBe('0 9 * 6 1');
  });

  it('falls back to the raw expression for an out-of-range day-of-week value', () => {
    expect(formatCronScheduleLabel('0 9 * * 7')).toBe('0 9 * * 7');
  });

  it('falls back to the raw expression for a malformed hour/minute', () => {
    expect(formatCronScheduleLabel('99 25 * * 1')).toBe('99 25 * * 1');
  });

  it('falls back to the raw expression when it does not have exactly 5 fields', () => {
    expect(formatCronScheduleLabel('0 9 * *')).toBe('0 9 * *');
  });
});
