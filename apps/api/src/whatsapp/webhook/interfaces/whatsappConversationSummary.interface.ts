import { WhatsappInboundMessage } from '../../entities/whatsappInboundMessage.entity';

// One row per contact (matched client or raw phone number), not per
// message — see WhatsappWebhookService.findConversations's own comment for
// why this exists as a dedicated aggregation instead of the inbox grouping
// a flat message fetch client-side.
export interface WhatsappConversationSummary {
  key: string; // clientId when matched, otherwise fromPhoneNumber
  clientId: string | null;
  fromPhoneNumber: string;
  lastMessage: WhatsappInboundMessage;
  messageCount: number;
}
