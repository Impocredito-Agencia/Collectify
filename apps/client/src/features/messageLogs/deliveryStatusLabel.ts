import {
  MessageLogStatus,
  WhatsappDeliveryStatus,
} from '@/features/messageLogs/messageLogsApi';

import type { StatusBadgeTone } from '@/components/ui/StatusBadge';
import type { MessageLog } from '@/features/messageLogs/messageLogsApi';

export interface DeliveryStatusLabel {
  label: string;
  tone: StatusBadgeTone;
}

// Phase 36, stage 4 — one label for both halves of a message's fate: did
// the send itself go out (`status`), and what the provider reported later
// (`deliveryStatus` — Meta's webhook for WhatsApp, Brevo's for email/SMS).
// Before this the list only ever said Enviado/Fallido.
export function deliveryStatusLabel(
  log: Pick<MessageLog, 'status' | 'deliveryStatus'>,
): DeliveryStatusLabel {
  if (log.status === MessageLogStatus.Failed) {
    return { label: 'Fallido', tone: 'danger' };
  }
  switch (log.deliveryStatus) {
    case WhatsappDeliveryStatus.Failed:
      return { label: 'No entregado', tone: 'danger' };
    case WhatsappDeliveryStatus.Read:
      return { label: 'Leído', tone: 'success' };
    case WhatsappDeliveryStatus.Delivered:
      return { label: 'Entregado', tone: 'success' };
    default:
      return { label: 'Enviado', tone: 'success' };
  }
}
