import { describe, expect, it } from 'vitest';

import { deliveryStatusLabel } from '@/features/messageLogs/deliveryStatusLabel';
import {
  MessageLogStatus,
  WhatsappDeliveryStatus,
} from '@/features/messageLogs/messageLogsApi';

describe('deliveryStatusLabel', () => {
  it('reports a failed send whatever the provider said', () => {
    expect(
      deliveryStatusLabel({
        status: MessageLogStatus.Failed,
        deliveryStatus: WhatsappDeliveryStatus.Delivered,
      }),
    ).toEqual({ label: 'Fallido', tone: 'danger' });
  });

  it.each([
    [null, 'Enviado', 'success'],
    [WhatsappDeliveryStatus.Sent, 'Enviado', 'success'],
    [WhatsappDeliveryStatus.Delivered, 'Entregado', 'success'],
    [WhatsappDeliveryStatus.Read, 'Leído', 'success'],
    [WhatsappDeliveryStatus.Failed, 'No entregado', 'danger'],
  ])(
    'a sent message with delivery %s reads %s',
    (deliveryStatus, label, tone) => {
      expect(
        deliveryStatusLabel({ status: MessageLogStatus.Sent, deliveryStatus }),
      ).toEqual({ label, tone });
    },
  );
});
