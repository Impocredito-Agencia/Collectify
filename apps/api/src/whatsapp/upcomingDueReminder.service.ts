import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { Client } from '../clients/entities/client.entity';
import { Configuration } from '../config/configuration';
import { Installment } from '../loans/entities/installment.entity';
import { Payment } from '../loans/entities/payment.entity';

import { MessageLog, MessageLogStatus } from './entities/messageLog.entity';
import { MessageLogItem } from './entities/messageLogItem.entity';
import { MessageFrequencyThrottleService } from './messageFrequencyThrottle.service';
import { MessageTemplatesService } from './messageTemplates/messageTemplates.service';
import { NotaAdicionalInput, NotaAdicionalState } from './notaAdicional';
import { UPCOMING_FAMILY_TYPES } from './reminderFamily';
import {
  findClientIdsWithOverdueInstallments,
  findClientIdsWithUpcomingInstallments,
  findOverdueInstallmentsForClient,
  findUpcomingInstallmentsForClient,
} from './reminderInstallmentQueries';
import { selectReminderTemplate } from './reminderTemplateSelection';
import { computeSaldoPendiente } from './saldoPendiente';
import { WhatsAppService } from './whatsapp.service';

// Phase 33 rewrite — picks among SingleUpcomingInstallment,
// MultipleUpcomingInstallments, and UpcomingAndOverdueMixed, see
// reminderTemplateSelection.ts.
//
// Reversed 2026-09-07 (human) — the daily job now EXCLUDES a client who
// currently also has an overdue installment; the weekly job
// (OverdueReminderService) covers them with the mixed picture instead, so
// the two jobs never both pick UpcomingAndOverdueMixed for the same client
// on the same day. Rationale (human): overdue installments take
// precedence over upcoming ones, so the overdue-focused job should be the
// one that owns the mixed case, not this one. This is the inverse of the
// original Phase 33 assignment (confirmed 2026-09-01) — see
// OverdueReminderService's doc comment for the full reasoning.
@Injectable()
export class UpcomingDueReminderService {
  private readonly logger = new Logger(UpcomingDueReminderService.name);

  constructor(
    @InjectRepository(Client)
    private readonly clientsRepository: Repository<Client>,
    @InjectRepository(Installment)
    private readonly installmentsRepository: Repository<Installment>,
    @InjectRepository(Payment)
    private readonly paymentsRepository: Repository<Payment>,
    @InjectRepository(MessageLog)
    private readonly messageLogsRepository: Repository<MessageLog>,
    @InjectRepository(MessageLogItem)
    private readonly messageLogItemsRepository: Repository<MessageLogItem>,
    private readonly messageTemplatesService: MessageTemplatesService,
    private readonly messageFrequencyThrottleService: MessageFrequencyThrottleService,
    private readonly whatsAppService: WhatsAppService,
    private readonly configService: ConfigService<Configuration, true>,
  ) {}

  async runDailyReminder(): Promise<void> {
    const upcomingClientIds = await findClientIdsWithUpcomingInstallments(
      this.installmentsRepository,
      this.maxUpcomingDaysUntilDue(),
    );
    const overdueClientIds = new Set(
      await findClientIdsWithOverdueInstallments(this.installmentsRepository),
    );
    const dynamicClientIds = upcomingClientIds.filter(
      (clientId) => !overdueClientIds.has(clientId),
    );

    const clientIds =
      await this.messageFrequencyThrottleService.filterOutThrottledClients(
        dynamicClientIds,
        UPCOMING_FAMILY_TYPES,
      );
    this.logger.log(
      `Daily upcoming-due reminder: ${clientIds.length} client(s) to notify`,
    );

    for (const clientId of clientIds) {
      try {
        await this.sendReminderForClient(clientId);
      } catch (error) {
        this.logger.error(
          `Failed to send upcoming-due reminder to client ${clientId}`,
          error,
        );
      }
    }
  }

