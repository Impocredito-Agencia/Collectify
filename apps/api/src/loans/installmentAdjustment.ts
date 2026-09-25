import type { LoansConfig } from '../config/configuration';

// Pagarés are stored with a leading "#" and sometimes zero-padded
// ("#0965"), while whoever fills in the env var may type "965", "0965" or
// "#0965" — all three must match the same loan, or a correction silently
// fails to unlock.
export function normalizePromissoryNoteNumber(value: string): string {
  const withoutPrefix = value.trim().replace(/^#/, '').trim();
  const withoutLeadingZeros = withoutPrefix.replace(/^0+/, '');
  return withoutLeadingZeros.length > 0 ? withoutLeadingZeros : withoutPrefix;
}

// See LoansConfig's comment — both the flag and the pagaré list have to
// allow it; either one alone is never enough.
export function isInstallmentAdjustmentAllowed(
  promissoryNoteNumber: string,
  config: LoansConfig,
): boolean {
  if (!config.installmentAdjustmentEnabled) {
    return false;
  }
  const target = normalizePromissoryNoteNumber(promissoryNoteNumber);
  return config.installmentAdjustmentPromissoryNotes.some(
    (listed) => normalizePromissoryNoteNumber(listed) === target,
  );
}
