import { apiClient } from '@/lib/apiClient';

// Matches apps/api/src/whatsapp/entities/whatsappInboundMessage.entity.ts's
// WhatsappInboundMessageType. Image/Document/Audio/Video/Sticker/Location
// added 2026-09-11 — see that entity's own comment.
export enum WhatsappInboundMessageType {
  Button = 'button',
  Text = 'text',
  Image = 'image',
  Document = 'document',
  Audio = 'audio',
  Video = 'video',
  Sticker = 'sticker',
  Location = 'location',
  Other = 'other',
}

// Human report, 2026-09-19 — an admin's "Responder" reply used to only
// exist as local React state (gone on refresh, invisible to any other
// admin). Now persisted server-side and pushed live over the same socket
// as inbound client messages — see whatsappInbound.gateway.ts's
// emitManualReply.
//
// Widened same day (human report) to also cover the self-service menu's
// own automated replies and WhatsappWebhookService's "Cerrar
// conversación" closing message — without them, a client's "ya pagué" or
// tapped "Más información" looked unprompted, since the bot's own reply
// left no trace here. sentByUserId is how the two are told apart: null
// means the bot composed and sent it, not an admin — see
// WhatsappInboundMessagesPage.tsx's ReplyBubble.
// Matches apps/api's SelfServiceReplyKind — set only when
// selfServiceReplyKind's sentByUserId is null AND the send came from the
// self-service menu (not the "Cerrar conversación" closing message).
export type SelfServiceReplyKind =
  | 'main_menu'
  | 'mi_cuenta_submenu'
  | 'breakdown'
  | 'payment_history'
  | 'receipt_request'
  | 'receipt_received_ack'
  | 'advisor_handoff'
  | 'volver_al_menu_follow_up';

export interface WhatsappManualReply {
  id: string;
  clientId: string | null;
  phoneNumber: string;
  messageContent: string;
  sentByUserId: string | null;
  status: 'sent' | 'failed';
  selfServiceReplyKind: SelfServiceReplyKind | null;
  sentAt: string;
  whatsappMessageId: string | null;
  // Added 2026-09-16 — matches apps/api's WhatsappDeliveryStatus. Meta's
  // delivery-status webhook callback, applied once a matching WAMID
  // arrives; null means no callback has been received yet (or ever).
  deliveryStatus: 'sent' | 'delivered' | 'read' | 'failed' | null;
  deliveryStatusUpdatedAt: string | null;
  lastErrorCode: number | null;
  lastErrorTitle: string | null;
  createdAt: string;
}

// GET /whatsapp/inbound-messages leftJoinAndSelects `client` so the list
// can show a name (or "número no reconocido") instead of a bare id — same
// shape as MessageLog.client, nullable here since an inbound message from
// an unrecognized number is still logged, not dropped. See
// docs/phases/PHASE_22_WHATSAPP_WEBHOOK.md.
export interface WhatsappInboundMessage {
  id: string;
  clientId: string | null;
  client: {
    id: string;
    firstName: string;
    lastName: string;
  } | null;
  fromPhoneNumber: string;
  type: WhatsappInboundMessageType;
  buttonPayload: string | null;
  bodyText: string | null;
  // Human report, 2026-09-11 — the Cloudinary URL this message's
  // attachment was re-hosted to, so it survives Meta's own copy
  // eventually expiring. Only image/document ever populate this (see
  // WhatsappMediaService) — null until that download+upload succeeds, or
  // for any non-media message, or for audio/video/sticker/location, which
  // are deliberately never re-hosted.
  mediaUrl: string | null;
  // Human report, 2026-09-11 — set once a collector registers a payment
  // from this message via "Registrar pago con este comprobante" (see
  // RegisterPaymentFromWhatsappModal). Null means the comprobante hasn't
  // been used yet. installment/promissoryNoteNumber widened in 2026-09-19
  // (human report) so the "✅ Ya registrado" badge can name which cuota/
  // pagaré the payment applied to, not just the amount/date.
  payment: {
    id: string;
    amountPaid: number;
    paidAt: string;
    installment: {
      installmentNumber: number;
      loan: {
        promissoryNoteNumber: string;
      };
    };
  } | null;
  receivedAt: string;
  createdAt: string;
}

