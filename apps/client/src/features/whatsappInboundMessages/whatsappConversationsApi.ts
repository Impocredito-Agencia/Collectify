import { apiClient } from '@/lib/apiClient';

import type { WhatsappInboundMessage } from '@/features/whatsappInboundMessages/whatsappInboundMessagesApi';

// Matches apps/api/src/whatsapp/webhook/interfaces/whatsappConversationSummary.interface.ts.
// Human report, 2026-09-16 — a conversation's most recent activity is no
// longer necessarily an inbound message: the backend now unions
// message_logs/whatsapp_manual_replies in too, so a client who was only
// ever SENT something (a reminder, a self-service reply) but never
// replied still shows up here — not just contacts who texted in.
export type WhatsappConversationLastEvent =
  | { direction: 'inbound'; message: WhatsappInboundMessage }
  | {
      direction: 'outbound';
      source: 'message_log' | 'manual_reply';
      id: string;
      occurredAt: string;
      messageContent: string;
      status: 'sent' | 'failed';
      client: { id: string; firstName: string; lastName: string } | null;
    };

// Human report, 2026-09-14 (critical bug) — replaces grouping a flat,
// globally-capped message fetch client-side (see the removed
// groupIntoConversations on WhatsappInboundMessagesPage.tsx): one busy
// client could crowd every other conversation out of that shared budget,
// hiding it from the list entirely even while its ticket still counted
// toward the pending badge. GET /whatsapp/conversations aggregates one row
// per contact server-side instead, so pagination is over CONVERSATIONS,
// not raw events.
export interface WhatsappConversationSummary {
  key: string; // clientId when matched, otherwise fromPhoneNumber
  clientId: string | null;
  fromPhoneNumber: string;
  lastEvent: WhatsappConversationLastEvent;
  messageCount: number;
  // Human report, 2026-09-23 — set while an admin's last "Cerrar
  // conversación" is newer than the client's latest message; null once
  // the client writes again (or if it was never closed). Decided
  // server-side, see WhatsappWebhookService.findConversations.
  closedAt: string | null;
}

export interface WhatsappConversationsQueryParams {
  search?: string;
  page?: number;
  limit?: number;
}

export interface PaginatedWhatsappConversations {
  items: WhatsappConversationSummary[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export const whatsappConversationsApi = {
  getAll: async (
    params: WhatsappConversationsQueryParams = {},
  ): Promise<PaginatedWhatsappConversations> => {
    const { data, meta } = await apiClient.get<WhatsappConversationSummary[]>(
      '/whatsapp/conversations',
      { search: params.search, page: params.page, limit: params.limit },
    );
    return {
      items: data,
      meta: meta as PaginatedWhatsappConversations['meta'],
    };
  },

  // Human report, 2026-09-14 — backs the "Esperando asesor" queue: exactly
  // these clients' conversation summaries, unpaginated, regardless of how
  // long ago they last messaged. Driven by the already-unpaginated
  // whatsappConversationTicketsApi.getAll() pending list, not general
  // browsing — see the backend DTO's own comment.
  getForClientIds: async (
    clientIds: string[],
  ): Promise<WhatsappConversationSummary[]> => {
    if (clientIds.length === 0) return [];
    const { data } = await apiClient.get<WhatsappConversationSummary[]>(
      '/whatsapp/conversations',
      { clientIds },
    );
    return data;
  },
};
