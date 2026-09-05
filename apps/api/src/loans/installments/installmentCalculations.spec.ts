import { addDays, subDays } from 'date-fns';

import { ConceptCalculationType } from '../../interestConceptTypes/entities/interestConceptType.entity';

import {
  calculateDaysUntilDue,
  calculateInterest,
  calculateMoratoryCharges,
  calculateOverdueDays,
  calculateTotalDue,
} from './installmentCalculations';

// `today` fixtures below deliberately use a mid-day UTC time (T12:00:00Z =
// 7am Bogotá) rather than bare midnight, the same way real usage always
// does (`today` is `new Date()`, "right now" — essentially never exact UTC
// midnight). `dueDate` fixtures stay at bare UTC midnight, matching how a
// 'date' column is actually parsed (see installmentCalculations.ts's own
// comment on dueDateDayNumber/todayDayNumberInBogota for why the two sides
// are handled differently). Anchoring `today` at noon UTC keeps every "today
// is day X" fixture safely inside Bogotá's calendar day X (Bogotá's day X
// spans UTC X 05:00 through X+1 04:59), with comfortable margin on both
// sides — see the "Bug fix, 2026-09-04" describe block below for tests that
// deliberately sit ON that boundary.
function bogotaNoon(dateString: string): Date {
  return new Date(`${dateString}T12:00:00Z`);
}