// Matches apps/api/src/whatsapp/entities/whatsappConversationState.entity.ts's
// ConversationMenu — where a known client currently is in the self-service
// menu (Phase 34). null (no active/expired row) means no automated
// conversation is in progress for that number.
export enum ConversationMenu {
  Main = 'main',
  MiCuentaSubmenu = 'mi_cuenta_submenu',
  AwaitingReceipt = 'awaiting_receipt',
  HandedOffToHuman = 'handed_off_to_human',
}

export interface WhatsappInboundMessagesQueryParams {
  clientId?: string;
  // Human report, 2026-09-14 — scopes to one unrecognized-number
  // conversation (clientId is null); ignored when clientId is also set.
  // See ConversationThread's own comment.
  fromPhoneNumber?: string;
  type?: WhatsappInboundMessageType;
  search?: string;
  page?: number;
  limit?: number;
}

export interface PaginatedWhatsappInboundMessages {
  items: WhatsappInboundMessage[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export const whatsappInboundMessagesApi = {
  getAll: async (
    params: WhatsappInboundMessagesQueryParams = {},
  ): Promise<PaginatedWhatsappInboundMessages> => {
    const { data, meta } = await apiClient.get<WhatsappInboundMessage[]>(
      '/whatsapp/inbound-messages',
      {
        clientId: params.clientId,
        fromPhoneNumber: params.fromPhoneNumber,
        type: params.type,
        search: params.search,
        page: params.page,
        limit: params.limit,
      },
    );
    return {
      items: data,
      meta: meta as PaginatedWhatsappInboundMessages['meta'],
    };
  },

  // Manual reply — free-form session message, only meaningful once the
  // client has messaged in and opened the 24h window. See
  // WhatsappInboundMessagesPage.tsx's humanReplyEnabled.
  reply: async (phoneNumber: string, message: string): Promise<boolean> => {
    const { data } = await apiClient.post<{ sent: boolean }>(
      '/whatsapp/inbound-messages/reply',
      { phoneNumber, message },
    );
    return data.sent;
  },

  // Human report, 2026-09-24 — sends the seguimiento_solicitud Meta
  // template, which (unlike reply above) still reaches the client after
  // their 24h window closed. See SendFollowUpButton.
  sendFollowUp: async (phoneNumber: string): Promise<boolean> => {
    const { data } = await apiClient.post<{ sent: boolean }>(
      '/whatsapp/inbound-messages/follow-up',
      { phoneNumber },
    );
    return data.sent;
  },

  // Human report, 2026-09-14 (critical bug) — scoped to one conversation
  // (clientId, or fromPhoneNumber for an unrecognized number) instead of a
  // flat window shared across every conversation's replies — see
  // useManualReplies' own comment.
  getManualReplies: async (params: {
    clientId?: string;
    fromPhoneNumber?: string;
  }): Promise<WhatsappManualReply[]> => {
    const { data } = await apiClient.get<WhatsappManualReply[]>(
      '/whatsapp/inbound-messages/manual-replies',
      { clientId: params.clientId, fromPhoneNumber: params.fromPhoneNumber },
    );
    return data;
  },

  // Backs the "Responder"/"Cerrar conversación" gating — see
  // WhatsappInboundMessagesPage.tsx.
  getConversationState: async (
    phoneNumber: string,
  ): Promise<ConversationMenu | null> => {
    const { data } = await apiClient.get<{
      currentMenu: ConversationMenu | null;
    }>('/whatsapp/inbound-messages/conversation-state', { phoneNumber });
    return data.currentMenu;
  },

  // Admin-triggered: clears the self-service-menu state (and resolves the
  // client's WhatsappConversationTicket) so the client's next message gets
  // the real menu fresh instead of the bot staying silent. Sends the
  // generic closing message unless sendClosingMessage is explicitly false
  // (human report, 2026-09-13) — see CloseConversationButton's "Avisar al
  // cliente" checkbox.
  closeConversation: async (
    phoneNumber: string,
    sendClosingMessage = true,
  ): Promise<boolean> => {
    const { data } = await apiClient.post<{ sent: boolean }>(
      '/whatsapp/inbound-messages/close-conversation',
      { phoneNumber, sendClosingMessage },
    );
    return data.sent;
  },
};
