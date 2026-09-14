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
        type: 'contacts',
        contacts: [{ name: { formatted_name: 'Alguien' } }],
      },
    ]);

    const events = extractInboundEvents(payload);

    expect(events[0]).toMatchObject({
      type: WhatsappInboundMessageType.Other,
      buttonPayload: null,
      bodyText: null,
    });
  });

  // Human report, 2026-09-11 — a client's payment receipt photo used to
  // render as a bare "—" in the inbox (type "other", no caption), same as
  // any unrecognized event. See WhatsappInboundMessageType's own comment.
  it('parses an image, keeping its caption as bodyText when present', () => {
    const payload = buildPayload([
      {
        from: '573001234567',
        timestamp: '1700000000',
        type: 'image',
        image: {
          id: 'media-1',
          mime_type: 'image/jpeg',
          caption: 'Aquí está mi comprobante',
        },
      },
    ]);

    const events = extractInboundEvents(payload);

    expect(events[0]).toMatchObject({
      type: WhatsappInboundMessageType.Image,
      buttonPayload: null,
      bodyText: 'Aquí está mi comprobante',
    });
  });

  it('parses an image with no caption as bodyText null, not "other"', () => {
    const payload = buildPayload([
      {
        from: '573001234567',
        timestamp: '1700000000',
        type: 'image',
        image: { id: 'media-1', mime_type: 'image/jpeg' },
      },
    ]);

    const events = extractInboundEvents(payload);

    expect(events[0]).toMatchObject({
      type: WhatsappInboundMessageType.Image,
      buttonPayload: null,
      bodyText: null,
    });
  });

  it('parses a document, preferring its caption over its filename', () => {
    const payload = buildPayload([
      {
        from: '573001234567',
        timestamp: '1700000000',
        type: 'document',
        document: {
          id: 'media-2',
          filename: 'comprobante.pdf',
          caption: 'Pago de la cuota 3',
        },
      },
    ]);

    const events = extractInboundEvents(payload);

    expect(events[0]).toMatchObject({
      type: WhatsappInboundMessageType.Document,
      bodyText: 'Pago de la cuota 3',
    });
  });

  it('falls back to the filename when a document has no caption', () => {
    const payload = buildPayload([
      {
        from: '573001234567',
        timestamp: '1700000000',
        type: 'document',
        document: { id: 'media-2', filename: 'comprobante.pdf' },
      },
    ]);

    const events = extractInboundEvents(payload);

    expect(events[0]).toMatchObject({
      type: WhatsappInboundMessageType.Document,
      bodyText: 'comprobante.pdf',
    });
  });

  it('parses audio and stickers with a null bodyText (WhatsApp never offers a caption for either)', () => {
    const audioPayload = buildPayload([
      {
        from: '573001234567',
        timestamp: '1700000000',
        type: 'audio',
        audio: { id: 'media-3', mime_type: 'audio/ogg' },
      },
    ]);
    const stickerPayload = buildPayload([
      {
        from: '573001234567',
        timestamp: '1700000000',
        type: 'sticker',
        sticker: { id: 'media-4', mime_type: 'image/webp' },
      },
    ]);

    expect(extractInboundEvents(audioPayload)[0]).toMatchObject({
      type: WhatsappInboundMessageType.Audio,
      bodyText: null,
    });
    expect(extractInboundEvents(stickerPayload)[0]).toMatchObject({
      type: WhatsappInboundMessageType.Sticker,
      bodyText: null,
    });
  });

  it('parses a video, keeping its caption as bodyText when present', () => {
    const payload = buildPayload([
      {
        from: '573001234567',
        timestamp: '1700000000',
        type: 'video',
        video: { id: 'media-5', caption: 'video del recibo' },
      },
    ]);

    const events = extractInboundEvents(payload);

    expect(events[0]).toMatchObject({
      type: WhatsappInboundMessageType.Video,
      bodyText: 'video del recibo',
    });
  });

  it('parses a shared location, combining name and address when both are present', () => {
    const payload = buildPayload([
      {
        from: '573001234567',
        timestamp: '1700000000',
        type: 'location',
        location: {
          latitude: 1.2136,
          longitude: -77.2811,
          name: 'Mi casa',
          address: 'Cra 1 # 2-3, Pasto',
        },
      },
    ]);

    const events = extractInboundEvents(payload);

    expect(events[0]).toMatchObject({
      type: WhatsappInboundMessageType.Location,
      bodyText: 'Mi casa — Cra 1 # 2-3, Pasto',
    });
  });

  it('falls back to raw coordinates for a shared location with no name or address', () => {
    const payload = buildPayload([
      {
        from: '573001234567',
        timestamp: '1700000000',
        type: 'location',
        location: { latitude: 1.2136, longitude: -77.2811 },
      },
    ]);

    const events = extractInboundEvents(payload);

    expect(events[0]).toMatchObject({
      type: WhatsappInboundMessageType.Location,
      bodyText: '1.2136, -77.2811',
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

  // Human report, 2026-09-11 — added alongside WhatsappMediaService, which
  // needs this id to actually fetch the file from Meta. Widened to
  // audio/video 2026-09-14 (human report — a voice note/video should be
  // playable from the inbox, not just logged). Sticker is deliberately not
  // included — see parseMessage's own comment.
  it('extracts the media id for image/document/audio/video', () => {
    const mediaTypes: [string, Record<string, unknown>][] = [
      ['image', { image: { id: 'media-1', mime_type: 'image/jpeg' } }],
      ['document', { document: { id: 'media-2', filename: 'a.pdf' } }],
      ['audio', { audio: { id: 'media-3', mime_type: 'audio/ogg' } }],
      ['video', { video: { id: 'media-5' } }],
    ];

    for (const [type, fields] of mediaTypes) {
      const payload = buildPayload([
        { from: '573001234567', timestamp: '1700000000', type, ...fields },
      ]);
      expect(extractInboundEvents(payload)[0].mediaId).toBe(
        (fields[type] as { id: string }).id,
      );
    }
  });

  // Human report, 2026-09-11 — sticker is the one media type that keeps
  // its own recognized type (still logged, never dropped, see
  // WhatsappInboundMessageType) but never re-hosts to Cloudinary — a
  // sticker is a tiny reusable emoji-like image, never something a
  // cobrador needs to review. Everything else here just has no file to
  // fetch at all.
  it('leaves the media id null for sticker, text, button, location, and other events', () => {
    const nonMediaPayloads: Record<string, unknown>[] = [
      {
        type: 'sticker',
        sticker: { id: 'media-4', mime_type: 'image/webp' },
      },
      { type: 'text', text: { body: 'hola' } },
      { type: 'button', button: { payload: 'p', text: 'p' } },
      { type: 'location', location: { latitude: 1, longitude: 2 } },
      { type: 'contacts', contacts: [] },
    ];

    for (const fields of nonMediaPayloads) {
      const payload = buildPayload([
        { from: '573001234567', timestamp: '1700000000', ...fields },
      ]);
      expect(extractInboundEvents(payload)[0].mediaId).toBeNull();
    }
  });
});
