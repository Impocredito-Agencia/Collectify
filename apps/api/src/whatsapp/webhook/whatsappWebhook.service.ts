import { createHmac, timingSafeEqual } from 'crypto';

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, ILike, In, Repository } from 'typeorm';

import { Client } from '../../clients/entities/client.entity';
import { PaginatedResult } from '../../common/interfaces/paginatedResult.interface';
import { Configuration } from '../../config/configuration';
import { BankAccountService } from '../bankAccount.service';
import {
  BANK_ACCOUNT_TEMPLATE_LANGUAGE_CODE,
  BANK_ACCOUNT_TEMPLATE_NAME,
  buildBankAccountTemplateMessage,
} from '../bankAccountTemplate';
import { MessageLog, MessageLogStatus } from '../entities/messageLog.entity';
import {
  WhatsappTicketStatus,
  WhatsappTicketTriggerKind,
} from '../entities/whatsappConversationTicket.entity';
import { WhatsappConversationClosure } from '../entities/whatsappConversationClosure.entity';
import { ConversationMenu } from '../entities/whatsappConversationState.entity';
import {
  WhatsappInboundMessage,
  WhatsappInboundMessageType,
} from '../entities/whatsappInboundMessage.entity';
import {
  WhatsappManualReply,
  WhatsappManualReplyStatus,
} from '../entities/whatsappManualReply.entity';
import {
  buildFollowUpTemplateMessage,
  FOLLOW_UP_TEMPLATE_LANGUAGE_CODE,
  FOLLOW_UP_TEMPLATE_NAME,
} from '../followUpTemplate';
import { CONVERSATION_CLOSED_MESSAGE } from '../selfServiceMenuMessages';
import { SelfServiceMenuService } from '../selfServiceMenu.service';
import { WhatsappConversationStateService } from '../whatsappConversationState.service';
import { WhatsappConversationTicketService } from '../whatsappConversationTicket.service';
import { WhatsAppService } from '../whatsapp.service';
import {
  computeDeliveryHealth,
  WhatsappDeliveryHealth,
} from '../whatsappDeliveryHealth';
import { WhatsappOutboundLogService } from '../whatsappOutboundLog.service';

import { QueryWhatsappConversationsDto } from './dto/queryWhatsappConversations.dto';
import { QueryWhatsappInboundMessagesDto } from './dto/queryWhatsappInboundMessages.dto';
import { QueryWhatsappManualRepliesDto } from './dto/queryWhatsappManualReplies.dto';
import {
  extractInboundEvents,
  ParsedInboundEvent,
} from './extractInboundEvents';
import { extractStatusEvents, ParsedStatusEvent } from './extractStatusEvents';
import type {
  WhatsappConversationLastEvent,
  WhatsappConversationSummary,
} from './interfaces/whatsappConversationSummary.interface';
import { normalizeIncomingPhoneNumber } from './normalizeIncomingPhoneNumber';
import { WhatsappInboundGateway } from './whatsappInbound.gateway';
import { WhatsappMediaService } from './whatsappMedia.service';

const HUB_SUBSCRIBE_MODE = 'subscribe';
const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;
const DEFAULT_CONVERSATIONS_PAGE_SIZE = 20;
const DELIVERY_HEALTH_WINDOW = 5;

type ConversationEventSource =
  'inbound_message' | 'message_log' | 'manual_reply';

interface ConversationRow {
  id: string;
  source: ConversationEventSource;
  message_count: string;
  closed_at: Date | null;
}