describe('installmentCalculations', () => {
  describe('calculateOverdueDays', () => {
    it('returns 0 when the due date is today', () => {
      const dueDate = new Date('2026-01-01');
      expect(calculateOverdueDays(dueDate, bogotaNoon('2026-01-01'))).toBe(0);
    });

    it('returns 0 when the due date is in the future', () => {
      const today = bogotaNoon('2026-01-01');
      const dueDate = addDays(new Date('2026-01-01'), 5);
      expect(calculateOverdueDays(dueDate, today)).toBe(0);
    });

    it('returns the number of days elapsed when the due date has passed', () => {
      const today = bogotaNoon('2026-01-11');
      const dueDate = subDays(new Date('2026-01-11'), 10);
      expect(calculateOverdueDays(dueDate, today)).toBe(10);
    });

    it('is not off-by-one when the server runs behind UTC (dueDate is a UTC-midnight date string)', () => {
      // installments.dueDate is a 'date' column, parsed as UTC midnight —
      // this must give the same day count regardless of the machine's local
      // timezone. Regression test for a bug where differenceInCalendarDays
      // (which normalizes to LOCAL midnight) silently added a day in any
      // timezone behind UTC, e.g. America/Bogota (UTC-5).
      const dueDate = new Date('2024-01-01');
      const today = new Date('2024-01-11T08:00:00Z');
      expect(calculateOverdueDays(dueDate, today)).toBe(10);
    });
  });

  describe('calculateDaysUntilDue', () => {
    it('returns 0 when the due date is today', () => {
      const dueDate = new Date('2026-01-01');
      expect(calculateDaysUntilDue(dueDate, bogotaNoon('2026-01-01'))).toBe(0);
    });

    it('returns 0 when the due date has already passed', () => {
      const today = bogotaNoon('2026-01-11');
      const dueDate = subDays(new Date('2026-01-11'), 10);
      expect(calculateDaysUntilDue(dueDate, today)).toBe(0);
    });

    it('returns the number of days remaining when the due date is in the future', () => {
      const today = bogotaNoon('2026-01-01');
      const dueDate = addDays(new Date('2026-01-01'), 5);
      expect(calculateDaysUntilDue(dueDate, today)).toBe(5);
    });
  });

  // Bug fix, 2026-09-04 — see docs/DATABASE.md's note of that date. Found via
  // a real refinance: today Sep 4, first cuota due Sep 10 (6 calendar days
  // out) was already entering the 5-day early-maturity window
  // (calculatePayoff.ts's REFINANCE_EARLY_MATURITY_WINDOW_DAYS) on Sep 4
  // itself, a day early. Root cause: dueDate parses as UTC midnight, which
  // in Bogotá (UTC-5) is 7pm the evening before — so the old
  // differenceInDays-on-exact-instants formula always undercounted by 1 day
  // (2 after 7pm Bogotá), never the other direction.
  describe('Bug fix, 2026-09-04 — Bogotá calendar days, not exact elapsed instants', () => {
    it('does not shrink a 6-day gap to 5 no matter the time of day on the earlier date', () => {
      // Due Sep 10 (UTC midnight), "today" at three different times spanning
      // Bogotá's Sep 4 (which runs UTC 2026-09-04T05:00 through
      // 2026-09-05T04:59, since Bogotá is UTC-5) — all of them must read as
      // 6 days remaining, matching the calendar. This is the exact scenario
      // reported: a cuota due Sep 10 was entering calculatePayoff.ts's 5-day
      // early-maturity window on Sep 4 itself, a day early.
      const dueDate = new Date('2026-09-10');
      // 12:00:01am Bogotá (just after Sep 4 begins there).
      expect(
        calculateDaysUntilDue(dueDate, new Date('2026-09-04T05:00:01Z')),
      ).toBe(6);
      // Noon Bogotá.
      expect(
        calculateDaysUntilDue(dueDate, new Date('2026-09-04T17:00:00Z')),
      ).toBe(6);
      // 11:59:59pm Bogotá (just before Sep 4 ends there).
      expect(
        calculateDaysUntilDue(dueDate, new Date('2026-09-05T04:59:59Z')),
      ).toBe(6);
    });

    it('does not treat a cuota as already due the evening before its calendar due date', () => {
      // 2026-09-09T23:30:00Z = 6:30pm on Sep 9 in Bogotá (UTC-5) — still
      // "the day before" a Sep 10 due date by the Bogotá calendar, so this
      // must still read as 1 day remaining, not 0.
      const dueDate = new Date('2026-09-10');
      const eveningBeforeInBogota = new Date('2026-09-09T23:30:00Z');
      expect(calculateDaysUntilDue(dueDate, eveningBeforeInBogota)).toBe(1);
      expect(calculateOverdueDays(dueDate, eveningBeforeInBogota)).toBe(0);
    });

    it('rolls over to "due today" only once it is actually midnight in Bogotá (05:00 UTC), not at 7pm the day before', () => {
      const dueDate = new Date('2026-09-10');
      // 2026-09-10T04:59:59Z = 11:59:59pm Sep 9 in Bogotá — still Sep 9.
      expect(
        calculateDaysUntilDue(dueDate, new Date('2026-09-10T04:59:59Z')),
      ).toBe(1);
      // 2026-09-10T05:00:00Z = 12:00:00am Sep 10 in Bogotá — now Sep 10.
      expect(
        calculateDaysUntilDue(dueDate, new Date('2026-09-10T05:00:00Z')),
      ).toBe(0);
    });
  });

  describe('calculateInterest — verified fixtures from real spreadsheet data', () => {
    it.each([
      [210000, 6, 740, 310800],
      [520000, 6, 484, 503360],
      [547000, 6, 409, 447446],
    ])(
      'amount=%d rate=%d%% overdueDays=%d -> interest=%d',
      (installmentAmount, interestRate, overdueDays, expectedInterest) => {
        expect(
          calculateInterest(installmentAmount, interestRate, overdueDays),
        ).toBeCloseTo(expectedInterest, 6);
      },
    );

    it('returns 0 when there are no overdue days', () => {
      expect(calculateInterest(210000, 6, 0)).toBe(0);
    });
  });

  describe('calculateMoratoryCharges', () => {
    it('matches calculateInterest exactly for a single percentage concept at the same rate — no regression when a loan migrates onto the new engine', () => {
      const [installmentAmount, rate, overdueDays, expected] = [
        210000, 6, 740, 310800,
      ];

      const result = calculateMoratoryCharges(installmentAmount, overdueDays, [
        {
          name: 'Interés moratorio',
          calculationType: ConceptCalculationType.Percentage,
          value: rate,
        },
      ]);

      expect(result[0].name).toBe('Interés moratorio');
      expect(result[0].amount).toBeCloseTo(expected, 6);
    });

    it('charges a fixed_amount concept in full, unscaled by overdueDays, once the installment is overdue', () => {
      const result = calculateMoratoryCharges(210000, 45, [
        {
          name: 'Gastos de cobranza',
          calculationType: ConceptCalculationType.FixedAmount,
          value: 15000,
        },
      ]);

      expect(result).toEqual([{ name: 'Gastos de cobranza', amount: 15000 }]);
    });

    it('every concept is 0 when the installment is not yet overdue', () => {
      const result = calculateMoratoryCharges(210000, 0, [
        {
          name: 'Interés moratorio',
          calculationType: ConceptCalculationType.Percentage,
          value: 6,
        },
        {
          name: 'Gastos de cobranza',
          calculationType: ConceptCalculationType.FixedAmount,
          value: 15000,
        },
      ]);

      expect(result).toEqual([
        { name: 'Interés moratorio', amount: 0 },
        { name: 'Gastos de cobranza', amount: 0 },
      ]);
    });

    it('sums multiple concepts independently, mixing percentage and fixed_amount', () => {
      const result = calculateMoratoryCharges(210000, 30, [
        {
          name: 'Interés moratorio',
          calculationType: ConceptCalculationType.Percentage,
          value: 6,
        },
        {
          name: 'Gastos de cobranza',
          calculationType: ConceptCalculationType.FixedAmount,
          value: 15000,
        },
      ]);

      // 210000 * 0.06 / 30 * 30 = 12600
      expect(result[0].amount).toBeCloseTo(12600, 6);
      expect(result[1].amount).toBe(15000);
    });

    it('returns an empty array when no moratory concepts are assigned', () => {
      expect(calculateMoratoryCharges(210000, 30, [])).toEqual([]);
    });
  });

  describe('calculateTotalDue — verified fixtures from real spreadsheet data', () => {
    it.each([
      [210000, 310800, 520800],
      [520000, 503360, 1023360],
      [547000, 447446, 994446],
    ])(
      'amount=%d interest=%d -> totalDue=%d',
      (installmentAmount, interest, expectedTotal) => {
        expect(calculateTotalDue(installmentAmount, interest)).toBeCloseTo(
          expectedTotal,
          6,
        );
      },
    );

    it('equals the installment amount when there is no interest', () => {
      expect(calculateTotalDue(210000, 0)).toBe(210000);
    });
  });
});
