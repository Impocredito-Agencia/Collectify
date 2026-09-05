import { describe, expect, it } from 'vitest';

// buildPageWindow itself moved to buildPageWindow.ts (2026-09-05, ESLint
// react-refresh/only-export-components fix) — kept this test file's name
// as-is since it's just importing from a different local module now, not
// worth an unrunnable delete+recreate for a rename alone.
import { buildPageWindow } from './buildPageWindow';

describe('buildPageWindow', () => {
  it('returns every page when there are 5 or fewer total', () => {
    expect(buildPageWindow(1, 3)).toEqual([1, 2, 3]);
  });

  it('starts the window at 1 when on the first page', () => {
    expect(buildPageWindow(1, 20)).toEqual([1, 2, 3, 4, 5]);
  });

  it('centers the window on the current page', () => {
    expect(buildPageWindow(5, 20)).toEqual([3, 4, 5, 6, 7]);
  });

  it('clamps the window to end at the last page', () => {
    expect(buildPageWindow(20, 20)).toEqual([16, 17, 18, 19, 20]);
  });

  it('never exceeds the total page count as the window size', () => {
    expect(buildPageWindow(2, 2)).toEqual([1, 2]);
  });
});