// Shared by findConversations and findConversationsForClientIds — picks
// each contact's latest event (plus a total count) out of `events`.
//
// Human report, 2026-09-23 — also resolves whether the conversation is
// currently closed: an admin's WhatsappConversationClosure counts only
// while it's newer than the contact's latest INBOUND message, so the
// client writing again reopens it with no write needed anywhere (see that
// entity's own comment). Outbound events (a reminder, the closing message
// itself) never reopen it — only the client can. closed_at comes back
// null whenever it isn't currently closed, so callers never re-derive it.
function buildLatestPerConversationQuery(
  eventsCte: string,
  paginationClause: string,
): string {
  return `
    WITH events AS (${eventsCte})
    SELECT
      latest.id,
      latest.source,
      latest.message_count,
      CASE
        WHEN latest.last_inbound_at IS NULL
          OR latest.last_inbound_at <= cl.closed_at
        THEN cl.closed_at
      END AS closed_at
    FROM (
      SELECT
        id,
        source,
        contact_key,
        occurred_at,
        COUNT(*) OVER (PARTITION BY contact_key) AS message_count,
        MAX(occurred_at) FILTER (WHERE source = 'inbound_message')
          OVER (PARTITION BY contact_key) AS last_inbound_at,
        ROW_NUMBER() OVER (PARTITION BY contact_key ORDER BY occurred_at DESC) AS rn
      FROM events
    ) latest
    LEFT JOIN whatsapp_conversation_closures cl
      ON cl.contact_key = latest.contact_key
    WHERE latest.rn = 1
    ORDER BY latest.occurred_at DESC
    ${paginationClause}
  `;
}

