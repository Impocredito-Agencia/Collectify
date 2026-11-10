import { MessageChannel } from '../messageChannel.enum';
import { WhatsappDeliveryStatus } from '../whatsappDeliveryStatus.enum';

import {
  extractEmailEvents,
  extractSmsEvents,
  nextDeliveryStatus,
  providerMessageIdCandidates,
} from './brevoWebhookEvents';

const MESSAGE_ID = '<202611091200.123456@smtp-relay.mailin.fr>';

function emailEvent(event: string, extra: Record<string, unknown> = {}) {
  return {
    event,
    email: 'Juana@Example.com',
    id: 1234,
    date: '2026-11-09 18:00:00',
    ts_event: 1794247200,
    'message-id': MESSAGE_ID,
    ...extra,
  };
}

function smsEvent(msgStatus: string, extra: Record<string, unknown> = {}) {
  return {
    id: 5678,
    to: '573001234567',
    messageId: 1511882900100020,
    msg_status: msgStatus,
    ts_event: 1794247200,
    ...extra,
  };
}

describe('extractEmailEvents', () => {
  it.each([
    ['request', WhatsappDeliveryStatus.Sent],
    ['delivered', WhatsappDeliveryStatus.Delivered],
    ['opened', WhatsappDeliveryStatus.Read],
    ['unique_opened', WhatsappDeliveryStatus.Read],
    ['click', WhatsappDeliveryStatus.Read],
    ['proxy_open', WhatsappDeliveryStatus.Read],
  ])('maps %s to %s, with no reason and no block', (event, status) => {
    expect(extractEmailEvents(emailEvent(event))).toEqual([
      {
        channel: MessageChannel.Email,
        providerMessageId: MESSAGE_ID,
        recipient: 'juana@example.com',
        event,
        deliveryStatus: status,
        blocksContact: false,
        reason: null,
        occurredAt: new Date(1794247200 * 1000),
      },
    ]);
  });

  it.each(['hard_bounce', 'invalid_email', 'blocked'])(
    '%s fails the message and blocks the address',
    (event) => {
      const [parsed] = extractEmailEvents(
        emailEvent(event, { reason: 'mailbox does not exist' }),
      );
      expect(parsed).toMatchObject({
        deliveryStatus: WhatsappDeliveryStatus.Failed,
        blocksContact: true,
        reason: `${event}: mailbox does not exist`,
      });
    },
  );

  it.each(['spam', 'unsubscribed'])(
    '%s blocks the address without touching the delivery status',
    (event) => {
      const [parsed] = extractEmailEvents(emailEvent(event));
      expect(parsed).toMatchObject({
        deliveryStatus: null,
        blocksContact: true,
        reason: event,
      });
    },
  );

  it.each(['soft_bounce', 'deferred'])(
    '%s only records the reason (transient)',
    (event) => {
      const [parsed] = extractEmailEvents(
        emailEvent(event, { reason: 'server is down' }),
      );
      expect(parsed).toMatchObject({
        deliveryStatus: null,
        blocksContact: false,
        reason: `${event}: server is down`,
      });
    },
  );

  it('fails a Brevo-side error without blocking the address', () => {
    expect(extractEmailEvents(emailEvent('error'))[0]).toMatchObject({
      deliveryStatus: WhatsappDeliveryStatus.Failed,
      blocksContact: false,
    });
  });

  it('accepts a batch and skips unknown, malformed or id-less events', () => {
    const events = extractEmailEvents([
      emailEvent('delivered'),
      emailEvent('list_addition'),
      { event: 'delivered' },
      'garbage',
      null,
      emailEvent('opened'),
    ]);
    expect(events.map((e) => e.event)).toEqual(['delivered', 'opened']);
  });

  it('falls back to ts_epoch, then to now, for the time', () => {
    const [withEpoch] = extractEmailEvents(
      emailEvent('delivered', { ts_event: undefined, ts_epoch: 1794247200123 }),
    );
    expect(withEpoch.occurredAt).toEqual(new Date(1794247200123));
    const [withNothing] = extractEmailEvents(
      emailEvent('delivered', { ts_event: undefined }),
    );
    expect(withNothing.occurredAt).toBeInstanceOf(Date);
  });
});

describe('extractSmsEvents', () => {
  it.each([
    ['sent', WhatsappDeliveryStatus.Sent],
    ['accepted', WhatsappDeliveryStatus.Sent],
    ['delivered', WhatsappDeliveryStatus.Delivered],
  ])('maps %s to %s', (status, deliveryStatus) => {
    expect(extractSmsEvents(smsEvent(status))[0]).toMatchObject({
      channel: MessageChannel.Sms,
      providerMessageId: '1511882900100020',
      recipient: '+573001234567',
      deliveryStatus,
      blocksContact: false,
      reason: null,
    });
  });

  it.each(['hard_bounce', 'bl'])(
    '%s fails the message and blocks the number',
    (status) => {
      expect(
        extractSmsEvents(
          smsEvent(status, { bounce_type: 'hard', error_code: 21 }),
        )[0],
      ).toMatchObject({
        deliveryStatus: WhatsappDeliveryStatus.Failed,
        blocksContact: true,
        reason: `${status}: hard, 21`,
      });
    },
  );

  it('blocks the number on STOP without touching the delivery status', () => {
    expect(extractSmsEvents(smsEvent('unsubscribed'))[0]).toMatchObject({
      deliveryStatus: null,
      blocksContact: true,
    });
  });

  it('fails a rejected SMS without blocking the number', () => {
    expect(extractSmsEvents(smsEvent('rej'))[0]).toMatchObject({
      deliveryStatus: WhatsappDeliveryStatus.Failed,
      blocksContact: false,
    });
  });

  it('ignores skip / replied / subscribe and a zero messageId', () => {
    expect(
      extractSmsEvents([
        smsEvent('skip'),
        smsEvent('replied'),
        smsEvent('subscribe'),
        smsEvent('delivered', { messageId: 0 }),
      ]),
    ).toEqual([]);
  });
});

describe('nextDeliveryStatus', () => {
  const { Sent, Delivered, Read, Failed } = WhatsappDeliveryStatus;

  it('moves forward only', () => {
    expect(nextDeliveryStatus(null, Sent)).toBe(Sent);
    expect(nextDeliveryStatus(Sent, Delivered)).toBe(Delivered);
    expect(nextDeliveryStatus(Delivered, Read)).toBe(Read);
    expect(nextDeliveryStatus(Sent, Failed)).toBe(Failed);
  });

  it('never downgrades, so repeated or late events change nothing', () => {
    expect(nextDeliveryStatus(Delivered, Sent)).toBeNull();
    expect(nextDeliveryStatus(Delivered, Delivered)).toBeNull();
    expect(nextDeliveryStatus(Read, Failed)).toBeNull();
    expect(nextDeliveryStatus(Failed, Sent)).toBeNull();
  });
});

describe('providerMessageIdCandidates', () => {
  it('matches an email id with or without its angle brackets', () => {
    expect(
      providerMessageIdCandidates(MessageChannel.Email, MESSAGE_ID).sort(),
    ).toEqual([MESSAGE_ID, '202611091200.123456@smtp-relay.mailin.fr'].sort());
    expect(
      providerMessageIdCandidates(MessageChannel.Email, 'abc@relay'),
    ).toContain('<abc@relay>');
  });

  it('uses an SMS id as is', () => {
    expect(providerMessageIdCandidates(MessageChannel.Sms, '42')).toEqual([
      '42',
    ]);
  });
});
