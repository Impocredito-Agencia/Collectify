import {
  ConceptCalculationType,
  FixedAmountDistribution,
} from '../../interestConceptTypes/entities/interestConceptType.entity';

import {
  ConceptAssignment,
  generateAmortizationSchedule,
} from './generateSchedule';

describe('generateAmortizationSchedule', () => {
  it('splits the principal evenly (capital fijo) and smooths the interest into an equal "cuota con interés" every installment, including the last', () => {
    // The system-generated corriente-interest concept always has
    // conceptTypeId: null in production (see
    // LoansService.buildInterestConceptAssignment) — that's what marks it
    // as the one that absorbs the $1,000-rounding residual below.
    const concept: ConceptAssignment = {
      conceptTypeId: null,
      name: 'Intereses corrientes',
      calculationType: ConceptCalculationType.Percentage,
      value: 5,
    };

    const schedule = generateAmortizationSchedule(300000, 3, [concept]);

    // Capital is the same every installment — unaffected by the smoothing
    // below, it was already constant under capital fijo.
    expect(schedule.map((i) => i.principalPortion)).toEqual([
      100000, 100000, 100000,
    ]);
    // The interest concept's *true* declining values here would be 15000,
    // 10000, 5000 (computed on the declining balance: 300000, 200000,
    // 100000) — but confirmed with the human 2026-09-04 (matching the
    // client's real Excel): those get averaged into one flat number
    // charged every period instead: (15000+10000+5000)/3 = 10000.
    expect(schedule.map((i) => i.concepts[0].computedAmount)).toEqual([
      10000, 10000, 10000,
    ]);
    // So every installment's total is identical — including the last —
    // unlike plain capital fijo (which would decline) or level-payment
    // French (which would front-load interest with a higher total cost).
    // 110000 already lands exactly on a multiple of $1,000, so this
    // example doesn't show the rounding nudge itself — see the next test
    // for that.
    expect(schedule.map((i) => i.amount)).toEqual([110000, 110000, 110000]);
  });

  it('rounds the smoothed cuota to the nearest $1,000 when the raw average does not already land on one', () => {
    const concept: ConceptAssignment = {
      conceptTypeId: null,
      name: 'Intereses corrientes',
      calculationType: ConceptCalculationType.Percentage,
      value: 5,
    };

    // True capital-fijo totals here are 115575, 110550, 105525 (interest
    // 15075, 10050, 5025 on balances 301500/201000/100500) — summing to
    // 331650, averaging to 110550/installment. 110550 is closer to
    // 111000 than to 110000, so it rounds up.
    const schedule = generateAmortizationSchedule(301500, 3, [concept]);

    expect(schedule.map((i) => i.amount)).toEqual([111000, 111000, 111000]);
    // The interest concept absorbs the rounding nudge on top of its own
    // averaging: true average interest was 10050 (30150/3); the $450/mo
    // nudge (rounding 110550 up to 111000) lands entirely on it, since
    // capital (100500/installment here — 301500 divides evenly by 3) is
    // never touched by this smoothing.
    expect(schedule.map((i) => i.principalPortion)).toEqual([
      100500, 100500, 100500,
    ]);
    expect(schedule.map((i) => i.concepts[0].computedAmount)).toEqual([
      10500, 10500, 10500,
    ]);
  });

  it('smooths every concept independently, not just the aggregate total — the non-anchor concept absorbs its own rounding remainder on the last installment, and the anchor concept absorbs whatever is left so every installment still totals exactly the same', () => {
    const corriente: ConceptAssignment = {
      conceptTypeId: null,
      name: 'Intereses corrientes',
      calculationType: ConceptCalculationType.Percentage,
      value: 5,
    };
    const catalogFee: ConceptAssignment = {
      conceptTypeId: 'concept-2',
      name: 'Seguro',
      calculationType: ConceptCalculationType.Percentage,
      value: 2,
    };

    // Principal (250000/3) doesn't divide evenly, so the true schedule's
    // last installment has a 1-cent capital remainder — this test exists
    // to confirm that residual still gets absorbed correctly (by the
    // corriente concept) so every installment's total is identical to the
    // peso, not just approximately.
    const schedule = generateAmortizationSchedule(250000, 3, [
      corriente,
      catalogFee,
    ]);

    expect(schedule.map((i) => i.principalPortion)).toEqual([
      83333.33, 83333.33, 83333.34,
    ]);
    // catalogFee (non-anchor): true total is 10000 (5000+3333.33+1666.67
    // rounded per period), split evenly with the remainder on the last
    // installment — same convention as a FixedAmount split_across
    // concept, independent of the $1,000 cuota rounding.
    expect(schedule.map((i) => i.concepts[1].computedAmount)).toEqual([
      3333.33, 3333.33, 3333.34,
    ]);
    // corriente (anchor): absorbs its own averaging plus whatever's left
    // after capital and catalogFee, so it wobbles by a cent or two on the
    // last installment instead of staying perfectly flat.
    expect(schedule.map((i) => i.concepts[0].computedAmount)).toEqual([
      8333.34, 8333.34, 8333.32,
    ]);
    // Every installment totals exactly the same despite those per-concept
    // cent-level wobbles.
    expect(schedule.map((i) => i.amount)).toEqual([95000, 95000, 95000]);
  });

  it('sums principal portions to exactly the principal amount, including a rounding remainder', () => {
    // 1000 / 3 = 333.333... — not evenly divisible.
    const schedule = generateAmortizationSchedule(1000, 3, []);

    const total = schedule.reduce((sum, i) => sum + i.principalPortion, 0);
    expect(total).toBeCloseTo(1000, 6);
    // The remainder lands on the last installment, not spread evenly.
    expect(schedule[0].principalPortion).toBe(333.33);
    expect(schedule[1].principalPortion).toBe(333.33);
    expect(schedule[2].principalPortion).toBe(333.34);
  });

  it('split_across_installments divides a fixed-amount concept evenly, remainder on the last installment', () => {
    const concept: ConceptAssignment = {
      conceptTypeId: 'concept-1',
      name: 'Gastos de cobranza',
      calculationType: ConceptCalculationType.FixedAmount,
      value: 5000,
      fixedAmountDistribution: FixedAmountDistribution.SplitAcrossInstallments,
    };

    const schedule = generateAmortizationSchedule(300000, 3, [concept]);

    expect(schedule.map((i) => i.concepts[0].computedAmount)).toEqual([
      1666.67, 1666.67, 1666.66,
    ]);
    expect(
      schedule.reduce((sum, i) => sum + i.concepts[0].computedAmount, 0),
    ).toBeCloseTo(5000, 6);
  });

  it('repeated_each_installment charges the full fixed-amount concept on every installment', () => {
    const concept: ConceptAssignment = {
      conceptTypeId: 'concept-1',
      name: 'Gastos de cobranza',
      calculationType: ConceptCalculationType.FixedAmount,
      value: 5000,
      fixedAmountDistribution: FixedAmountDistribution.RepeatedEachInstallment,
    };

    const schedule = generateAmortizationSchedule(300000, 3, [concept]);

    expect(schedule.map((i) => i.concepts[0].computedAmount)).toEqual([
      5000, 5000, 5000,
    ]);
    // With no percentage concept, principal is split evenly (100000 each);
    // every installment carries the same flat fee on top.
    expect(schedule.map((i) => i.amount)).toEqual([105000, 105000, 105000]);
  });

  it('throws when a fixed-amount concept has no distribution mode configured', () => {
    const concept: ConceptAssignment = {
      conceptTypeId: 'concept-1',
      name: 'Gastos de cobranza',
      calculationType: ConceptCalculationType.FixedAmount,
      value: 5000,
    };

    expect(() => generateAmortizationSchedule(300000, 3, [concept])).toThrow(
      /fixedAmountDistribution/,
    );
  });

  it('supports a mix of percentage and fixed-amount concepts on the same installment', () => {
    const percentageConcept: ConceptAssignment = {
      conceptTypeId: 'concept-1',
      name: 'Interés remuneratorio',
      calculationType: ConceptCalculationType.Percentage,
      value: 2,
    };
    const fixedConcept: ConceptAssignment = {
      conceptTypeId: 'concept-2',
      name: 'Gastos de cobranza',
      calculationType: ConceptCalculationType.FixedAmount,
      value: 5000,
      fixedAmountDistribution: FixedAmountDistribution.RepeatedEachInstallment,
    };

    // Neither concept has conceptTypeId: null here, so this also exercises
    // the anchor-resolution fallback (first Percentage concept takes the
    // smoothing-anchor role instead of the system corriente concept).
    const schedule = generateAmortizationSchedule(300000, 1, [
      percentageConcept,
      fixedConcept,
    ]);

    // Single installment: principal 300000 + 2% of 300000 (6000) + 5000
    // flat = 311000 — already a multiple of $1,000, so unaffected by
    // rounding either way.
    expect(schedule[0].amount).toBe(311000);
  });

  it('generates a single installment equal to principal plus its concepts', () => {
    const concept: ConceptAssignment = {
      conceptTypeId: 'concept-1',
      name: 'Interés remuneratorio',
      calculationType: ConceptCalculationType.Percentage,
      value: 5,
    };

    const schedule = generateAmortizationSchedule(100000, 1, [concept]);

    expect(schedule).toHaveLength(1);
    expect(schedule[0]).toMatchObject({
      installmentNumber: 1,
      principalPortion: 100000,
      amount: 105000,
    });
  });

  it('handles a loan with no concepts at all', () => {
    // No Percentage concept exists to anchor the $1,000-rounding smoothing
    // into (see resolveAnchorConceptIndex), so this falls back to plain
    // capital fijo untouched — which is already flat here anyway, since
    // there's no interest to make it decline in the first place.
    const schedule = generateAmortizationSchedule(90000, 3, []);

    expect(schedule.every((i) => i.amount === i.principalPortion)).toBe(true);
    expect(schedule.map((i) => i.amount)).toEqual([30000, 30000, 30000]);
  });

  it('throws when totalInstallments is less than 1', () => {
    expect(() => generateAmortizationSchedule(1000, 0, [])).toThrow();
  });
});
