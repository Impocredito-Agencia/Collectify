import { WhatsappDeliveryStatus } from './whatsappDeliveryStatus.enum';
import { computeDeliveryHealth } from './whatsappDeliveryHealth';

describe('computeDeliveryHealth', () => {
  it('returns an all-null, not-blocked result when there are no outbound events yet', () => {
    expect(computeDeliveryHealth([])).toEqual({
      lastDeliveryStatus: null,
      lastErrorCode: null,
      lastErrorTitle: null,
      possiblyBlocked: false,
    });
  });

  it('is not blocked after a single successful delivery', () => {
    const result = computeDeliveryHealth([
      {
        deliveryStatus: WhatsappDeliveryStatus.Delivered,
        errorCode: null,
        errorTitle: null,
      },
    ]);

    expect(result).toEqual({
      lastDeliveryStatus: WhatsappDeliveryStatus.Delivered,
      lastErrorCode: null,
      lastErrorTitle: null,
      possiblyBlocked: false,
    });
  });

  it('is not blocked after a single one-off failure with no known error code', () => {
    const result = computeDeliveryHealth([
      {
        deliveryStatus: WhatsappDeliveryStatus.Failed,
        errorCode: 500,
        errorTitle: 'Internal Server Error',
      },
      {
        deliveryStatus: WhatsappDeliveryStatus.Read,
        errorCode: null,
        errorTitle: null,
      },
    ]);

    expect(result.possiblyBlocked).toBe(false);
  });

  it('is blocked when the most recent failure carries a known undeliverable error code', () => {
    const result = computeDeliveryHealth([
      {
        deliveryStatus: WhatsappDeliveryStatus.Failed,
        errorCode: 131026,
        errorTitle: 'Message Undeliverable',
      },
    ]);

    expect(result).toEqual({
      lastDeliveryStatus: WhatsappDeliveryStatus.Failed,
      lastErrorCode: 131026,
      lastErrorTitle: 'Message Undeliverable',
      possiblyBlocked: true,
    });
  });

  it.each([131047, 470])(
    'is blocked for known undeliverable code %i as well',
    (code) => {
      const result = computeDeliveryHealth([
        {
          deliveryStatus: WhatsappDeliveryStatus.Failed,
          errorCode: code,
          errorTitle: 'x',
        },
      ]);

      expect(result.possiblyBlocked).toBe(true);
    },
  );

  it('is blocked after 3 consecutive failures even with no error code at all', () => {
    const result = computeDeliveryHealth([
      {
        deliveryStatus: WhatsappDeliveryStatus.Failed,
        errorCode: null,
        errorTitle: null,
      },
      {
        deliveryStatus: WhatsappDeliveryStatus.Failed,
        errorCode: null,
        errorTitle: null,
      },
      {
        deliveryStatus: WhatsappDeliveryStatus.Failed,
        errorCode: null,
        errorTitle: null,
      },
    ]);

    expect(result.possiblyBlocked).toBe(true);
  });

  it('is not blocked after only 2 consecutive failures with no known error code', () => {
    const result = computeDeliveryHealth([
      {
        deliveryStatus: WhatsappDeliveryStatus.Failed,
        errorCode: null,
        errorTitle: null,
      },
      {
        deliveryStatus: WhatsappDeliveryStatus.Failed,
        errorCode: null,
        errorTitle: null,
      },
      {
        deliveryStatus: WhatsappDeliveryStatus.Delivered,
        errorCode: null,
        errorTitle: null,
      },
    ]);

    expect(result.possiblyBlocked).toBe(false);
  });

  it('stops counting consecutive failures at the first non-failed event', () => {
    const result = computeDeliveryHealth([
      {
        deliveryStatus: WhatsappDeliveryStatus.Failed,
        errorCode: null,
        errorTitle: null,
      },
      {
        deliveryStatus: WhatsappDeliveryStatus.Delivered,
        errorCode: null,
        errorTitle: null,
      },
      {
        deliveryStatus: WhatsappDeliveryStatus.Failed,
        errorCode: null,
        errorTitle: null,
      },
      {
        deliveryStatus: WhatsappDeliveryStatus.Failed,
        errorCode: null,
        errorTitle: null,
      },
    ]);

    expect(result.possiblyBlocked).toBe(false);
  });

  it('treats a null deliveryStatus (no webhook callback received yet) as not a failure', () => {
    const result = computeDeliveryHealth([
      { deliveryStatus: null, errorCode: null, errorTitle: null },
    ]);

    expect(result).toEqual({
      lastDeliveryStatus: null,
      lastErrorCode: null,
      lastErrorTitle: null,
      possiblyBlocked: false,
    });
  });
});
