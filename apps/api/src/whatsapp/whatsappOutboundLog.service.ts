import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import {
  SelfServiceReplyKind,
  WhatsappManualReply,
  WhatsappManualReplyStatus,
} from './entities/whatsappManualReply.entity';
import { WhatsappInboundGateway } from './webhook/whatsappInbound.gateway';

// Human report, 2026-09-19 — "Mensajes entrantes" only showed a client's
// inbound messages plus an admin's own typed replies; every OTHER outbound
// message a client actually receives — the self-service menu's own
// automated replies (SelfServiceMenuService: main menu, breakdowns,
// receipt prompts, advisor hand-off...) and WhatsappWebhookService's
// "Cerrar conversación" closing message — went out over WhatsApp but left
// no durable record, so the conversation thread stopped making sense past
// the first message. This is the one place both of those services log a
// send, sharing the same whatsapp_manual_replies table, live-push, and
// frontend rendering as an actual manual reply — sentByUserId null is what
// tells them apart (see WhatsappInboundMessagesPage.tsx's ReplyBubble).
@Injectable()
export class WhatsappOutboundLogService {
  constructor(
    @InjectRepository(WhatsappManualReply)
    private readonly manualRepliesRepository: Repository<WhatsappManualReply>,
    private readonly whatsappInboundGateway: WhatsappInboundGateway,
  ) {}

  async log(params: {
    clientId: string | null;
    phoneNumber: string;
    messageContent: string;
    sentByUserId: string | null;
    sent: boolean;
    // Human report, 2026-09-13 — set only by SelfServiceMenuService's
    // sendText/sendInteractive wrappers; every other caller (an admin's
    // manual reply, the closing message) leaves this null.
    selfServiceReplyKind?: SelfServiceReplyKind | null;
    // Added 2026-09-16 — Meta's WAMID for this send, once sendTextMessage/
    // sendInteractiveButtonsMessage started returning one (see
    // WhatsAppService.SendMessageResult). Optional/nullable so an existing
    // call site that hasn't been updated yet still compiles; every current
    // caller passes it through. Lets a later delivery-status webhook be
    // correlated back to this row — see extractStatusEvents.ts.
    whatsappMessageId?: string | null;
  }): Promise<WhatsappManualReply> {
    const reply = this.manualRepliesRepository.create({
      clientId: params.clientId,
      phoneNumber: params.phoneNumber,
      messageContent: params.messageContent,
      sentByUserId: params.sentByUserId,
      status: params.sent
        ? WhatsappManualReplyStatus.Sent
        : WhatsappManualReplyStatus.Failed,
      selfServiceReplyKind: params.selfServiceReplyKind ?? null,
      whatsappMessageId: params.whatsappMessageId ?? null,
      sentAt: new Date(),
    });
    const saved = await this.manualRepliesRepository.save(reply);
    this.whatsappInboundGateway.emitManualReply(saved);
    return saved;
  }
}
