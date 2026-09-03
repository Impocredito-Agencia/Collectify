import { createHmac, timingSafeEqual } from 'crypto';

import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, ILike, Repository } from 'typeorm';

import { Client } from '../../clients/entities/client.entity';
import { PaginatedResult } from '../../common/interfaces/paginatedResult.interface';
import { Configuration } from '../../config/configuration';
import { ConversationMenu } from '../entities/whatsappConversationState.entity';
import { WhatsappInboundMessage } from '../entities/whatsappInboundMessage.entity';
import { CONVERSATION_CLOSED_MESSAGE } from '../selfServiceMenuMessages';
import { SelfServiceMenuService } from '../selfServiceMenu.service';
import { WhatsappConversationStateService } from '../whatsappConversationState.service';
import { WhatsAppService } from '../whatsapp.service';

import { QueryWhatsappInboundMessagesDto } from './dto/queryWhatsappInboundMessages.dto';
import {
  extractInboundEvents,
  ParsedInboundEvent,
} from './extractInboundEvents';
import { normalizeIncomingPhoneNumber } from './normalizeIncomingPhoneNumber';
import { WhatsappInboundGateway } from './whatsappInbound.gateway';

const HUB_SUBSCRIBE_MODE = 'subscribe';
const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;

@Injectable()
export class WhatsappWebhookService {
  private readonly logger = new Logger(WhatsappWebhookService.name);

  constructor(
    private readonly configService: ConfigService<Configuration, true>,
    @InjectRepository(WhatsappInboundMessage)
    private readonly inboundMessagesRepository: Repository<WhatsappInboundMessage>,
    @InjectRepository(Client)
    private readonly clientsRepository: Repository<Client>,
    private readonly whatsappInboundGateway: WhatsappInboundGateway,
    private readonly whatsAppService: WhatsAppService,
    private readonly selfServiceMenuService: SelfServiceMenuService,
    private readonly conversationStateService: WhatsappConversationStateService,
  ) {}

  // Meta's one-time verification handshake — echoes hub.challenge back only
  // when hub.verify_token matches our configured secret. Throws (→ 403) on
  // any mismatch, including an unconfigured token, rather than ever
  // treating a missing secret as "anything goes".
  verifyHandshake(mode: string, token: string, challenge: string): string {
    const { webhookVerifyToken } = this.configService.get('whatsapp', {
      infer: true,
    });

    if (
      mode !== HUB_SUBSCRIBE_MODE ||
      !webhookVerifyToken ||
      token !== webhookVerifyToken
    ) {
      throw new ForbiddenException('Webhook verify token mismatch.');
    }

    return challenge;
  }

  // Must run before the payload is parsed at all, per
  // docs/phases/PHASE_22_WHATSAPP_WEBHOOK.md. Constant-time comparison
  // (timingSafeEqual) so response timing can't leak the correct signature.
  verifySignatureOrThrow(
    rawBody: Buffer | undefined,
    signatureHeader: string | undefined,
  ): void {
    const { appSecret } = this.configService.get('whatsapp', { infer: true });

    if (!appSecret || !signatureHeader || !rawBody) {
      throw new ForbiddenException('Missing WhatsApp webhook signature.');
    }

    const expectedSignature = `sha256=${createHmac('sha256', appSecret)
      .update(rawBody)
      .digest('hex')}`;
    const expected = Buffer.from(expectedSignature);
    const actual = Buffer.from(signatureHeader);

    if (
      expected.length !== actual.length ||
      !timingSafeEqual(expected, actual)
    ) {
      throw new ForbiddenException('Invalid WhatsApp webhook signature.');
    }
  }

  // Never throws — a payload we can't fully parse still gets every event it
  // *can* extract persisted, and acks 200 either way, per the phase's
  // "never lost, never an unhandled error back to Meta" requirement.
  async handleIncomingPayload(payload: unknown): Promise<void> {
    let events: ParsedInboundEvent[] = [];
    try {
      events = extractInboundEvents(payload);
    } catch (error) {
      this.logger.error('Failed to parse an inbound WhatsApp payload', error);
      return;
    }

    for (const event of events) {
      await this.persistEvent(event);
    }
  }

