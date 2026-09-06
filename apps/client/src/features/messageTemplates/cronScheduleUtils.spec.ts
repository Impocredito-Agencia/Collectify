import { describe, expect, it } from 'vitest';

import {
  buildCronExpression,
  DEFAULT_SCHEDULE_CONFIG,
  parseCronExpression,
} from './cronScheduleUtils';

describe('buildCronExpression', () => {
  it('builds an expression firing on a single day of week', () => {
    expect(
      buildCronExpression({
        hour: 9,
        minute: 0,
        daysOfWeek: [5],
      }),
    ).toBe('0 9 * * 5');
  });

  it('builds an expression firing on several days of week, sorted', () => {
    expect(
      buildCronExpression({
        hour: 16,
        minute: 30,
        daysOfWeek: [5, 1, 3],
      }),
    ).toBe('30 16 * * 1,3,5');
  });

  it('builds an expression firing on every day of week', () => {
    expect(buildCronExpression(DEFAULT_SCHEDULE_CONFIG)).toBe(
      '0 9 * * 0,1,2,3,4,5,6',
    );
  });
});

describe('parseCronExpression', () => {
  it('round-trips a single-day expression', () => {
    const config = parseCronExpression('0 8 * * 3');
    expect(config).toMatchObject({ hour: 8, minute: 0, daysOfWeek: [3] });
    expect(config && buildCronExpression(config)).toBe('0 8 * * 3');
  });

  it('round-trips a multi-day expression', () => {
    const config = parseCronExpression('0 16 * * 1,3,5');
    expect(config).toMatchObject({
      hour: 16,
      minute: 0,
      daysOfWeek: [1, 3, 5],
    });
    expect(config && buildCronExpression(config)).toBe('0 16 * * 1,3,5');
  });

  it('parses a wildcarded day-of-week as every day selected', () => {
    const config = parseCronExpression('0 9 * * *');
    expect(config).toMatchObject({ hour: 9, minute: 0 });
    expect(config?.daysOfWeek.sort()).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('returns null for a day-of-month-based expression (old biweekly/monthly shape)', () => {
    expect(parseCronExpression('0 8 1,16 * *')).toBeNull();
    expect(parseCronExpression('0 8 20 * *')).toBeNull();
  });

  it('returns null for null/undefined/empty input', () => {
    expect(parseCronExpression(null)).toBeNull();
    expect(parseCronExpression(undefined)).toBeNull();
    expect(parseCronExpression('')).toBeNull();
  });

  it('returns null for a malformed expression', () => {
    expect(parseCronExpression('not a cron expression')).toBeNull();
  });
});
