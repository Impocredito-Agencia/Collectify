import { describe, expect, it } from 'vitest';

import {
  formatTimeOfDay,
  minuteOptions,
  toHour12,
  toHour24,
} from '@/lib/timeOfDay';

describe('toHour12 / toHour24', () => {
  it.each([
    [0, 12, 'am'],
    [9, 9, 'am'],
    [11, 11, 'am'],
    [12, 12, 'pm'],
    [13, 1, 'pm'],
    [23, 11, 'pm'],
  ] as const)('%i ↔ %i %s', (hour24, hour, period) => {
    expect(toHour12(hour24)).toEqual({ hour, period });
    expect(toHour24({ hour, period })).toBe(hour24);
  });
});

describe('formatTimeOfDay', () => {
  it('formats like es-CO, zero-padded', () => {
    expect(formatTimeOfDay(9, 0)).toBe('09:00 a. m.');
    expect(formatTimeOfDay(0, 5)).toBe('12:05 a. m.');
    expect(formatTimeOfDay(12, 30)).toBe('12:30 p. m.');
    expect(formatTimeOfDay(18, 45)).toBe('06:45 p. m.');
  });
});

describe('minuteOptions', () => {
  it('lists every step', () => {
    expect(minuteOptions(15, 30)).toEqual([0, 15, 30, 45]);
    expect(minuteOptions(5, 0)).toHaveLength(12);
  });

  it('adds an off-grid current minute in order', () => {
    expect(minuteOptions(15, 7)).toEqual([0, 7, 15, 30, 45]);
  });
});