  // Admin-facing list — see docs/phasesClient/PHASE_22_WHATSAPP_WEBHOOK.md's
  // inbound-message log view. Same pagination/search shape as
  // MessageLogsService.findAll: search matches the matched client's
  // first/last name, an unmatched message is simply excluded by that
  // filter rather than special-cased.
  async findAll(
    query: QueryWhatsappInboundMessagesDto,
  ): Promise<PaginatedResult<WhatsappInboundMessage>> {
    const page = query.page ?? DEFAULT_PAGE;
    const limit = query.limit ?? DEFAULT_PAGE_SIZE;

    const base: FindOptionsWhere<WhatsappInboundMessage> = {};
    if (query.clientId) {
      base.clientId = query.clientId;
    }
    if (query.type) {
      base.type = query.type;
    }

    const search = query.search ? `%${query.search}%` : undefined;
    const where:
      | FindOptionsWhere<WhatsappInboundMessage>[]
      | FindOptionsWhere<WhatsappInboundMessage> = search
      ? [
          { ...base, client: { firstName: ILike(search) } },
          { ...base, client: { lastName: ILike(search) } },
        ]
      : base;

    const [items, total] = await this.inboundMessagesRepository.findAndCount({
      where,
      relations: { client: true },
      order: { receivedAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      items,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  private async persistEvent(event: ParsedInboundEvent): Promise<void> {
    const client = await this.clientsRepository.findOneBy({
      phoneNumber: normalizeIncomingPhoneNumber(event.fromPhoneNumber),
    });

    const inboundMessage = this.inboundMessagesRepository.create({
      clientId: client?.id ?? null,
      fromPhoneNumber: event.fromPhoneNumber,
      type: event.type,
      buttonPayload: event.buttonPayload,
      bodyText: event.bodyText,
      rawPayload: event.rawPayload,
      receivedAt: event.receivedAt,
    });

    const saved = await this.inboundMessagesRepository.save(inboundMessage);
    // Attach the already-resolved client so the pushed payload matches
    // findAll()'s shape (relations: { client: true }) — the frontend
    // merges both sources into the same list/cache, so they need to look
    // the same.
    this.whatsappInboundGateway.emitInboundMessage({ ...saved, client });

    // Phase 34 — self-service menu, known clients only (see
    // SelfServiceMenuService's doc comment for why an unrecognized number
    // gets no automated reply). Never lets a menu-handling failure break
    // the "every inbound event is durably logged, ack 200 regardless"
    // guarantee this method already provides.
    if (client) {
      try {
        await this.selfServiceMenuService.handleInboundEvent(event, client);
      } catch (error) {
        this.logger.error(
          `Self-service menu handling failed for client ${client.id}`,
          error,
        );
      }
    }
  }

  // Manual reply from the panel — a free-form session message, valid
  // within the 24h window the client's own inbound message opened. See
  // POST /whatsapp/inbound-messages/reply.
  async sendManualReply(
    rawPhoneNumber: string,
    message: string,
  ): Promise<boolean> {
    return this.whatsAppService.sendTextMessage(
      normalizeIncomingPhoneNumber(rawPhoneNumber),
      message,
    );
  }

  // Backs the panel's "Responder"/"Cerrar conversación" gating — see
  // WhatsappInboundMessagesPage.tsx. Returns null when there's no active
  // (or an expired) self-service-menu state for this number, same
  // "no state" semantics WhatsappConversationStateService.getActive uses
  // internally.
  async getConversationState(
    rawPhoneNumber: string,
  ): Promise<ConversationMenu | null> {
    const state = await this.conversationStateService.getActive(
      normalizeIncomingPhoneNumber(rawPhoneNumber),
    );
    return state?.currentMenu ?? null;
  }

  // Bug fix (2026-09-02): once a client tapped "Reportar un pago"/"Ya
  // pagué" or "Hablar con asesor", the self-service menu (Phase 34) now
  // stays silent on that number — see SelfServiceMenuService and the
  // ConversationMenu doc comment. This is the admin's explicit way to end
  // that: sends a generic closing message and clears the conversation
  // state, so the client's next message gets the self-service menu fresh,
  // same as a brand-new conversation.
  async closeConversation(rawPhoneNumber: string): Promise<boolean> {
    const phoneNumber = normalizeIncomingPhoneNumber(rawPhoneNumber);
    const sent = await this.whatsAppService.sendTextMessage(
      phoneNumber,
      CONVERSATION_CLOSED_MESSAGE,
    );
    await this.conversationStateService.clear(phoneNumber);
    return sent;
  }
}
