import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Between,
  FindOptionsWhere,
  ILike,
  LessThanOrEqual,
  MoreThanOrEqual,
  Repository,
} from 'typeorm';

import { PaginatedResult } from '../../common/interfaces/paginatedResult.interface';
import {
  bogotaEndOfDayUtc,
  bogotaStartOfDayUtc,
} from '../../loans/dueDateSchedule';
import { MessageLog, MessageLogStatus } from '../entities/messageLog.entity';
import { MessageLogItem } from '../entities/messageLogItem.entity';
import { MessageType } from '../messageType.enum';
import { NewLoanReminderService } from '../newLoanReminder.service';
import { OverdueReminderService } from '../overdueReminder.service';
import { PaymentConfirmationService } from '../paymentConfirmation.service';
import { OVERDUE_FAMILY_TYPES, UPCOMING_FAMILY_TYPES } from '../reminderFamily';
import { UpcomingDueReminderService } from '../upcomingDueReminder.service';

import { QueryMessageLogsDto } from './dto/queryMessageLogs.dto';

const DEFAULT_PAGE = 1;
// 50, matching clients.service.ts's DEFAULT_PAGE_SIZE — see the same note
// in dashboard.service.ts (style cleanup 2026-09-05).
const DEFAULT_PAGE_SIZE = 50;

@Injectable()
export class MessageLogsService {
  constructor(
    @InjectRepository(MessageLog)
    private readonly messageLogsRepository: Repository<MessageLog>,
    @InjectRepository(MessageLogItem)
    private readonly messageLogItemsRepository: Repository<MessageLogItem>,
    private readonly overdueReminderService: OverdueReminderService,
    private readonly upcomingDueReminderService: UpcomingDueReminderService,
    private readonly newLoanReminderService: NewLoanReminderService,
    private readonly paymentConfirmationService: PaymentConfirmationService,
  ) {}

