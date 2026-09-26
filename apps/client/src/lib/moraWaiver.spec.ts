import { describe, expect, it } from 'vitest';

import {
  calculateMoraCharged,
  maxWaivableMora,
  requiredPaymentWithWaiver,
} from './moraWaiver';

// Same vectors as apps/api's calculateMoraCharged spec — the dialog and the
// server must agree to the peso.
describe('calculateMoraCharged', () => {
  it('is the $100-rounded total minus the capital, not the raw interest', () => {
    expect(calculateMoraCharged(588000, 12344.6)).toBe(12300);
  });

  it('is 0 when the mora rounds away, or when there is none', () => {
    expect(calculateMoraCharged(588000, 40)).toBe(0);
    expect(calculateMoraCharged(588000, 0)).toBe(0);
  });
});

describe('maxWaivableMora', () => {
  it('is all the mora being charged when there is plenty of balance left', () => {
    expect(
      maxWaivableMora({ amount: 588000, interest: 12344.6, totalDue: 600300 }),
    ).toBe(12300);
  });

  it('always leaves at least $1 to pay (a prior partial payment covered most of the balance)', () => {
    expect(
      maxWaivableMora({ amount: 588000, interest: 12344.6, totalDue: 5000 }),
    ).toBe(4999);
  });

  it('is 0 for a cuota with no mora', () => {
    expect(
      maxWaivableMora({ amount: 588000, interest: 0, totalDue: 588000 }),
    ).toBe(0);
  });
});

describe('requiredPaymentWithWaiver', () => {
  it('is the balance minus the waiver, in whole pesos', () => {
    expect(requiredPaymentWithWaiver({ totalDue: 600300 }, 12300)).toBe(588000);
  });

  it('rounds a fractional balance up first, matching the server (ceil)', () => {
    expect(requiredPaymentWithWaiver({ totalDue: 600299.4 }, 12300)).toBe(
      588000,
    );
  });
});
