import { formatPromissoryNoteLabel } from './promissoryNoteLabel';

describe('formatPromissoryNoteLabel', () => {
  it('adds a leading # to a bare legacy-format number', () => {
    expect(formatPromissoryNoteLabel('743')).toBe('#743');
  });

  it('leaves a number that already carries the # untouched', () => {
    expect(formatPromissoryNoteLabel('#0917')).toBe('#0917');
  });
});
