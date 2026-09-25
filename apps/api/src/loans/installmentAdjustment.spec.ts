import {
  isInstallmentAdjustmentAllowed,
  normalizePromissoryNoteNumber,
} from './installmentAdjustment';

describe('normalizePromissoryNoteNumber', () => {
  it('strips the leading # and zero padding', () => {
    expect(normalizePromissoryNoteNumber('#0965')).toBe('965');
  });

  it('treats a bare number the same as the stored form', () => {
    expect(normalizePromissoryNoteNumber('965')).toBe(
      normalizePromissoryNoteNumber('#0965'),
    );
  });

  it('trims surrounding whitespace', () => {
    expect(normalizePromissoryNoteNumber('  #1113 ')).toBe('1113');
  });

  it('keeps an all-zero number instead of reducing it to an empty string', () => {
    expect(normalizePromissoryNoteNumber('#000')).toBe('000');
  });
});

describe('isInstallmentAdjustmentAllowed', () => {
  it('allows a listed pagaré while the flag is on', () => {
    expect(
      isInstallmentAdjustmentAllowed('#0965', {
        installmentAdjustmentEnabled: true,
        installmentAdjustmentPromissoryNotes: ['965', '1113'],
      }),
    ).toBe(true);
  });

  it('refuses a listed pagaré while the flag is off', () => {
    expect(
      isInstallmentAdjustmentAllowed('#0965', {
        installmentAdjustmentEnabled: false,
        installmentAdjustmentPromissoryNotes: ['965'],
      }),
    ).toBe(false);
  });

  it('refuses a pagaré that is not listed, even with the flag on', () => {
    expect(
      isInstallmentAdjustmentAllowed('#0966', {
        installmentAdjustmentEnabled: true,
        installmentAdjustmentPromissoryNotes: ['965', '1113'],
      }),
    ).toBe(false);
  });

  it('refuses everything when the list is empty, even with the flag on', () => {
    expect(
      isInstallmentAdjustmentAllowed('#0965', {
        installmentAdjustmentEnabled: true,
        installmentAdjustmentPromissoryNotes: [],
      }),
    ).toBe(false);
  });
});
