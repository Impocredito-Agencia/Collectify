import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Between,
  FindOptionsWhere,
  LessThanOrEqual,
  MoreThanOrEqual,
  Repository,
} from 'typeorm';

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

    const where: FindOptionsWhere<AuditLog> = {};
    if (query.actorUserId) {
      where.actorUserId = query.actorUserId;
    }
    if (query.action) {
      where.action = query.action;
    }
    if (query.entityType) {
      where.entityType = query.entityType;
    }
    // Bug fix, 2026-09-05 — was `new Date(query.dateFrom)`/`new
    // Date(query.dateTo)` directly, which parses a plain 'YYYY-MM-DD' as
    // UTC midnight, 5 hours before midnight in Bogotá. dateTo was the
    // worse of the two: its cutoff landed hours before the selected day
    // even started locally, so filtering "Hasta: 31 de enero" silently
    // excluded ALL of the 31st (and part of the 30th) instead of
    // including it. See bogotaStartOfDayUtc/bogotaEndOfDayUtc's own
    // comments in dueDateSchedule.ts for the exact math.
    if (query.dateFrom && query.dateTo) {
      where.createdAt = Between(
        bogotaStartOfDayUtc(query.dateFrom),
        bogotaEndOfDayUtc(query.dateTo),
      );
    } else if (query.dateFrom) {
      where.createdAt = MoreThanOrEqual(bogotaStartOfDayUtc(query.dateFrom));
    } else if (query.dateTo) {
      where.createdAt = LessThanOrEqual(bogotaEndOfDayUtc(query.dateTo));
    }

    const [items, total] = await this.auditLogsRepository.findAndCount({
      where,
      relations: { actorUser: true },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      items,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }
}
