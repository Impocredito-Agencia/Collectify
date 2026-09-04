import { convertAnnualToMonthlyRate } from './convertAnnualToMonthlyRate';

describe('convertAnnualToMonthlyRate', () => {
  it('matches the real example the human provided (29.24% annual → 2.1605% monthly)', () => {
    expect(convertAnnualToMonthlyRate(29.24)).toBeCloseTo(2.1605, 4);
  });

  it('returns 0 for a 0% annual rate', () => {
    expect(convertAnnualToMonthlyRate(0)).toBe(0);
  });

  it('rounds to 4 decimal places', () => {
    const result = convertAnnualToMonthlyRate(29.24);
    // 2.1605 * 10000 = 21605, an integer — confirms no leftover precision
    // beyond 4 decimals.
    expect(Number.isInteger(result * 10000)).toBe(true);
  });

  it('is monotonically increasing with the annual rate', () => {
    expect(convertAnnualToMonthlyRate(30)).toBeGreaterThan(
      convertAnnualToMonthlyRate(29),
    );
  });
});
