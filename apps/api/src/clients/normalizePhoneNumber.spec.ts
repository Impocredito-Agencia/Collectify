import { normalizePhoneNumber } from './normalizePhoneNumber';

describe('normalizePhoneNumber', () => {
  it('leaves an already-E.164 number unchanged', () => {
    expect(normalizePhoneNumber('+573001234567')).toBe('+573001234567');
  });

  it('adds the +57 country code to a bare 10-digit local number', () => {
    // The exact bug reported 2026-09-06: a client imported from Excel as
    // "3218204455" (typed with no country code) was stored exactly like
    // that, inconsistent with manually-created clients stored as E.164.
    expect(normalizePhoneNumber('3218204455')).toBe('+573218204455');
  });

  it('strips spaces before normalizing', () => {
    expect(normalizePhoneNumber('+57 321 940 2299')).toBe('+573219402299');
  });

  it('strips dashes before normalizing', () => {
    expect(normalizePhoneNumber('321-940-2299')).toBe('+573219402299');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizePhoneNumber('  3001234567  ')).toBe('+573001234567');
  });

  it('returns an empty string unchanged', () => {
    expect(normalizePhoneNumber('')).toBe('');
  });

  it('returns non-string values unchanged (lets class-validator reject them)', () => {
    expect(normalizePhoneNumber(undefined)).toBeUndefined();
    expect(normalizePhoneNumber(12345)).toBe(12345);
  });

  it('returns an unparseable value trimmed but otherwise unchanged, leaving @IsPhoneNumber to reject it', () => {
    expect(normalizePhoneNumber('not-a-phone-number')).toBe(
      'not-a-phone-number',
    );
  });
});