  async sendReminderForClient(
    clientId: string,
    options?: { allowEmpty?: boolean },
  ): Promise<MessageLog> {
    const client = await this.clientsRepository.findOneBy({ id: clientId });
    if (!client) {
      throw new NotFoundException(`Client with id ${clientId} not found`);
    }

    const upcoming = await findUpcomingInstallmentsForClient(
      this.installmentsRepository,
      clientId,
      this.maxUpcomingDaysUntilDue(),
    );
    if (upcoming.length === 0 && !options?.allowEmpty) {
      throw new BadRequestException(
        `Client ${clientId} has no installments approaching their due date across their active loans`,
      );
    }
    const overdue = await findOverdueInstallmentsForClient(
      this.installmentsRepository,
      clientId,
    );
    // See OverdueReminderService's identical guard for why this can't be
    // relaxed further by allowEmpty — there's no "nothing to report"
    // template in the catalog.
    if (overdue.length === 0 && upcoming.length === 0) {
      throw new BadRequestException(
        `Client ${clientId} has no overdue or upcoming installments to report`,
      );
    }

    const notaAdicional = await this.resolveNotaAdicional(overdue, upcoming);
    const selection = selectReminderTemplate(
      `${client.firstName} ${client.lastName}`,
      overdue,
      upcoming,
      notaAdicional,
    );

    const template = await this.messageTemplatesService.findByTypeOrThrow(
      selection.type,
    );
    const { sent, whatsappMessageId } =
      await this.whatsAppService.sendTemplateMessage(
        client.phoneNumber,
        template.metaTemplateName,
        template.metaLanguageCode,
        selection.bodyParameters,
      );

    const messageLog = this.messageLogsRepository.create({
      clientId,
      type: selection.type,
      phoneNumber: client.phoneNumber,
      messageContent: selection.bodyParameters.join(' | '),
      status: sent ? MessageLogStatus.Sent : MessageLogStatus.Failed,
      sentAt: new Date(),
      whatsappMessageId,
    });
    const savedLog = await this.messageLogsRepository.save(messageLog);

    const items = [
      ...overdue.map((installment) =>
        this.messageLogItemsRepository.create({
          messageLogId: savedLog.id,
          installmentId: installment.id,
          overdueDaysSnapshot: installment.overdueDays,
          interestSnapshot: installment.totalDue - installment.amount,
        }),
      ),
      ...upcoming.map((installment) =>
        this.messageLogItemsRepository.create({
          messageLogId: savedLog.id,
          installmentId: installment.id,
          overdueDaysSnapshot: 0,
          interestSnapshot: 0,
        }),
      ),
    ];
    await this.messageLogItemsRepository.save(items);

    return savedLog;
  }

  private async resolveNotaAdicional(
    overdue: { id: string; amount: number }[],
    upcoming: { id: string; amount: number }[],
  ): Promise<NotaAdicionalInput> {
    const installmentIds = [...overdue, ...upcoming].map((i) => i.id);
    if (installmentIds.length === 0) {
      return { state: NotaAdicionalState.Normal };
    }
    const payments = await this.paymentsRepository.find({
      where: { installmentId: In(installmentIds) },
    });
    const saldoPendiente = computeSaldoPendiente(
      [...overdue, ...upcoming],
      payments,
    );
    return saldoPendiente > 0
      ? { state: NotaAdicionalState.SaldoPendiente, amount: saldoPendiente }
      : { state: NotaAdicionalState.Normal };
  }

  // Reworked 2026-09-07 alongside reminderInstallmentQueries.ts's move to a
  // cumulative window ("due within N days" instead of three exact
  // checkpoints) — UPCOMING_DUE_REMINDER_DAYS simplified from a
  // comma-separated list to a single number the same day, once only its
  // max was ever used. Kept as its own method (rather than inlining the
  // config read at each call site) for a self-documenting name.
  private maxUpcomingDaysUntilDue(): number {
    const { upcomingDueReminderDays } = this.configService.get('cron', {
      infer: true,
    });
    return upcomingDueReminderDays;
  }
}
