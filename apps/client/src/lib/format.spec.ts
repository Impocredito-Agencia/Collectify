import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { calculateAge } from '@/lib/format';

describe('calculateAge', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-08T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('counts a full year once the birthday has already passed this year', () => {
    expect(calculateAge('1990-05-15')).toBe(36);
  });

  it('does not count this year yet when the birthday has not happened', () => {
    expect(calculateAge('1990-12-25')).toBe(35);
  });

  it('counts the birthday itself as already turned', () => {
    expect(calculateAge('1990-09-08')).toBe(36);
  });
});
