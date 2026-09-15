import {
  comparePromissoryNoteNumbers,
  extractNumericPart,
} from './promissoryNoteNumberSort';

describe('extractNumericPart', () => {
  it('strips non-digit characters', () => {
    expect(extractNumericPart('#0743')).toBe(743n);
  });

  it('returns null when there are no digits at all', () => {
    expect(extractNumericPart('N/A')).toBeNull();
  });
});

describe('comparePromissoryNoteNumbers', () => {
  it('sorts numerically, not as text — "2" before "101"', () => {
    const sorted = ['#101', '#2'].sort(comparePromissoryNoteNumbers);
    expect(sorted).toEqual(['#2', '#101']);
  });

  it('puts a non-numeric value last', () => {
    const sorted = ['N/A', '#5'].sort(comparePromissoryNoteNumbers);
    expect(sorted).toEqual(['#5', 'N/A']);
  });

  it('falls back to a text compare when the numeric part ties', () => {
    const sorted = ['#0800-B', '#0800-A'].sort(comparePromissoryNoteNumbers);
    expect(sorted).toEqual(['#0800-A', '#0800-B']);
  });
});
