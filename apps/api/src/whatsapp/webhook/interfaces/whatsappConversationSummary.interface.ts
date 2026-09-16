import { WhatsappInboundMessage } from '../../entities/whatsappInboundMessage.entity';

// Human report, 2026-09-16 — a conversation's most recent activity is no
// longer necessarily an inbound message: findConversations now unions
// whatsapp_inbound_messages with the two outbound tables (message_logs,
// whatsapp_manual_replies) so a client who was only ever SENT something
// (a reminder, a self-service reply) still shows up in the inbox, exactly
// like a real WhatsApp client shows a chat the moment you send the first
// message. The inbound case keeps carrying the full WhatsappInboundMessage
// so the frontend's existing media/button-aware preview rendering (icons,
// type badges) keeps working unchanged; the outbound case is always plain
// text (no media, no buttons on either source table), so a minimal shape
// is enough.
export type WhatsappConversationLastEvent =
  | { direction: 'inbound'; message: WhatsappInboundMessage }
  | {
      direction: 'outbound';
      source: 'message_log' | 'manual_reply';
      id: string;
      occurredAt: string;
      messageContent: string;
      status: 'sent' | 'failed';
    };

// One row per contact (matched client or raw phone number), not per
// message — see WhatsappWebhookService.findConversations's own comment for
// why this exists as a dedicated aggregation instead of the inbox grouping
// a flat message fetch client-side.
export interface WhatsappConversationSummary {
  key: string; // clientId when matched, otherwise fromPhoneNumber
  clientId: string | null;
  fromPhoneNumber: string;
  lastEvent: WhatsappConversationLastEvent;
  messageCount: number;
}