// Shared by findConversations' paginated rows/count queries — a UNION ALL
// across the three tables a client's WhatsApp activity can live in, each
// projected to (id, source, contact_key, occurred_at) so they can be
// grouped/paginated together as one timeline. $1 is the optional search
// term (client first/last name), applied identically to all three
// branches so an unmatched-number conversation is excluded from a search
// result exactly like before (c.first_name/c.last_name are NULL for an
// unjoined row, so the ILIKE never matches unless $1 itself is NULL).
//
// contact_key normalizes whatsapp_inbound_messages.from_phone_number (Meta
// sends it WITHOUT a leading "+", see normalizeIncomingPhoneNumber's own
// comment) to the same "+"-prefixed shape message_logs.phone_number and
// whatsapp_manual_replies.phone_number are already stored in — without
// this, the same real contact could group into two separate conversation
// rows (one keyed by the raw inbound number, one by the normalized
// outbound number) the moment they had both an inbound and an
// outbound-only row. message_logs.client_id is never null (every send
// targets an existing client), so that branch keys on it directly.
function buildConversationEventsCte(): string {
  return `
    SELECT
      m.id,
      'inbound_message'::text AS source,
      COALESCE(
        m.client_id::text,
        CASE WHEN m.from_phone_number LIKE '+%' THEN m.from_phone_number ELSE '+' || m.from_phone_number END
      ) AS contact_key,
      m.received_at AS occurred_at
    FROM whatsapp_inbound_messages m
    LEFT JOIN clients c ON c.id = m.client_id AND c.deleted_at IS NULL
    WHERE $1::text IS NULL OR c.first_name ILIKE $1 OR c.last_name ILIKE $1
    UNION ALL
    SELECT
      l.id,
      'message_log'::text AS source,
      l.client_id::text AS contact_key,
      l.sent_at AS occurred_at
    FROM message_logs l
    LEFT JOIN clients c ON c.id = l.client_id AND c.deleted_at IS NULL
    WHERE $1::text IS NULL OR c.first_name ILIKE $1 OR c.last_name ILIKE $1
    UNION ALL
    SELECT
      r.id,
      'manual_reply'::text AS source,
      COALESCE(r.client_id::text, r.phone_number) AS contact_key,
      r.sent_at AS occurred_at
    FROM whatsapp_manual_replies r
    LEFT JOIN clients c ON c.id = r.client_id AND c.deleted_at IS NULL
    WHERE $1::text IS NULL OR c.first_name ILIKE $1 OR c.last_name ILIKE $1
  `;
}

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
    @InjectRepository(MessageLog)
    private readonly messageLogsRepository: Repository<MessageLog>,
    @InjectRepository(WhatsappConversationClosure)
    private readonly closuresRepository: Repository<WhatsappConversationClosure>,
    private readonly whatsappInboundGateway: WhatsappInboundGateway,
    private readonly whatsAppService: WhatsAppService,
    private readonly selfServiceMenuService: SelfServiceMenuService,
    private readonly conversationStateService: WhatsappConversationStateService,
    private readonly conversationTicketService: WhatsappConversationTicketService,
    private readonly whatsappMediaService: WhatsappMediaService,
    private readonly whatsappOutboundLogService: WhatsappOutboundLogService,
    private readonly bankAccountService: BankAccountService,
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

    // Added 2026-09-16 — the same payload can also carry Meta's delivery-
    // status callbacks (change.value.statuses[]), previously ignored
    // entirely. Same webhook endpoint, same payload, so parsed and applied
    // right alongside the inbound events above — see extractStatusEvents.ts.
    let statusEvents: ParsedStatusEvent[] = [];
    try {
      statusEvents = extractStatusEvents(payload);
    } catch (error) {
      this.logger.error(
        'Failed to parse a WhatsApp delivery-status payload',
        error,
      );
      return;
    }

    for (const statusEvent of statusEvents) {
      await this.applyDeliveryStatusUpdate(statusEvent);
    }
  }

  // Looks up the WAMID against message_logs first, then
  // whatsapp_manual_replies — never both (a WAMID belongs to exactly one
  // outbound send). A WAMID matching neither (e.g. the status arrived
  // before the send's own row committed, or for a message type this app
  // doesn't log) is a silent no-op, not an error — same "never break the
  // ack" contract persistEvent already follows for inbound events.
  private async applyDeliveryStatusUpdate(
    event: ParsedStatusEvent,
  ): Promise<void> {
    try {
      const update = {
        deliveryStatus: event.status,
        deliveryStatusUpdatedAt: event.timestamp,
        lastErrorCode: event.errorCode,
        lastErrorTitle: event.errorTitle,
      };

      const logUpdateResult = await this.messageLogsRepository.update(
        { whatsappMessageId: event.whatsappMessageId },
        update,
      );
      if (logUpdateResult.affected) {
        return;
      }

      await this.manualRepliesRepository.update(
        { whatsappMessageId: event.whatsappMessageId },
        update,
      );
    } catch (error) {
      this.logger.error(
        `Failed to apply delivery-status update for WAMID ${event.whatsappMessageId}`,
        error,
      );
    }
  }

  // Human report, 2026-09-14 — backs WhatsappController's
  // inbound-messages/:id/media endpoint. Fetches straight from Meta on
  // every call rather than caching/persisting anywhere (see
  // WhatsappMediaService.fetchMediaBytes's own comment on why) — this is
  // the audio/video counterpart to mediaUrl, which is already-persisted
  // and served directly by the frontend without touching the API.
  async getInboundMedia(
    messageId: string,
  ): Promise<{ bytes: Buffer; mimeType: string }> {
    const message = await this.inboundMessagesRepository.findOne({
      where: { id: messageId },
    });
    if (!message || !message.metaMediaId) {
      throw new NotFoundException(
        'No hay un archivo de audio/video disponible para este mensaje.',
      );
    }

    const media = await this.whatsappMediaService.fetchMediaBytes(
      message.metaMediaId,
    );
    if (!media) {
      throw new NotFoundException(
        'El archivo ya no está disponible en WhatsApp.',
      );
    }
    return media;
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
    } else if (query.fromPhoneNumber) {
      // Human report, 2026-09-14 — scopes a single conversation's history
      // for an unrecognized number, which has no clientId to filter by.
      // Only meaningful when clientId isn't set — a real client's messages
      // are already scoped precisely enough by clientId alone.
      //
      // Human report, 2026-09-23 (critical bug) — from_phone_number is
      // stored exactly as Meta sent it (no "+"), but once an admin replies,
      // the conversation's latest event is a manual reply whose number IS
      // "+"-prefixed, so the panel started asking for "+57…" and matched
      // zero inbound rows: the client's own messages vanished from the
      // thread (still in the DB, just never fetched). Matches both shapes.
      const normalized = normalizeIncomingPhoneNumber(query.fromPhoneNumber);
      base.fromPhoneNumber = In([normalized, normalized.slice(1)]);
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

  // Human report, 2026-09-14 (critical bug) — the inbox used to build its
  // conversation list by grouping findAll()'s own flat, globally-limited
  // message fetch client-side (see groupIntoConversations's old comment on
  // WhatsappInboundMessagesPage.tsx). That budget is shared across EVERY
  // client's messages combined, not per conversation: one chatty client
  // can crowd the other 99 slots out of the page entirely, hiding a
  // conversation from the list (and from being closeable) even though its
  // WhatsappConversationTicket still counts toward the pending badge. This
  // aggregates one row per conversation (latest message + a total count)
  // directly in Postgres, so pagination is over CONVERSATIONS, not raw
  // events — a busy client is one page-item like everyone else. The
  // conversation's own full history is fetched separately, on demand, once
  // opened — see findAll's clientId/fromPhoneNumber filters above.
  //
  // Human report, 2026-09-16 — this used to aggregate ONLY
  // whatsapp_inbound_messages, so a client who was only ever SENT
  // something (a reminder via message_logs, a self-service/manual reply
  // via whatsapp_manual_replies) but never texted back had zero rows to
  // partition on and simply never appeared in the inbox. Now UNIONs all
  // three source tables before partitioning — see
  // buildConversationEventsCte's own comment for the grouping-key details.
  async findConversations(
    query: QueryWhatsappConversationsDto,
  ): Promise<PaginatedResult<WhatsappConversationSummary>> {
    // Human report, 2026-09-14 — the "Esperando asesor" queue needs the
    // exact conversation summary for every PENDING ticket's client, not
    // whatever happens to fall on a recency-paginated page: a client who's
    // gone quiet while their ticket sits unresolved must still show up.
    // See the DTO's own comment.
    if (query.clientIds && query.clientIds.length > 0) {
      return this.findConversationsForClientIds(query.clientIds);
    }

    const page = query.page ?? DEFAULT_PAGE;
    const limit = query.limit ?? DEFAULT_CONVERSATIONS_PAGE_SIZE;
    const search = query.search ? `%${query.search}%` : null;

    // DISTINCT ON isn't reachable through TypeORM's QueryBuilder once the
    // result also needs re-sorting/paginating by something other than the
    // DISTINCT ON expression itself (Postgres requires ORDER BY to lead
    // with it) — raw SQL here, same as this project's migrations and
    // apps/api/src/database/*.ts scripts already do for
    // Postgres-specific queries. Parameterized ($1/$2/$3), never string-
    // interpolated. message_count comes along for free from the same
    // window-function pass, no second per-conversation query needed.
    const rows: ConversationRow[] =
      await this.inboundMessagesRepository.manager.query(
        buildLatestPerConversationQuery(
          buildConversationEventsCte(),
          'LIMIT $2 OFFSET $3',
        ),
        [search, limit, (page - 1) * limit],
      );

    const [{ total: totalRaw }]: [{ total: string }] =
      await this.inboundMessagesRepository.manager.query(
        `
        WITH events AS (${buildConversationEventsCte()})
        SELECT COUNT(DISTINCT contact_key) AS total FROM events
        `,
        [search],
      );
    const total = Number(totalRaw);

    return {
      items: await this.hydrateConversationRows(rows),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  // Same aggregation as findConversations above, scoped to an exact set of
  // known clientIds and never paginated — see the DTO's own comment on
  // clientIds for why. Unmatched-number conversations are deliberately
  // unreachable here: a ticket only ever exists for a resolved client (see
  // WhatsappConversationTicket), so there's nothing to look up by phone
  // number for this queue — every source is filtered by client_id alone,
  // no phone-number COALESCE needed.
  private async findConversationsForClientIds(
    clientIds: string[],
  ): Promise<PaginatedResult<WhatsappConversationSummary>> {
    const rows: ConversationRow[] =
      await this.inboundMessagesRepository.manager.query(
        buildLatestPerConversationQuery(
          `
        SELECT m.id, 'inbound_message'::text AS source, m.client_id::text AS contact_key, m.received_at AS occurred_at
        FROM whatsapp_inbound_messages m
        WHERE m.client_id = ANY($1::uuid[])
        UNION ALL
        SELECT l.id, 'message_log'::text AS source, l.client_id::text AS contact_key, l.sent_at AS occurred_at
        FROM message_logs l
        WHERE l.client_id = ANY($1::uuid[])
        UNION ALL
        SELECT r.id, 'manual_reply'::text AS source, r.client_id::text AS contact_key, r.sent_at AS occurred_at
        FROM whatsapp_manual_replies r
        WHERE r.client_id = ANY($1::uuid[])
          `,
          '',
        ),
        [clientIds],
      );

    const items = await this.hydrateConversationRows(rows);
    return {
      items,
      meta: {
        page: 1,
        limit: items.length,
        total: items.length,
        totalPages: 1,
      },
    };
  }

  // Hydrates each winning (source, id) pair with the actual row's content,
  // one keyed lookup per source table (never N+1 — same batching pattern
  // the pre-existing inbound-only version already used via In()). In()
  // doesn't preserve input order — every source re-sorted back into the
  // same occurred_at DESC order `rows` already came back in, so the page
  // renders newest-conversation-first regardless of hydration order.
  private async hydrateConversationRows(
    rows: ConversationRow[],
  ): Promise<WhatsappConversationSummary[]> {
    const messageCountById = new Map(
      rows.map((row) => [row.id, Number(row.message_count)]),
    );
    const closedAtById = new Map(
      rows.map((row) => [
        row.id,
        row.closed_at ? new Date(row.closed_at).toISOString() : null,
      ]),
    );
    const idsBySource = {
      inbound_message: rows
        .filter((row) => row.source === 'inbound_message')
        .map((row) => row.id),
      message_log: rows
        .filter((row) => row.source === 'message_log')
        .map((row) => row.id),
      manual_reply: rows
        .filter((row) => row.source === 'manual_reply')
        .map((row) => row.id),
    };

    const [inboundMessages, messageLogs, manualReplies] = await Promise.all([
      idsBySource.inbound_message.length > 0
        ? this.inboundMessagesRepository.find({
            where: { id: In(idsBySource.inbound_message) },
            relations: { client: true },
          })
        : Promise.resolve([]),
      idsBySource.message_log.length > 0
        ? this.messageLogsRepository.find({
            where: { id: In(idsBySource.message_log) },
            relations: { client: true },
          })
        : Promise.resolve([]),
      idsBySource.manual_reply.length > 0
        ? this.manualRepliesRepository.find({
            where: { id: In(idsBySource.manual_reply) },
            relations: { client: true },
          })
        : Promise.resolve([]),
    ]);

    const inboundById = new Map(inboundMessages.map((m) => [m.id, m]));
    const logById = new Map(messageLogs.map((l) => [l.id, l]));
    const replyById = new Map(manualReplies.map((r) => [r.id, r]));

    const summaries: WhatsappConversationSummary[] = [];
    for (const row of rows) {
      if (row.source === 'inbound_message') {
        const message = inboundById.get(row.id);
        if (!message) continue;
        const lastEvent: WhatsappConversationLastEvent = {
          direction: 'inbound',
          message,
        };
        // Normalized to the same "+"-prefixed shape the outbound branches
        // below already use, so an unrecognized-number conversation keeps
        // the same key whether its latest event is inbound or a reply —
        // see buildConversationEventsCte's contact_key.
        const fromPhoneNumber = normalizeIncomingPhoneNumber(
          message.fromPhoneNumber,
        );
        summaries.push({
          key: message.clientId ?? fromPhoneNumber,
          clientId: message.clientId,
          fromPhoneNumber,
          lastEvent,
          messageCount: messageCountById.get(row.id) ?? 1,
          closedAt: closedAtById.get(row.id) ?? null,
        });
      } else if (row.source === 'message_log') {
        const log = logById.get(row.id);
        if (!log) continue;
        const lastEvent: WhatsappConversationLastEvent = {
          direction: 'outbound',
          source: 'message_log',
          id: log.id,
          occurredAt: log.sentAt.toISOString(),
          messageContent: log.messageContent,
          status: log.status === MessageLogStatus.Sent ? 'sent' : 'failed',
          client: log.client
            ? {
                id: log.client.id,
                firstName: log.client.firstName,
                lastName: log.client.lastName,
              }
            : null,
        };
        summaries.push({
          key: log.clientId,
          clientId: log.clientId,
          fromPhoneNumber: log.phoneNumber,
          lastEvent,
          messageCount: messageCountById.get(row.id) ?? 1,
          closedAt: closedAtById.get(row.id) ?? null,
        });
      } else {
        const reply = replyById.get(row.id);
        if (!reply) continue;
        const lastEvent: WhatsappConversationLastEvent = {
          direction: 'outbound',
          source: 'manual_reply',
          id: reply.id,
          occurredAt: reply.sentAt.toISOString(),
          messageContent: reply.messageContent,
          status:
            reply.status === WhatsappManualReplyStatus.Sent ? 'sent' : 'failed',
          client: reply.client
            ? {
                id: reply.client.id,
                firstName: reply.client.firstName,
                lastName: reply.client.lastName,
              }
            : null,
        };
        summaries.push({
          key: reply.clientId ?? reply.phoneNumber,
          clientId: reply.clientId,
          fromPhoneNumber: reply.phoneNumber,
          lastEvent,
          messageCount: messageCountById.get(row.id) ?? 1,
          closedAt: closedAtById.get(row.id) ?? null,
        });
      }
    }
    return summaries;
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
    //
    // Human report, 2026-09-14 — audio/video branch off here instead:
    // event.mediaId is just saved as-is onto metaMediaId, no Cloudinary
    // call at all (the client doesn't want that quota spent on those), see
    // WhatsappInboundMessage.metaMediaId's own comment.
    if (
      event.mediaId &&
      (event.type === WhatsappInboundMessageType.Audio ||
        event.type === WhatsappInboundMessageType.Video)
    ) {
      saved = await this.inboundMessagesRepository.save({
        ...saved,
        metaMediaId: event.mediaId,
      });
    } else if (event.mediaId) {
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
    const { sent, whatsappMessageId } =
      await this.whatsAppService.sendTextMessage(phoneNumber, message);

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
      whatsappMessageId,
    });

    return sent;
  }

  // Human report, 2026-09-24 — the inbox's "Enviar seguimiento" button.
  // Unlike sendManualReply this is a Meta template, so it reaches the
  // client even after their 24h session window closed; their reply then
  // reopens it for a normal manual reply. Works on any conversation,
  // recognized number or not — see buildFollowUpTemplateMessage for the
  // name fallback. Logged like a manual reply (sentByUserId = the admin
  // who pressed the button), so it shows in the thread as theirs.
  async sendFollowUpTemplate(
    rawPhoneNumber: string,
    sentByUserId: string,
  ): Promise<boolean> {
    const phoneNumber = normalizeIncomingPhoneNumber(rawPhoneNumber);
    // Matches either known number — see sendManualReply's identical
    // comment.
    const client = await this.clientsRepository.findOne({
      where: [{ phoneNumber }, { alternatePhoneNumber: phoneNumber }],
    });
    const { bodyParameters, messageContent } =
      buildFollowUpTemplateMessage(client);

    const { sent, whatsappMessageId } =
      await this.whatsAppService.sendTemplateMessage(
        phoneNumber,
        FOLLOW_UP_TEMPLATE_NAME,
        FOLLOW_UP_TEMPLATE_LANGUAGE_CODE,
        bodyParameters,
      );

    await this.whatsappOutboundLogService.log({
      clientId: client?.id ?? null,
      phoneNumber,
      messageContent,
      sentByUserId,
      sent,
      whatsappMessageId,
    });

    return sent;
  }

  // Human request, 2026-10-09 — the inbox's "Enviar cuenta bancaria"
  // button. Same shape as sendFollowUpTemplate above (a Meta template, so
  // it goes out at any time, logged like a manual reply), except {{1}} is
  // the account an admin entered from the panel — see BankAccountService.
  // Refuses to send rather than deliver a message with nowhere to pay.
  async sendBankAccountTemplate(
    rawPhoneNumber: string,
    sentByUserId: string,
  ): Promise<boolean> {
    const { bankAccount } = await this.bankAccountService.get();
    if (!bankAccount) {
      throw new BadRequestException(
        'Todavía no hay una cuenta bancaria configurada. Ingrésala en Plantillas de mensaje.',
      );
    }

    const phoneNumber = normalizeIncomingPhoneNumber(rawPhoneNumber);
    // Matches either known number — see sendManualReply's identical
    // comment.
    const client = await this.clientsRepository.findOne({
      where: [{ phoneNumber }, { alternatePhoneNumber: phoneNumber }],
    });
    const { bodyParameters, messageContent } =
      buildBankAccountTemplateMessage(bankAccount);

    const { sent, whatsappMessageId } =
      await this.whatsAppService.sendTemplateMessage(
        phoneNumber,
        BANK_ACCOUNT_TEMPLATE_NAME,
        BANK_ACCOUNT_TEMPLATE_LANGUAGE_CODE,
        bodyParameters,
      );

    await this.whatsappOutboundLogService.log({
      clientId: client?.id ?? null,
      phoneNumber,
      messageContent,
      sentByUserId,
      sent,
      whatsappMessageId,
    });

    return sent;
  }

  // Backs the inbox's thread. Human report, 2026-09-14 (critical bug) —
  // used to be a flat recent window across EVERY conversation's replies
  // combined, the exact same "shared global budget" bug findConversations'
  // own comment describes for inbound messages: a busy conversation's own
  // replies could push another conversation's replies out of the window
  // entirely. Now scoped to one conversation (clientId, or fromPhoneNumber
  // for an unrecognized number) — unscoped only for a caller that
  // genuinely wants the old flat cross-conversation window (none do
  // anymore; kept optional rather than required so this stays a additive,
  // backward-compatible change).
  async getManualReplies(
    query: QueryWhatsappManualRepliesDto = {},
  ): Promise<WhatsappManualReply[]> {
    const where: FindOptionsWhere<WhatsappManualReply> = {};
    if (query.clientId) {
      where.clientId = query.clientId;
    } else if (query.fromPhoneNumber) {
      where.phoneNumber = normalizeIncomingPhoneNumber(query.fromPhoneNumber);
    }

    return this.manualRepliesRepository.find({
      where: Object.keys(where).length > 0 ? where : undefined,
      order: { sentAt: 'DESC' },
      take: DEFAULT_PAGE_SIZE * 10,
    });
  }

  // Human report, 2026-09-16 — "¿cómo sabemos si un cliente nos bloqueó?".
  // Pulls the client's last DELIVERY_HEALTH_WINDOW outbound sends across
  // both tables (message_logs always has one clientId; a manual reply's is
  // nullable but this endpoint is only ever called for a known client),
  // merges and re-sorts (each side is already independently ordered/
  // capped, so this is never more than 2×WINDOW rows), then hands the
  // computation itself to the pure, independently-tested
  // computeDeliveryHealth. See that function's own comment on why
  // `possiblyBlocked` is evidence, not a verdict.
  async getDeliveryHealth(clientId: string): Promise<WhatsappDeliveryHealth> {
    const [logs, replies] = await Promise.all([
      this.messageLogsRepository.find({
        where: { clientId },
        order: { sentAt: 'DESC' },
        take: DELIVERY_HEALTH_WINDOW,
      }),
      this.manualRepliesRepository.find({
        where: { clientId },
        order: { sentAt: 'DESC' },
        take: DELIVERY_HEALTH_WINDOW,
      }),
    ]);

    const events = [...logs, ...replies]
      .sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime())
      .slice(0, DELIVERY_HEALTH_WINDOW)
      .map((event) => ({
        deliveryStatus: event.deliveryStatus,
        errorCode: event.lastErrorCode,
        errorTitle: event.lastErrorTitle,
      }));

    return computeDeliveryHealth(events);
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
    // Matches either known number — see sendManualReply's identical
    // comment.
    const client = await this.clientsRepository.findOne({
      where: [{ phoneNumber }, { alternatePhoneNumber: phoneNumber }],
    });
    // Human report, 2026-09-23 — "el mensaje solo debe llegar si el cliente
    // pidió hablar con el asesor recientemente, si no no debe enviarse".
    // Any chat can be closed now (see WhatsappConversationClosure), mostly
    // as the admin's own bookkeeping, and a client who never asked for
    // anyone shouldn't get a "gracias por contactarnos" out of nowhere.
    // "Recently" = their ticket is still pending with advisor_requested as
    // its latest trigger, i.e. nobody has closed that request yet.
    // Enforced here, not just in the panel — sendClosingMessage only ever
    // narrows this further (the admin can still skip it), never widens it.
    const ticket = client
      ? await this.conversationTicketService.findByClientId(client.id)
      : null;
    const clientAwaitsAdvisor =
      ticket?.status === WhatsappTicketStatus.Pending &&
      ticket.triggerKind === WhatsappTicketTriggerKind.AdvisorRequested;
    const shouldSendClosingMessage = sendClosingMessage && clientAwaitsAdvisor;

    const { sent, whatsappMessageId } = shouldSendClosingMessage
      ? await this.whatsAppService.sendTextMessage(
          phoneNumber,
          CONVERSATION_CLOSED_MESSAGE,
        )
      : { sent: false, whatsappMessageId: null };
    // Human report, 2026-09-19 — same "every outbound message needs a
    // record" reasoning as WhatsappOutboundLogService's own comment: this
    // closing message used to leave no trace in the conversation thread.
    // sentByUserId null since the admin only triggered it, they didn't
    // type this fixed message themselves. Skipped entirely (not logged as a
    // failed send) when no closing message was attempted — nothing real to
    // show in the thread.
    if (shouldSendClosingMessage) {
      await this.whatsappOutboundLogService.log({
        clientId: client?.id ?? null,
        phoneNumber,
        messageContent: CONVERSATION_CLOSED_MESSAGE,
        sentByUserId: null,
        sent,
        whatsappMessageId,
      });
    }
    await this.conversationStateService.clear(phoneNumber);
    // Human report, 2026-09-23 — any conversation can be closed now, not
    // only one with a hand-off ticket (see WhatsappConversationClosure).
    // Keyed exactly like findConversations' contact_key, so the list can
    // join it straight back onto the right row.
    await this.closuresRepository.upsert(
      { contactKey: client?.id ?? phoneNumber, closedAt: new Date() },
      ['contactKey'],
    );
    this.whatsappInboundGateway.emitConversationUpdate();
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
