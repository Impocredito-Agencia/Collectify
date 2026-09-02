import { createHmac, timingSafeEqual } from 'crypto';

import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, ILike, Repository } from 'typeorm';

import { Client } from '../../clients/entities/client.entity';
import { PaginatedResult } from '../../common/interfaces/paginatedResult.interface';
import { Configuration } from '../../config/configuration';
import { WhatsappInboundMessage } from '../entities/whatsappInboundMessage.entity';
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

// TEST-ONLY menu, requested directly by the human (2026-08-27) to exercise
// the inbox before the real button-flow/"menu" catalog exists — see the
// still-open "how many menus" question in
// docs/phases/PHASE_22_WHATSAPP_WEBHOOK.md. Not the real menu system: no
// catalog, no admin config. Both numeric options are now no-ops
// server-side — option "2" used to auto-trigger the account-summary send,
// but account_summary was retired outright by Phase 33
// (docs/phases/PHASE_33_MESSAGE_TEMPLATES_V2.md), and option "1" ("hablar
// con humano") never had a server-side effect to begin with (the frontend
// enables the reply box purely by scanning the thread for a "1" message,
// see WhatsappInboundMessagesPage.tsx). The message below still sends —
// only the auto-trigger on reply was removed. Rip this whole thing out
// once Phase 34's real catalog ships.

// The outbound half of the same test scaffolding — a plain text message
// (not a real, Meta-approved template) an admin can send from the client's
// page to kick off a manual test of the flow above. Sent as a free-form
// session message, so it only reaches the client if a 24h window is
// already open (they messaged in recently) — same limitation as
// sendManualReply.
const TEST_MENU_MESSAGE = [
  '¿En qué podemos ayudarte?',
  '1. Hablar con un humano',
  '2. Recibir el desglose de tus cuotas',
  '',
  'Responde con el número de la opción.',
].join('\n');

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

  // See TEST_MENU_MESSAGE's doc comment — the "send the test menu" button
  // on ClientDetailPage. Same free-form-session limitation as
  // sendManualReply: only actually reaches the client if they've messaged
  // in within the last 24h.
  async sendTestMenu(clientId: string): Promise<boolean> {
    const client = await this.clientsRepository.findOneBy({ id: clientId });
    if (!client) {
      throw new NotFoundException(`Client with id ${clientId} not found`);
    }

    return this.whatsAppService.sendTextMessage(
      client.phoneNumber,
      TEST_MENU_MESSAGE,
    );
  }
}
