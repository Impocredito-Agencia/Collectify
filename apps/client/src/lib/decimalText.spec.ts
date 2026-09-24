import { describe, expect, it } from 'vitest';

import {
  parseDecimalText,
  reconcileDecimalText,
  sanitizeDecimalText,
} from './decimalText';

describe('sanitizeDecimalText', () => {
  it('accepts digits and a single dot', () => {
    expect(sanitizeDecimalText('2.4')).toBe('2.4');
    expect(sanitizeDecimalText('2.')).toBe('2.');
    expect(sanitizeDecimalText('.5')).toBe('.5');
    expect(sanitizeDecimalText('03.1')).toBe('03.1');
  });

  it('turns a comma into a dot', () => {
    expect(sanitizeDecimalText('2,4')).toBe('2.4');
    expect(sanitizeDecimalText('2,')).toBe('2.');
  });

  it('accepts an empty field', () => {
    expect(sanitizeDecimalText('')).toBe('');
  });

  it('rejects anything that is not a plain non-negative decimal', () => {
    expect(sanitizeDecimalText('2.4.5')).toBeNull();
    expect(sanitizeDecimalText('2,4,5')).toBeNull();
    expect(sanitizeDecimalText('-3')).toBeNull();
    expect(sanitizeDecimalText('abc')).toBeNull();
    expect(sanitizeDecimalText('1e3')).toBeNull();
  });
});

describe('parseDecimalText', () => {
  it('parses complete and in-progress numbers', () => {
    expect(parseDecimalText('2.4')).toBe(2.4);
    expect(parseDecimalText('2.')).toBe(2);
    expect(parseDecimalText('.5')).toBe(0.5);
    expect(parseDecimalText('03.1')).toBe(3.1);
    expect(parseDecimalText('0')).toBe(0);
  });

  it('returns empty for nothing usable', () => {
    expect(parseDecimalText('')).toBe('');
    expect(parseDecimalText('.')).toBe('');
  });
});

describe('reconcileDecimalText', () => {
  it('keeps the typed text when it already means the value', () => {
    expect(reconcileDecimalText('2.', 2)).toBe('2.');
    expect(reconcileDecimalText('03.1', 3.1)).toBe('03.1');
    expect(reconcileDecimalText('', '')).toBe('');
  });

  it('follows an outside change', () => {
    expect(reconcileDecimalText('', 2.4)).toBe('2.4');
    expect(reconcileDecimalText('5', '')).toBe('');
    expect(reconcileDecimalText('2.4', 3.1)).toBe('3.1');
  });
});
