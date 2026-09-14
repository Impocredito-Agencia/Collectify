import { addDays, subDays } from 'date-fns';

import { ConceptCalculationType } from '../../interestConceptTypes/entities/interestConceptType.entity';

import {
  MORA_GRACE_PERIOD_DAYS,
  calculateDaysUntilDue,
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

  // Bug fix, 2026-09-08 (human report) — see MORA_GRACE_PERIOD_DAYS's own
  // doc comment: the business doesn't charge mora during an installment's
  // first N overdue days. Confirmed with the human: once past the grace
  // period, mora is charged over the FULL overdue days, not just the days
  // beyond the threshold.
  //
  // Narrowed from 8 to 6 days, 2026-09-09 (client correction) — day 6
  // still has no mora, day 7 already does. These tests read
  // MORA_GRACE_PERIOD_DAYS dynamically (not hardcoded), so they keep
  // testing "the day right at the edge" / "the day right past it"
  // regardless of the constant's exact value — only the hand-computed
  // expected amounts below needed updating for the new threshold.
  describe('Bug fix, 2026-09-08 — mora grace period', () => {
    it('charges no interest for any overdue day within the grace period', () => {
      for (
        let overdueDays = 1;
        overdueDays <= MORA_GRACE_PERIOD_DAYS;
        overdueDays++
      ) {
        const [charge] = calculateMoratoryCharges(205000, overdueDays, [
          {
            name: 'Interés moratorio',
            calculationType: ConceptCalculationType.Percentage,
            value: 6,
          },
        ]);
        expect(charge.amount).toBe(0);
      }
    });

    it('charges interest over the FULL overdue days once the grace period ends, not just the days past it', () => {
      // 205000 * 0.06 / 30 * 7 = 2870 — using the full 7 days, not
      // (7 - 6) = 1.
      const [charge] = calculateMoratoryCharges(
        205000,
        MORA_GRACE_PERIOD_DAYS + 1,
        [
          {
            name: 'Interés moratorio',
            calculationType: ConceptCalculationType.Percentage,
            value: 6,
          },
        ],
      );
      expect(charge.amount).toBeCloseTo(2870, 6);
    });

    it('applies the same grace period to moratory concepts, both percentage and fixed_amount', () => {
      const withinGrace = calculateMoratoryCharges(
        205000,
        MORA_GRACE_PERIOD_DAYS,
        [
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
        ],
      );
      expect(withinGrace.map((item) => item.amount)).toEqual([0, 0]);

      const pastGrace = calculateMoratoryCharges(
        205000,
        MORA_GRACE_PERIOD_DAYS + 1,
        [
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
        ],
      );
      expect(pastGrace[0].amount).toBeCloseTo(2870, 6);
      expect(pastGrace[1].amount).toBe(15000);
    });
  });

  describe('calculateMoratoryCharges', () => {
    it('computes a percentage concept exactly like the pre-Phase-23 single-rate formula did — verified fixture from real spreadsheet data', () => {
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

      expect(result).toEqual([
        {
          name: 'Gastos de cobranza',
          amount: 15000,
          calculationType: ConceptCalculationType.FixedAmount,
          value: 15000,
        },
      ]);
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
        {
          name: 'Interés moratorio',
          amount: 0,
          calculationType: ConceptCalculationType.Percentage,
          value: 6,
        },
        {
          name: 'Gastos de cobranza',
          amount: 0,
          calculationType: ConceptCalculationType.FixedAmount,
          value: 15000,
        },
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

    // Bug fix, 2026-09-14 (human report, préstamo #1170) — this division
    // chain almost never lands on a whole peso; left unrounded, that
    // fraction made it impossible to fully close a cuota with a whole-peso
    // payment (all this app's currency inputs/displays are whole pesos
    // only). 205000 * 0.06 / 30 * 8 = 328 exactly, so use a day count that
    // doesn't divide evenly instead.
    it('rounds a percentage concept to the nearest whole peso', () => {
      // 205000 * 0.055 / 30 * 7 = 2630.8333... → rounds to 2631.
      const [charge] = calculateMoratoryCharges(205000, 7, [
        {
          name: 'Interés moratorio',
          calculationType: ConceptCalculationType.Percentage,
          value: 5.5,
        },
      ]);
      expect(charge.amount).toBe(2631);
      expect(Number.isInteger(charge.amount)).toBe(true);
    });
  });

  // Bug fix, 2026-09-14 (human report, préstamo #1170; human decision on
  // the exact rounding rule) — this used to assert the raw, unrounded
  // spreadsheet sum ($520.000 + $503.360 = $1.023.360, etc.). A cuota's
  // real totalDue (capital + accrued mora) almost never lands on a whole
  // peso, but every other figure in this app — what's shown, what
  // CurrencyInput even lets a cobrador type — is whole pesos only, so a
  // payment for the exact amount shown everywhere could never actually
  // close the cuota, leaving it Pending with a phantom balance ("saldo
  // pendiente de $1"). Confirmed with the human: round the combined total
  // to the nearest $100, same convention generateSchedule.ts's cuotaFinal
  // already uses for the cuota's original scheduled amount — accepting
  // that a small accrued mora (under $50) can round away to $0 rather than
  // being charged, the same tradeoff that feature already made.
  describe('calculateTotalDue — rounds capital + mora to the nearest $100', () => {
    it.each([
      [210000, 310800, 520800],
      [520000, 503360, 1023400],
      [547000, 447446, 994400],
    ])(
      'amount=%d interest=%d -> totalDue=%d (nearest $100)',
      (installmentAmount, interest, expectedTotal) => {
        expect(calculateTotalDue(installmentAmount, interest)).toBe(
          expectedTotal,
        );
      },
    );

    it('equals the installment amount when there is no interest', () => {
      expect(calculateTotalDue(210000, 0)).toBe(210000);
    });

    it('can round a small accrued mora away to $0 rather than charging it', () => {
      // installmentAmount is already a clean $100 multiple (see
      // generateSchedule.ts) — a $34 mora added on top rounds right back
      // down to the installment amount alone.
      expect(calculateTotalDue(393000, 34)).toBe(393000);
    });

    it('rounds a larger accrued mora up to the next $100', () => {
      expect(calculateTotalDue(393000, 67)).toBe(393100);
    });
  });
});
