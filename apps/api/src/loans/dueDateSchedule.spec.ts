import {
  addDaysToDateString,
  addMonthsToDateString,
  addWeeksToDateString,
  todayDateString,
  withDayOfMonth,
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

    // Regression test, 2026-09-09 — guards against a blanket "always clamp
    // to 28" bug: a source day of 29-31 must be preserved whenever the
    // target month actually has that many days, not just when the target
    // happens to be a short February. Found in production as
    // LoansService.calculateDueDate silently locking every installment to
    // day 28 once disbursedAt itself got clamped by the frontend's lossy
    // subtractMonthsFromDateString — see this file's own top comment and
    // LoansService.calculateDueDate's firstInstallmentDueDate parameter.
    it('preserves day 31 when the target month also has 31 days', () => {
      expect(addMonthsToDateString('2026-01-31', 6)).toBe('2026-07-31');
    });

    it('preserves day 30 when the target month has 30 or more days', () => {
      expect(addMonthsToDateString('2026-04-30', 1)).toBe('2026-05-30');
    });

    it('clamps to Feb 29 in a leap year instead of Feb 28', () => {
      expect(addMonthsToDateString('2028-01-31', 1)).toBe('2028-02-29');
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

  describe('withDayOfMonth', () => {
    it('replaces the day, keeping the same year and month', () => {
      expect(withDayOfMonth('2026-03-01', 10)).toBe('2026-03-10');
    });

    it('clamps to the last day of the month instead of overflowing', () => {
      expect(withDayOfMonth('2026-02-05', 31)).toBe('2026-02-28');
    });

    it('clamps to Feb 29 in a leap year instead of Feb 28', () => {
      expect(withDayOfMonth('2028-02-05', 31)).toBe('2028-02-29');
    });

    it('supports moving the day earlier in the month, not just later', () => {
      expect(withDayOfMonth('2026-05-20', 10)).toBe('2026-05-10');
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
