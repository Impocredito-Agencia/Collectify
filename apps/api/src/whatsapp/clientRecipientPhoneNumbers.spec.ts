import { getRecipientPhoneNumbers } from './clientRecipientPhoneNumbers';

describe('getRecipientPhoneNumbers', () => {
  it('returns just the primary number when there is no alternate', () => {
    expect(
      getRecipientPhoneNumbers({
        phoneNumber: '+573001234567',
        alternatePhoneNumber: null,
      }),
    ).toEqual(['+573001234567']);
  });

  it('returns both numbers when an alternate is set', () => {
    expect(
      getRecipientPhoneNumbers({
        phoneNumber: '+573001234567',
        alternatePhoneNumber: '+573009876543',
      }),
    ).toEqual(['+573001234567', '+573009876543']);
  });

  // Defensive — shouldn't happen given phoneNumber/alternatePhoneNumber
  // are validated independently, but a client somehow entered with the
  // same number in both fields must never get double-sent.
  it('dedupes when both fields hold the same number', () => {
    expect(
      getRecipientPhoneNumbers({
        phoneNumber: '+573001234567',
        alternatePhoneNumber: '+573001234567',
      }),
    ).toEqual(['+573001234567']);
  });
});