  async findAll(
    query: QueryMessageLogsDto,
  ): Promise<PaginatedResult<MessageLog>> {
    const page = query.page ?? DEFAULT_PAGE;
    const limit = query.limit ?? DEFAULT_PAGE_SIZE;

    const base: FindOptionsWhere<MessageLog> = {};
    if (query.clientId) {
      base.clientId = query.clientId;
    }
    if (query.type) {
      base.type = query.type;
    }
    if (query.status) {
      base.status = query.status;
    }
    // Bug fix, 2026-09-05 — same root cause and fix as
    // AuditLogService.findAll: `new Date(query.dateFrom/dateTo)` parses a
    // plain 'YYYY-MM-DD' as UTC midnight, 5 hours before midnight in
    // Bogotá. dateTo was the worse of the two — its cutoff landed hours
    // before the selected day even started locally, so filtering "Hasta"
    // a given day silently excluded that whole day's messages instead of
    // including them. See bogotaStartOfDayUtc/bogotaEndOfDayUtc's own
    // comments in dueDateSchedule.ts for the exact math.
    if (query.dateFrom && query.dateTo) {
      base.sentAt = Between(
        bogotaStartOfDayUtc(query.dateFrom),
        bogotaEndOfDayUtc(query.dateTo),
      );
    } else if (query.dateFrom) {
      base.sentAt = MoreThanOrEqual(bogotaStartOfDayUtc(query.dateFrom));
    } else if (query.dateTo) {
      base.sentAt = LessThanOrEqual(bogotaEndOfDayUtc(query.dateTo));
    }

    // The list screen shows the client's name, not just their id, and
    // `search` (added for the Mensajes list's search box) matches against
    // it — an array of where objects here is an OR of each variant, each
    // still combined with every filter above.
    const search = query.search ? `%${query.search}%` : undefined;
    const where: FindOptionsWhere<MessageLog>[] | FindOptionsWhere<MessageLog> =
      search
        ? [
            { ...base, client: { firstName: ILike(search) } },
            { ...base, client: { lastName: ILike(search) } },
          ]
        : base;

    const [items, total] = await this.messageLogsRepository.findAndCount({
      where,
      relations: { client: true },
      order: { sentAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      items,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  // Backs the "Mensaje completo" drawer's related-installments section
  // (Fase 5 client UI) — a single overdue reminder can cover several
  // installments across several loans (it's consolidated per client, not
  // per loan), so this returns a list, not a single "related loan".
  async getItems(id: string): Promise<MessageLogItem[]> {
    const log = await this.messageLogsRepository.findOneBy({ id });
    if (!log) {
      throw new NotFoundException(`Message log with id ${id} not found`);
    }

    return this.messageLogItemsRepository.find({
      where: { messageLogId: id },
      relations: { installment: { loan: true } },
      order: { createdAt: 'ASC' },
    });
  }

  // Manual retry (Phase 18) — append-only, per the entity comment: the
  // original row is stamped with retriedAt, and the new send creates a
  // fresh row pointing back at it via retryOfMessageLogId. Re-sends with
  // allowEmpty, since the client's situation may have changed since the
  // original attempt failed — the retry's purpose is to get a message out,
  // not to re-validate whether one is still owed. See
  // docs/phases/PHASE_18_MESSAGE_AUDIENCES.md.
  async retry(id: string): Promise<MessageLog> {
    const original = await this.messageLogsRepository.findOneBy({ id });
    if (!original) {
      throw new NotFoundException(`Message log with id ${id} not found`);
    }
    if (original.status !== MessageLogStatus.Failed) {
      throw new BadRequestException('Only failed messages can be retried');
    }

    const retryLog = await this.dispatchRetry(original);
    // Human report, 2026-09-11 — PaymentConfirmation/PaidInFull return null
    // instead of a MessageLog while paymentConfirmationPaused is on (see
    // PaymentConfirmationService), so there's nothing to stamp retriedAt
    // against yet. Surfaced as a clear error rather than a null-pointer
    // crash — the admin can retry again once that flag is off.
    if (!retryLog) {
      throw new BadRequestException(
        'Los mensajes de confirmación de pago están pausados temporalmente — no se puede reintentar en este momento.',
      );
    }

    await this.messageLogsRepository.update(
      { id: original.id },
      { retriedAt: new Date() },
    );
    await this.messageLogsRepository.update(
      { id: retryLog.id },
      { retryOfMessageLogId: original.id },
    );

    return retryLog;
  }

  // Phase 33 — the old switch-per-exact-type dispatch doesn't scale to 13
  // template types, so this groups by family instead (see
  // reminderFamily.ts and docs/phases/PHASE_33_MESSAGE_TEMPLATES_V2.md).
  private async dispatchRetry(
    original: MessageLog,
  ): Promise<MessageLog | null> {
    if (OVERDUE_FAMILY_TYPES.includes(original.type)) {
      return this.overdueReminderService.sendReminderForClient(
        original.clientId,
        { allowEmpty: true },
      );
    }
    if (UPCOMING_FAMILY_TYPES.includes(original.type)) {
      return this.upcomingDueReminderService.sendReminderForClient(
        original.clientId,
        { allowEmpty: true },
      );
    }

    // Everything below is keyed by loan/installment, not client — recover
    // it through any of the message's items (they all belong to the same
    // loan, since each of these sends gathers installments by loanId).
    const item = await this.messageLogItemsRepository.findOne({
      where: { messageLogId: original.id },
      relations: { installment: true },
    });
    if (!item) {
      throw new BadRequestException(
        `Cannot retry message log ${original.id}: no related installments found`,
      );
    }

    switch (original.type) {
      case MessageType.NewLoanNewClient:
      case MessageType.NewLoanNewClientInitialInstallment:
      case MessageType.NewLoanExistingClient:
      case MessageType.NewLoanExistingClientInitialInstallment:
      case MessageType.RefinanceSingleLoan:
        return this.newLoanReminderService.sendNewLoanMessage(
          item.installment.loanId,
        );
      case MessageType.PaymentConfirmation:
        return this.paymentConfirmationService.sendPaymentConfirmation(
          item.installmentId,
        );
      case MessageType.PaidInFull:
        return this.paymentConfirmationService.sendPaidInFull(
          item.installment.loanId,
        );
      default:
        throw new BadRequestException(
          `Message log ${original.id} has an unsupported type for retry: ${original.type}`,
        );
    }
  }
}
