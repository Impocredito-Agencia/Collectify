import { apiClient } from '@/lib/apiClient';

// Matches apps/api/src/whatsapp/entities/whatsappConversationTicket.entity.ts.
export enum WhatsappTicketStatus {
  Pending = 'pending',
  Resolved = 'resolved',
}

export enum WhatsappTicketTriggerKind {
  AdvisorRequested = 'advisor_requested',
  ReceiptImage = 'receipt_image',
  ReceiptDocument = 'receipt_document',
  FreeText = 'free_text',
}

// Human report, 2026-09-13 — one row per client (not append-only, unlike
// WhatsappInboundMessage/WhatsappManualReply), tracking whether a human
// still needs to act on that client's WhatsApp conversation. See the
// entity's own comment for why this is 2 states, not 3.
export interface WhatsappConversationTicket {
  id: string;
  clientId: string;
  status: WhatsappTicketStatus;
  triggerKind: WhatsappTicketTriggerKind;
  pendingSince: string;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export const whatsappConversationTicketsApi = {
  // Flat, unpaginated — GET /whatsapp/tickets returns every ticket ordered
  // oldest-pending-first, low volume by design (one row per client that
  // has ever needed a human).
  getAll: async (): Promise<WhatsappConversationTicket[]> => {
    const { data } =
      await apiClient.get<WhatsappConversationTicket[]>('/whatsapp/tickets');
    return data;
  },
};
