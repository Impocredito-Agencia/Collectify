import { WhatsappInboundMessageType } from '../entities/whatsappInboundMessage.entity';

import { extractInboundEvents } from './extractInboundEvents';

function buildPayload(messages: unknown[]) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'waba-1',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              messages,
            },
          },
        ],
      },
    ],
  };
}

describe('extractInboundEvents', () => {
  it('parses a template quick-reply button tap (type "button")', () => {
    const payload = buildPayload([
      {
        from: '573001234567',
        timestamp: '1700000000',
        type: 'button',
        button: { payload: 'send_account_summary', text: 'Sí' },
      },
    ]);

    const events = extractInboundEvents(payload);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      fromPhoneNumber: '573001234567',
      type: WhatsappInboundMessageType.Button,
      buttonPayload: 'send_account_summary',
      bodyText: 'Sí',
    });
    expect(events[0].receivedAt).toEqual(new Date(1700000000 * 1000));
    expect(events[0].contextMessageId).toBeNull();
  });

  // Bug fix, 2026-09-03 (human report): "Más información" replied with the
  // client's whole account instead of just the pagaré/installment the
  // reminder was about — fixed by tracing the tap back to the exact
  // reminder via this context id.
  it('extracts context.id from a quick-reply button tap replying to a template message', () => {
    const payload = buildPayload([
      {
        from: '573001234567',
        timestamp: '1700000000',
        type: 'button',
        context: { from: '15550001111', id: 'wamid.ORIGINAL_REMINDER' },
        button: { payload: 'Más información', text: 'Más información' },
      },
    ]);

    const events = extractInboundEvents(payload);

    expect(events[0].contextMessageId).toBe('wamid.ORIGINAL_REMINDER');
  });

  it('parses a session interactive button_reply (type "interactive")', () => {
    const payload = buildPayload([
      {
        from: '573001234567',
        timestamp: '1700000000',
        type: 'interactive',
        interactive: {
          type: 'button_reply',
          button_reply: { id: 'yes_payload', title: 'Sí' },
        },
      },
    ]);

    const events = extractInboundEvents(payload);

    expect(events[0]).toMatchObject({
      type: WhatsappInboundMessageType.Button,
      buttonPayload: 'yes_payload',
      bodyText: 'Sí',
    });
  });

  it('parses plain free text (type "text")', () => {
    const payload = buildPayload([
      {
        from: '573001234567',
        timestamp: '1700000000',
        type: 'text',
        text: { body: 'Hola, tengo una pregunta' },
      },
    ]);

    const events = extractInboundEvents(payload);

    expect(events[0]).toMatchObject({
      type: WhatsappInboundMessageType.Text,
      buttonPayload: null,
      bodyText: 'Hola, tengo una pregunta',
    });
  });

  it('maps an unrecognized message type to "other" instead of dropping it', () => {
    const payload = buildPayload([
      {
        from: '573001234567',
        timestamp: '1700000000',
        type: 'sticker',
        sticker: { id: 'abc' },
      },
    ]);

    const events = extractInboundEvents(payload);

    expect(events[0]).toMatchObject({
      type: WhatsappInboundMessageType.Other,
      buttonPayload: null,
      bodyText: null,
    });
  });

  it('extracts multiple messages from a single payload', () => {
    const payload = buildPayload([
      {
        from: '573001111111',
        timestamp: '1700000000',
        type: 'text',
        text: { body: 'a' },
      },
      {
        from: '573002222222',
        timestamp: '1700000001',
        type: 'text',
        text: { body: 'b' },
      },
    ]);

    expect(extractInboundEvents(payload)).toHaveLength(2);
  });

  it('skips a message with no "from" field rather than throwing', () => {
    const payload = buildPayload([
      { timestamp: '1700000000', type: 'text', text: { body: 'no sender' } },
    ]);

    expect(extractInboundEvents(payload)).toEqual([]);
  });

  it('falls back to now() when the timestamp is malformed', () => {
    const payload = buildPayload([
      {
        from: '573001234567',
        timestamp: 'not-a-number',
        type: 'text',
        text: { body: 'x' },
      },
    ]);

    const before = Date.now();
    const events = extractInboundEvents(payload);
    const after = Date.now();

    expect(events[0].receivedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(events[0].receivedAt.getTime()).toBeLessThanOrEqual(after);
  });

  it('returns an empty array for null, non-object, or completely unexpected payloads', () => {
    expect(extractInboundEvents(null)).toEqual([]);
    expect(extractInboundEvents('not an object')).toEqual([]);
    expect(extractInboundEvents(42)).toEqual([]);
    expect(extractInboundEvents({})).toEqual([]);
    expect(extractInboundEvents({ entry: 'not-an-array' })).toEqual([]);
    expect(extractInboundEvents({ entry: [{ changes: 'nope' }] })).toEqual([]);
  });
});
