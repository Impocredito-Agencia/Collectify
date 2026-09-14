import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import {
  WhatsappConversationTicket,
  WhatsappTicketStatus,
  WhatsappTicketTriggerKind,
} from './entities/whatsappConversationTicket.entity';
import { WhatsappInboundGateway } from './webhook/whatsappInbound.gateway';

// Human report, 2026-09-13 — see WhatsappConversationTicket's own comment
// for why this is a 2-state (Pending/Resolved) model, not a 3-state one.
@Injectable()
export class WhatsappConversationTicketService {
  constructor(
    @InjectRepository(WhatsappConversationTicket)
    private readonly repository: Repository<WhatsappConversationTicket>,
    private readonly whatsappInboundGateway: WhatsappInboundGateway,
  ) {}

  // Called from SelfServiceMenuService whenever a client requests an
  // advisor or sends what could be a payment receipt (image/document) —
  // see its own call sites. Idempotent-ish by design: calling this again
  // while already Pending just refreshes pendingSince/triggerKind (new
  // activity always bumps a ticket back to the front of the queue, even
  // one already Pending or already Resolved).
  async openOrReopen(
    clientId: string,
    triggerKind: WhatsappTicketTriggerKind,
  ): Promise<WhatsappConversationTicket> {
    const existing = await this.repository.findOneBy({ clientId });

    const ticket = existing
      ? Object.assign(existing, {
          status: WhatsappTicketStatus.Pending,
          triggerKind,
          pendingSince: new Date(),
          resolvedAt: null,
        })
      : this.repository.create({
          clientId,
          status: WhatsappTicketStatus.Pending,
          triggerKind,
          pendingSince: new Date(),
          resolvedAt: null,
        });

    const saved = await this.repository.save(ticket);
    this.whatsappInboundGateway.emitTicketUpdate(saved);
    return saved;
  }

  // Called from WhatsappWebhookService.closeConversation — a cobrador
  // explicitly closing the conversation is what resolves the ticket, never
  // anything time-based (see the entity's own doc comment on why this
  // never expires on its own). A no-op (returns null) when there's no
  // ticket for this client at all, e.g. closing a conversation that was
  // never actually flagged — nothing to resolve.
  async resolve(clientId: string): Promise<WhatsappConversationTicket | null> {
    const existing = await this.repository.findOneBy({ clientId });
    if (!existing) {
      return null;
    }

    existing.status = WhatsappTicketStatus.Resolved;
    existing.resolvedAt = new Date();
    const saved = await this.repository.save(existing);
    this.whatsappInboundGateway.emitTicketUpdate(saved);
    return saved;
  }

  // Flat list, no pagination — the panel needs every ticket (not just a
  // recent window) to compute the pending badge/filter/FIFO ordering
  // client-side, and row volume here is inherently small (one row per
  // client that has ever needed a human).
  async findAll(): Promise<WhatsappConversationTicket[]> {
    return this.repository.find({ order: { pendingSince: 'ASC' } });
  }
}
