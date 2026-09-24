import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { PaginatedResult } from '../common/interfaces/paginatedResult.interface';
import {
  bogotaEndOfDayUtc,
  bogotaStartOfDayUtc,
} from '../loans/dueDateSchedule';

import { QueryAuditLogDto } from './dto/queryAuditLog.dto';
import { AuditLog } from './entities/auditLog.entity';

const DEFAULT_PAGE = 1;
// 50, matching clients.service.ts's DEFAULT_PAGE_SIZE — see the same note
// in dashboard.service.ts (style cleanup 2026-09-05).
const DEFAULT_PAGE_SIZE = 50;
// A search box gets pasted into; nobody needs more than a name, a cédula and
// a pagaré number narrowing at once, and every word adds a subquery.
const MAX_SEARCH_WORDS = 5;

// Escapes ILIKE's own wildcards so a search for "50%" or "a_b" matches those
// literal characters instead of acting as a pattern. Postgres's default
// LIKE escape character is the backslash.
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

// Splits a free-text search into the words that must ALL match. A leading
// '#' is dropped so "#0928" and "0928" behave the same — labels render a
// pagaré as "#0928" but loans.promissory_note_number may be stored with or
// without the '#' (see formatPromissoryNoteLabel).
export function parseAuditSearchWords(search: string | undefined): string[] {
  if (!search) {
    return [];
  }
  return search
    .split(/\s+/)
    .map((word) => word.replace(/^#/, '').trim())
    .filter((word) => word.length > 0)
    .slice(0, MAX_SEARCH_WORDS);
}

// SQL fragments for "ids of every record connected to whatever :param
// matches", built once per search word. audit_logs.entity_id points at a
// client, a loan, an installment or a payment depending on the row, and
// those ids are all UUIDs, so one flat id set per word is enough — no need
// to pair it with entity_type.
//
// Resolved at query time instead of stored on each audit row (a loan's or
// payment's own audit entry carries no client name — just "Pagaré #0928"),
// which is what lets a search for a client's name also find everything done
// to their pagarés and payments, including entries logged long before this
// search existed. Soft-deleted/voided rows are deliberately included (raw
// SQL, no deleted_at filter): the trail must still be findable for a
// deactivated client or a voided payment.
function relatedRecordIdsSql(param: string): string {
  const clientIds = `
    SELECT c.id FROM clients c
    WHERE c.first_name ILIKE ${param}
       OR c.last_name ILIKE ${param}
       OR c.document_number ILIKE ${param}
       OR c.phone_number ILIKE ${param}
       OR c.alternate_phone_number ILIKE ${param}`;
  const loanIds = `
    SELECT l.id FROM loans l
    WHERE l.client_id IN (${clientIds})
       OR l.co_debtor_client_id IN (${clientIds})
       OR l.promissory_note_number ILIKE ${param}`;
  const installmentIds = `
    SELECT i.id FROM installments i WHERE i.loan_id IN (${loanIds})`;
  const paymentIds = `
    SELECT p.id FROM payments p WHERE p.installment_id IN (${installmentIds})`;

  return `${clientIds} UNION ${loanIds} UNION ${installmentIds} UNION ${paymentIds}`;
}

export interface RecordAuditLogEntry {
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: Record<string, unknown> | null;
  entityLabel: string | null;
}

@Injectable()
export class AuditLogService {
  constructor(
    @InjectRepository(AuditLog)
    private readonly auditLogsRepository: Repository<AuditLog>,
  ) {}

  // Called by AuditLogInterceptor only — no controller ever calls this
  // directly, the whole point is that logging happens automatically for
  // any endpoint decorated with @Audit(), not via a call sprinkled into
  // each service method (see docs/phases/PHASE_11_AUDIT_LOG.md's "Scope
  // decisions").
  async record(entry: RecordAuditLogEntry): Promise<void> {
    await this.auditLogsRepository.save(this.auditLogsRepository.create(entry));
  }

  // Same filter/pagination shape as MessageLogsService.findAll — see
  // whatsapp/messageLogs/messageLogs.service.ts.
  async findAll(query: QueryAuditLogDto): Promise<PaginatedResult<AuditLog>> {
    const page = query.page ?? DEFAULT_PAGE;
    const limit = query.limit ?? DEFAULT_PAGE_SIZE;

    const qb = this.auditLogsRepository
      .createQueryBuilder('log')
      .leftJoinAndSelect('log.actorUser', 'actorUser');

    if (query.actorUserId) {
      qb.andWhere('log.actorUserId = :actorUserId', {
        actorUserId: query.actorUserId,
      });
    }
    if (query.action) {
      qb.andWhere('log.action = :action', { action: query.action });
    }
    if (query.entityType) {
      qb.andWhere('log.entityType = :entityType', {
        entityType: query.entityType,
      });
    }
    // Bug fix, 2026-09-05 — was `new Date(query.dateFrom)`/`new
    // Date(query.dateTo)` directly, which parses a plain 'YYYY-MM-DD' as
    // UTC midnight, 5 hours before midnight in Bogotá. dateTo was the
    // worse of the two: its cutoff landed hours before the selected day
    // even started locally, so filtering "Hasta: 31 de enero" silently
    // excluded ALL of the 31st (and part of the 30th) instead of
    // including it. See bogotaStartOfDayUtc/bogotaEndOfDayUtc's own
    // comments in dueDateSchedule.ts for the exact math.
    if (query.dateFrom) {
      qb.andWhere('log.createdAt >= :dateFrom', {
        dateFrom: bogotaStartOfDayUtc(query.dateFrom),
      });
    }
    if (query.dateTo) {
      qb.andWhere('log.createdAt <= :dateTo', {
        dateTo: bogotaEndOfDayUtc(query.dateTo),
      });
    }

    // One clause per word, ANDed: "Juana 0928" finds entries matching
    // "Juana" AND matching "0928" — a payment on Juana's pagaré #0928
    // qualifies, one on her other pagaré doesn't. See relatedRecordIdsSql.
    parseAuditSearchWords(query.search).forEach((word, index) => {
      const param = `searchWord${index}`;
      qb.andWhere(
        `(log.entityLabel ILIKE :${param} OR log.entityId IN (${relatedRecordIdsSql(`:${param}`)}))`,
        { [param]: `%${escapeLikePattern(word)}%` },
      );
    });

    const [items, total] = await qb
      .orderBy('log.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return {
      items,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  // Feeds the "Usuario" filter dropdown: only people who actually appear in
  // the trail, so it never offers someone with nothing to find. A user
  // permanently deleted since (actor_user_id SET NULL, see AuditLog) drops
  // out — their old entries stay visible, just no longer filterable by name.
  async findActors(): Promise<{ id: string; fullName: string }[]> {
    return this.auditLogsRepository
      .createQueryBuilder('log')
      .innerJoin('log.actorUser', 'actor')
      .select('actor.id', 'id')
      .addSelect('actor.fullName', 'fullName')
      .distinct(true)
      .orderBy('actor.fullName', 'ASC')
      .getRawMany<{ id: string; fullName: string }>();
  }

  // Feeds the "Acción"/"Entidad" filter dropdowns from what is ACTUALLY in the
  // trail instead of a hardcoded list that has to be kept in sync with every
  // new @Audit() call (the frontend's label map was chronically behind — see
  // auditLogLabels.ts). Each action carries its entityType so the two
  // dropdowns can narrow each other.
  async findActions(): Promise<{ action: string; entityType: string }[]> {
    return this.auditLogsRepository
      .createQueryBuilder('log')
      .select('log.action', 'action')
      .addSelect('log.entityType', 'entityType')
      .distinct(true)
      .orderBy('log.action', 'ASC')
      .getRawMany<{ action: string; entityType: string }>();
  }
}
