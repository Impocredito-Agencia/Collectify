import { WhatsappDeliveryStatus } from '../whatsappDeliveryStatus.enum';

import { extractStatusEvents } from './extractStatusEvents';

function buildPayload(statuses: unknown[]) {
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
              statuses,
            },
          },
        ],
      },
    ],
  };
}

describe('extractStatusEvents', () => {
  it('parses a delivered status', () => {
    const payload = buildPayload([
      {
        id: 'wamid.SOME_ID',
        status: 'delivered',
        timestamp: '1700000000',
        recipient_id: '573001234567',
      },
    ]);

    const events = extractStatusEvents(payload);

    expect(events).toEqual([
      {
        whatsappMessageId: 'wamid.SOME_ID',
        status: WhatsappDeliveryStatus.Delivered,
        timestamp: new Date(1700000000 * 1000),
        errorCode: null,
        errorTitle: null,
      },
    ]);
  });

  it.each([
    ['sent', WhatsappDeliveryStatus.Sent],
    ['delivered', WhatsappDeliveryStatus.Delivered],
    ['read', WhatsappDeliveryStatus.Read],
    ['failed', WhatsappDeliveryStatus.Failed],
  ])('maps Meta status "%s" to %s', (metaStatus, expected) => {
    const payload = buildPayload([
      { id: 'wamid.SOME_ID', status: metaStatus, timestamp: '1700000000' },
    ]);

    const events = extractStatusEvents(payload);

    expect(events[0].status).toBe(expected);
  });

  it('extracts the first error code/title on a failed status', () => {
    const payload = buildPayload([
      {
        id: 'wamid.SOME_ID',
        status: 'failed',
        timestamp: '1700000000',
        errors: [
          {
            code: 131026,
            title: 'Message Undeliverable',
            message: 'unable to deliver',
          },
        ],
      },
    ]);

    const events = extractStatusEvents(payload);

    expect(events[0]).toMatchObject({
      errorCode: 131026,
      errorTitle: 'Message Undeliverable',
    });
  });

  it('leaves errorCode/errorTitle null when there is no errors array', () => {
    const payload = buildPayload([
      { id: 'wamid.SOME_ID', status: 'sent', timestamp: '1700000000' },
    ]);

    const events = extractStatusEvents(payload);

    expect(events[0]).toMatchObject({ errorCode: null, errorTitle: null });
  });

  it('falls back to the current time for a malformed timestamp', () => {
    const before = Date.now();
    const payload = buildPayload([
      { id: 'wamid.SOME_ID', status: 'sent', timestamp: 'not-a-number' },
    ]);

    const events = extractStatusEvents(payload);

    expect(events[0].timestamp.getTime()).toBeGreaterThanOrEqual(before);
  });

  it('skips a status with no id', () => {
    const payload = buildPayload([{ status: 'sent', timestamp: '1700000000' }]);

    expect(extractStatusEvents(payload)).toEqual([]);
  });

  it('skips a status with an unrecognized status value', () => {
    const payload = buildPayload([
      {
        id: 'wamid.SOME_ID',
        status: 'deleted',
        timestamp: '1700000000',
      },
    ]);

    expect(extractStatusEvents(payload)).toEqual([]);
  });

  it('parses multiple statuses across entries/changes', () => {
    const payload = {
      entry: [
        {
          changes: [
            {
              value: {
                statuses: [
                  { id: 'wamid.ONE', status: 'sent', timestamp: '1700000000' },
                ],
              },
            },
          ],
        },
        {
          changes: [
            {
              value: {
                statuses: [
                  {
                    id: 'wamid.TWO',
                    status: 'read',
                    timestamp: '1700000100',
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    const events = extractStatusEvents(payload);

    expect(events.map((e) => e.whatsappMessageId)).toEqual([
      'wamid.ONE',
      'wamid.TWO',
    ]);
  });

  it('never throws for a malformed payload', () => {
    expect(extractStatusEvents({ entry: 'not-an-array' })).toEqual([]);
    expect(extractStatusEvents(null)).toEqual([]);
    expect(extractStatusEvents(undefined)).toEqual([]);
    expect(extractStatusEvents('a string')).toEqual([]);
  });

  it('returns an empty array when there are no statuses (e.g. a messages-only payload)', () => {
    const payload = {
      entry: [
        {
          changes: [
            {
              value: { messages: [{ from: '573001234567' }] },
            },
          ],
        },
      ],
    };

    expect(extractStatusEvents(payload)).toEqual([]);
  });
});
