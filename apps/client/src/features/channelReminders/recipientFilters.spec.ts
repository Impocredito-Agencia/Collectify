import { describe, expect, it } from 'vitest';

import {
  filterRecipients,
  isSelected,
} from '@/features/channelReminders/recipientFilters';

import type { ChannelRecipient } from '@/features/channelReminders/channelRemindersApi';

function recipient(overrides: Partial<ChannelRecipient>): ChannelRecipient {
  return {
    clientId: 'a',
    fullName: 'Juana Pérez',
    documentNumber: '1085',
    phoneNumber: '+573001111111',
    email: null,
    maxOverdueDays: 10,
    overdueInstallments: 1,
    emailRemindersEnabled: false,
    smsRemindersEnabled: false,
    emailUndeliverableAt: null,
    emailUndeliverableReason: null,
    smsUndeliverablePhoneNumbers: [],
    ...overrides,
  };
}

const NONE = { search: '', view: 'all' as const, minOverdueDays: 0 };

describe('filterRecipients', () => {
  const list = [
    recipient({ clientId: 'a', maxOverdueDays: 45, smsRemindersEnabled: true }),
    recipient({
      clientId: 'b',
      fullName: 'Andrés Gómez',
      documentNumber: '9921',
      maxOverdueDays: 12,
    }),
    recipient({
      clientId: 'c',
      fullName: 'Carla Ruiz',
      maxOverdueDays: null,
      emailRemindersEnabled: true,
    }),
  ];

  it('keeps everything, in order, with no filter', () => {
    expect(filterRecipients(list, NONE).map((r) => r.clientId)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('searches names without accents or case, and document numbers', () => {
    expect(
      filterRecipients(list, { ...NONE, search: 'ANDRES' }).map(
        (r) => r.clientId,
      ),
    ).toEqual(['b']);
    expect(
      filterRecipients(list, { ...NONE, search: '992' }).map((r) => r.clientId),
    ).toEqual(['b']);
  });

  it('shows only clients with a channel on', () => {
    expect(
      filterRecipients(list, { ...NONE, view: 'selected' }).map(
        (r) => r.clientId,
      ),
    ).toEqual(['a', 'c']);
  });

  it('applies a minimum of days overdue, dropping clients with none', () => {
    expect(
      filterRecipients(list, { ...NONE, minOverdueDays: 30 }).map(
        (r) => r.clientId,
      ),
    ).toEqual(['a']);
  });
});

describe('isSelected', () => {
  it('is true when either channel is on', () => {
    expect(isSelected(recipient({}))).toBe(false);
    expect(isSelected(recipient({ emailRemindersEnabled: true }))).toBe(true);
  });
});
