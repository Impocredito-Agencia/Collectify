import { countDecimalPlaces } from './numberPrecision';

describe('countDecimalPlaces', () => {
  it('returns 0 for a whole number', () => {
    expect(countDecimalPlaces(5)).toBe(0);
  });

  it('counts digits after the decimal point', () => {
    expect(countDecimalPlaces(2.1234)).toBe(4);
    expect(countDecimalPlaces(15000.12)).toBe(2);
  });

  it('treats scientific notation as exceeding any real limit', () => {
    expect(countDecimalPlaces(1e-7)).toBe(Number.POSITIVE_INFINITY);
  });

  it('returns 0 for a negative whole number', () => {
    expect(countDecimalPlaces(-5)).toBe(0);
  });
});
