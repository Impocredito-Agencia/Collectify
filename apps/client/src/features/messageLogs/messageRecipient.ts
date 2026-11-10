import { formatPhoneNumber } from '@/lib/format';

import { MessageChannel } from '@/features/messageLogs/messageLogsApi';

import type { MessageLog } from '@/features/messageLogs/messageLogsApi';

// Phase 36 — who a message went to: the email for an email row, the
// formatted phone for WhatsApp/SMS.
export function formatMessageRecipient(
  log: Pick<MessageLog, 'channel' | 'phoneNumber' | 'email'>,
): string {
  if (log.channel === MessageChannel.Email) {
    return log.email ?? '—';
  }
  return log.phoneNumber ? formatPhoneNumber(log.phoneNumber) : '—';
}
