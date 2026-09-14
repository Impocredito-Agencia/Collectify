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
import { WhatsappManualReply } from '../entities/whatsappManualReply.entity';
import { CONVERSATION_CLOSED_MESSAGE } from '../selfServiceMenuMessages';
import { SelfServiceMenuService } from '../selfServiceMenu.service';
import { WhatsappConversationStateService } from '../whatsappConversationState.service';
import { WhatsappConversationTicketService } from '../whatsappConversationTicket.service';
import { WhatsAppService } from '../whatsapp.service';
import { WhatsappOutboundLogService } from '../whatsappOutboundLog.service';

import { QueryWhatsappInboundMessagesDto } from './dto/queryWhatsappInboundMessages.dto';
import {
  extractInboundEvents,
  ParsedInboundEvent,
} from './extractInboundEvents';
import { normalizeIncomingPhoneNumber } from './normalizeIncomingPhoneNumber';
import { WhatsappInboundGateway } from './whatsappInbound.gateway';
import { WhatsappMediaService } from './whatsappMedia.service';

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
    @InjectRepository(WhatsappManualReply)
    private readonly manualRepliesRepository: Repository<WhatsappManualReply>,
    private readonly whatsappInboundGateway: WhatsappInboundGateway,
    private readonly whatsAppService: WhatsAppService,
    private readonly selfServiceMenuService: SelfServiceMenuService,
    private readonly conversationStateService: WhatsappConversationStateService,
    private readonly conversationTicketService: WhatsappConversationTicketService,
    private readonly whatsappMediaService: WhatsappMediaService,
    private readonly whatsappOutboundLogService: WhatsappOutboundLogService,
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
      // Human report, 2026-09-11 — payment lets the inbox render "✅ Ya
      // registrado" for a message linked via the "Registrar pago con este
      // comprobante" flow, instead of the raw media bubble. Widened
      // 2026-09-19 (human report) to also nest installment/loan — the
      // badge needs to name which cuota/pagaré the payment applied to,
      // not just the amount/date.
      relations: {
        client: true,
        payment: { installment: { loan: true } },
      },
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
    const fromPhoneNumber = normalizeIncomingPhoneNumber(event.fromPhoneNumber);
    // Human report, 2026-09-19 — a client can text in from either their
    // primary phoneNumber or their alternatePhoneNumber (Phase 21 KYC
    // field); both must resolve to the same client record, not just the
    // primary one, so a reply from the second number shows up under that
    // client here instead of "Número no reconocido" and can still drive
    // the self-service menu below.
    const client = await this.clientsRepository.findOne({
      where: [
        { phoneNumber: fromPhoneNumber },
        { alternatePhoneNumber: fromPhoneNumber },
      ],
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

    let saved = await this.inboundMessagesRepository.save(inboundMessage);

    // Human report, 2026-09-11 — see WhatsappMediaService's own comment.
    // Runs before the gateway push below so a live-connected admin sees
    // the image/document ready to view immediately, not a follow-up
    // update a moment later. Delays this method's return (and so the
    // webhook's own ack to Meta) by however long the download+upload
    // takes — acceptable for a first version given there's no background-
    // job infrastructure in this project yet; revisit if that ever causes
    // Meta to see this webhook as timing out. downloadAndStore() itself
    // never throws, but this stays wrapped anyway — a media failure must
    // never break the "every inbound event is durably logged" guarantee
    // this method already provides, the same principle the self-service
    // dispatch below already follows.
    if (event.mediaId) {
      try {
        const mediaUrl = await this.whatsappMediaService.downloadAndStore(
          event.mediaId,
        );
        if (mediaUrl) {
          saved = await this.inboundMessagesRepository.save({
            ...saved,
            mediaUrl,
          });
        }
      } catch (error) {
        this.logger.error(
          `Failed to attach re-hosted media to inbound message ${saved.id}`,
          error,
        );
      }
    }

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
        // Human report, 2026-09-19 — SelfServiceMenuService replies on
        // whatever `client.phoneNumber` is, which is normally correct
        // since that's the number the client is texting from. Once a
        // client can text in from a SECOND number, that assumption breaks
        // for a message that arrived on the alternate one — replying on
        // the stored primary would go to the wrong conversation entirely.
        // This shallow override makes every existing `client.phoneNumber`
        // reference downstream mean "the number this message actually
        // arrived on" with no changes needed inside that service. Every
        // other field (id, name, etc.) is untouched, so loan/breakdown
        // lookups are unaffected.
        const respondingClient = { ...client, phoneNumber: fromPhoneNumber };
        await this.selfServiceMenuService.handleInboundEvent(
          event,
          respondingClient,
        );
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
  // POST /whatsapp/inbound-messages/reply. Human report, 2026-09-19 — used
  // to only send, never persist: the reply lived as local React state on
  // WhatsappInboundMessagesPage.tsx only, gone on refresh and invisible to
  // any OTHER connected admin. Now saved (sent or failed either way, same
  // "log everything" convention as message_logs) and pushed live via the
  // same gateway inbound messages already use.
  async sendManualReply(
    rawPhoneNumber: string,
    message: string,
    sentByUserId: string,
  ): Promise<boolean> {
    const phoneNumber = normalizeIncomingPhoneNumber(rawPhoneNumber);
    const sent = await this.whatsAppService.sendTextMessage(
      phoneNumber,
      message,
    );

    // Human report, 2026-09-19 — matches either known number, same as
    // persistEvent's inbound resolution, so a reply on a conversation
    // under the client's alternatePhoneNumber still attributes clientId
    // correctly.
    const client = await this.clientsRepository.findOne({
      where: [{ phoneNumber }, { alternatePhoneNumber: phoneNumber }],
    });
    await this.whatsappOutboundLogService.log({
      clientId: client?.id ?? null,
      phoneNumber,
      messageContent: message,
      sentByUserId,
      sent,
    });

    return sent;
  }

  // Backs the inbox's thread — a flat recent window merged client-side
  // into each conversation, same "no per-conversation pagination yet"
  // convention as whatsapp_self_service_replies.
  async getManualReplies(): Promise<WhatsappManualReply[]> {
    return this.manualRepliesRepository.find({
      order: { sentAt: 'DESC' },
      take: DEFAULT_PAGE_SIZE * 10,
    });
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
  // sendClosingMessage (human report, 2026-09-13) — defaults to true, the
  // only behavior this had before. false skips the generic closing
  // message entirely (e.g. a conversation resolved outside WhatsApp, or
  // one whose 24h session window has already closed) while still clearing
  // state and resolving the ticket below.
  async closeConversation(
    rawPhoneNumber: string,
    sendClosingMessage = true,
  ): Promise<boolean> {
    const phoneNumber = normalizeIncomingPhoneNumber(rawPhoneNumber);
    const sent = sendClosingMessage
      ? await this.whatsAppService.sendTextMessage(
          phoneNumber,
          CONVERSATION_CLOSED_MESSAGE,
        )
      : false;
    // Human report, 2026-09-19 — same "every outbound message needs a
    // record" reasoning as WhatsappOutboundLogService's own comment: this
    // closing message used to leave no trace in the conversation thread.
    // sentByUserId null since the admin only triggered it, they didn't
    // type this fixed message themselves. Matches either known number —
    // see sendManualReply's identical comment. Skipped entirely (not
    // logged as a failed send) when sendClosingMessage is false — nothing
    // was actually attempted, so there's nothing real to show in the
    // thread.
    const client = await this.clientsRepository.findOne({
      where: [{ phoneNumber }, { alternatePhoneNumber: phoneNumber }],
    });
    if (sendClosingMessage) {
      await this.whatsappOutboundLogService.log({
        clientId: client?.id ?? null,
        phoneNumber,
        messageContent: CONVERSATION_CLOSED_MESSAGE,
        sentByUserId: null,
        sent,
      });
    }
    await this.conversationStateService.clear(phoneNumber);
    // Human report, 2026-09-13 — closing IS resolving: an admin explicitly
    // closing the conversation is what clears the pending-ticket badge,
    // regardless of whether the closing message itself actually sent (the
    // client's 24h session window may already be closed).
    if (client) {
      await this.conversationTicketService.resolve(client.id);
    }
    return sent;
  }
}
