import {
  addDaysToDateString,
  addMonthsToDateString,
  addWeeksToDateString,
  todayDateString,
} from './dueDateSchedule';

describe('dueDateSchedule', () => {
  describe('addMonthsToDateString', () => {
    it('advances by the given number of months', () => {
      expect(addMonthsToDateString('2026-01-01', 1)).toBe('2026-02-01');
      expect(addMonthsToDateString('2026-01-01', 2)).toBe('2026-03-01');
      expect(addMonthsToDateString('2026-01-01', 3)).toBe('2026-04-01');
    });

    it('rolls over into the next year', () => {
      expect(addMonthsToDateString('2026-11-15', 3)).toBe('2027-02-15');
    });

    it('clamps to the last day of the target month instead of overflowing', () => {
      expect(addMonthsToDateString('2026-01-31', 1)).toBe('2026-02-28');
    });

    it('is not shifted by the server timezone (UTC-midnight date string in, UTC-midnight date string out)', () => {
      // Regression test: date-fns' addMonths + format shift this by a day
      // on any machine running behind UTC (e.g. America/Bogota) because
      // they read/write local-time getters against a UTC-midnight Date.
      expect(addMonthsToDateString('2026-01-01', 1)).toBe('2026-02-01');
    });
  });

  describe('addWeeksToDateString', () => {
    it('advances by the given number of weeks', () => {
      expect(addWeeksToDateString('2026-01-01', 2)).toBe('2026-01-15');
      expect(addWeeksToDateString('2026-01-01', 4)).toBe('2026-01-29');
    });

    it('rolls over across a month boundary', () => {
      expect(addWeeksToDateString('2026-01-01', 6)).toBe('2026-02-12');
    });
  });

  describe('addDaysToDateString', () => {
    it('advances by the given number of days', () => {
      expect(addDaysToDateString('2026-01-01', 5)).toBe('2026-01-06');
    });

    it('rolls over across a month boundary', () => {
      expect(addDaysToDateString('2026-01-30', 3)).toBe('2026-02-02');
    });
  });

  describe('todayDateString', () => {
    afterEach(() => {
      jest.useRealTimers();
    });

    // Bug fix, 2026-09-04 (see this function's own comment and
    // docs/DATABASE.md's note of that date) — this used to return the raw
    // UTC calendar date, which is a day ahead of Bogotá's for roughly 5
    // hours every day (UTC 00:00-05:00, i.e. 7pm-midnight in Bogotá).
    it('returns the calendar date in Bogotá, not raw UTC', () => {
      // 11:59:59pm Sep 4 in Bogotá (UTC-5) — still Sep 4 there, even though
      // UTC's own calendar date is already Sep 5.
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-09-05T04:59:59Z'));
      expect(todayDateString()).toBe('2026-09-04');

      // 12:00:00am Sep 5 in Bogotá — now Sep 5.
      jest.setSystemTime(new Date('2026-09-05T05:00:00Z'));
      expect(todayDateString()).toBe('2026-09-05');
    });
  });
});
