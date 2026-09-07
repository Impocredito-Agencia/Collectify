import { parsePhoneNumberFromString } from 'libphonenumber-js';

// Canonicalizes any Colombian phone number a human might type (with or
// without "+57", with spaces/dashes, or as a bare 10-digit local number)
// into the single E.164 form this project stores everywhere — see
// docs/DATABASE.md ("clients.phone_number ... E.164 format, e.g.
// +573001234567"). Used as a @Transform on every phoneNumber-shaped DTO
// field so manual creation and Excel import can't produce two different
// stored formats for the same number (2026-09-06 bug report: a manually
// created client showed as "+57 321 940 2299", an Excel-imported one as
// the raw, un-normalized "3218204455" — @IsPhoneNumber('CO') validates a
// number but never rewrites it, so nothing was canonicalizing the value
// before it reached the database).
//
// class-transformer's @Transform runs before class-validator's checks
// under the global ValidationPipe({ transform: true }) in main.ts, and
// plainToInstance() called directly (as ClientsImportService/LoanImport
// do, outside of any HTTP request) applies @Transform the same way — so
// wiring this in once, here, normalizes both the manual-creation and the
// Excel-import paths without touching either of those call sites.
//
// Deliberately permissive on failure: if the value can't be parsed as a
// valid Colombian number, it's returned trimmed but otherwise unchanged.
// @IsPhoneNumber('CO') is what rejects an invalid value — this function's
// only job is to canonicalize values that are already valid, not to
// decide validity itself.
export function normalizePhoneNumber(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return trimmed;
  }
  const parsed = parsePhoneNumberFromString(trimmed, 'CO');
  return parsed?.isValid() ? parsed.number : trimmed;
}
