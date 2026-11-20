import type { ChannelRecipient } from '@/features/channelReminders/channelRemindersApi';

export type RecipientView = 'all' | 'selected';

export interface RecipientFilters {
  search: string;
  view: RecipientView;
  // Only clients at least this many days overdue; 0 = no minimum.
  minOverdueDays: number;
}

function normalize(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
}

export function isSelected(recipient: ChannelRecipient): boolean {
  return recipient.emailRemindersEnabled || recipient.smsRemindersEnabled;
}

// Keeps the api's order (most days of mora first). Search matches name or
// document number, ignoring accents and case.
export function filterRecipients(
  recipients: ChannelRecipient[],
  filters: RecipientFilters,
): ChannelRecipient[] {
  const search = normalize(filters.search);
  return recipients.filter((recipient) => {
    if (filters.view === 'selected' && !isSelected(recipient)) {
      return false;
    }
    if (
      filters.minOverdueDays > 0 &&
      (recipient.maxOverdueDays ?? 0) < filters.minOverdueDays
    ) {
      return false;
    }
    if (!search) {
      return true;
    }
    return (
      normalize(recipient.fullName).includes(search) ||
      recipient.documentNumber.includes(search)
    );
  });
}
