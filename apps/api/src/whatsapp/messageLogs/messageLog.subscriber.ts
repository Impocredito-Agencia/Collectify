import { Injectable } from '@nestjs/common';
import { DataSource, EntitySubscriberInterface } from 'typeorm';

import { MessageLog } from '../entities/messageLog.entity';
import { WhatsappInboundGateway } from '../webhook/whatsappInbound.gateway';

// Human report, 2026-09-23 — a reminder/confirmation going out moves that
// client's chat to the top of the inbox (it's the conversation's newest
// event, see WhatsappWebhookService.findConversations), but nothing told
// an open panel to refetch, so the list only re-sorted on the next inbound
// message or page reload. message_logs is written from five different
// services (each reminder type, payment confirmations, retries); hooking
// the insert itself covers every one of them, and any future one, without
// threading the gateway through each.
@Injectable()
export class MessageLogSubscriber implements EntitySubscriberInterface<MessageLog> {
  constructor(
    dataSource: DataSource,
    private readonly whatsappInboundGateway: WhatsappInboundGateway,
  ) {
    dataSource.subscribers.push(this);
  }

  listenTo(): typeof MessageLog {
    return MessageLog;
  }

  afterInsert(): void {
    this.whatsappInboundGateway.emitConversationUpdate();
  }
}
