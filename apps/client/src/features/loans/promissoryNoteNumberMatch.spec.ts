import { describe, expect, it } from 'vitest';

import { matchesPromissoryNoteNumber } from './promissoryNoteNumberMatch';

describe('matchesPromissoryNoteNumber', () => {
  it.each([
    ['#0800', '#0800'],
    ['0800', '#0800'],
    ['  #0800 ', '#0800'],
    ['#743', '743'],
  ])('accepts %s for %s', (typed, actual) => {
    expect(matchesPromissoryNoteNumber(typed, actual)).toBe(true);
  });

  it.each([
    ['#800', '#0800'],
    ['#1200', '#1201'],
    ['', '#0800'],
    ['#', '#0800'],
    ['##0800', '#0800'],
  ])('rejects %s for %s', (typed, actual) => {
    expect(matchesPromissoryNoteNumber(typed, actual)).toBe(false);
  });
});
