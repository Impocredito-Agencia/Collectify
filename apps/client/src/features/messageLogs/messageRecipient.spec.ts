import { describe, expect, it } from 'vitest';

import { MessageChannel } from '@/features/messageLogs/messageLogsApi';
import { formatMessageRecipient } from '@/features/messageLogs/messageRecipient';

describe('formatMessageRecipient', () => {
  it('shows the email of an email row', () => {
    expect(
      formatMessageRecipient({
        channel: MessageChannel.Email,
        phoneNumber: null,
        email: 'juana@example.com',
      }),
    ).toBe('juana@example.com');
  });

  it('formats the phone of a WhatsApp or SMS row', () => {
    for (const channel of [MessageChannel.WhatsApp, MessageChannel.Sms]) {
      expect(
        formatMessageRecipient({
          channel,
          phoneNumber: '+573001234567',
          email: null,
        }),
      ).toBe('+57 300 123 4567');
    }
  });

  it('shows a dash when the recipient is missing', () => {
    expect(
      formatMessageRecipient({
        channel: MessageChannel.Sms,
        phoneNumber: null,
        email: null,
      }),
    ).toBe('—');
  });
});
