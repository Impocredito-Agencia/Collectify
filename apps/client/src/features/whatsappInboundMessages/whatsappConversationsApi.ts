import { apiClient } from '@/lib/apiClient';

import type { WhatsappInboundMessage } from '@/features/whatsappInboundMessages/whatsappInboundMessagesApi';

// Matches apps/api/src/whatsapp/webhook/interfaces/whatsappConversationSummary.interface.ts.
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
  lastMessage: WhatsappInboundMessage;
  messageCount: number;
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
