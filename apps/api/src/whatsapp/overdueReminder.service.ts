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
import { addDaysToDateString, todayDateString } from '../loans/dueDateSchedule';
import { Installment } from '../loans/entities/installment.entity';
import { Payment } from '../loans/entities/payment.entity';

import { MessageLog, MessageLogStatus } from './entities/messageLog.entity';
import { MessageLogItem } from './entities/messageLogItem.entity';
import { MessageFrequencyThrottleService } from './messageFrequencyThrottle.service';
import { MessageTemplatesService } from './messageTemplates/messageTemplates.service';
import { NotaAdicionalInput, NotaAdicionalState } from './notaAdicional';
import { OVERDUE_FAMILY_TYPES } from './reminderFamily';
import {
  findClientIdsWithOverdueInstallments,
  findClientIdsWithUpcomingInstallments,
  findOverdueInstallmentsForClient,
  findUpcomingInstallmentsForClient,
} from './reminderInstallmentQueries';
import { selectReminderTemplate } from './reminderTemplateSelection';
import { computeSaldoPendiente } from './saldoPendiente';
import { WhatsAppService } from './whatsapp.service';

// Phase 33 rewrite — picks among 4 templates (SingleOverdueInstallment,
// SingleOverdueInstallmentWithSurcharge, MultipleOverdueInstallments,
// UpcomingAndOverdueMixed), see reminderTemplateSelection.ts.
//
// The weekly cron deliberately EXCLUDES a client who currently also has an
// upcoming installment — the daily job (UpcomingDueReminderService) covers
// them with the fuller mixed picture instead, so the two jobs never both
// pick UpcomingAndOverdueMixed for the same client on the same day.
// Confirmed with the human (2026-09-01): keep the existing two-job
// structure (one per family, not one per exact template) rather than
// fragmenting further. sendReminderForClient itself (used by the manual
// on-demand endpoint too) always looks at both sets regardless — an admin
// explicitly asking for one client's status should see the accurate
// picture, exclusion only applies to which clients the automated weekly
// run picks up.
@Injectable()
export class OverdueReminderService {
  private readonly logger = new Logger(OverdueReminderService.name);

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

  async runWeeklyReminder(): Promise<void> {
    const overdueClientIds = await findClientIdsWithOverdueInstallments(
      this.installmentsRepository,
    );
    const upcomingClientIds = new Set(
      await findClientIdsWithUpcomingInstallments(
        this.installmentsRepository,
        this.upcomingTargetDates(),
      ),
    );
    const dynamicClientIds = overdueClientIds.filter(
      (clientId) => !upcomingClientIds.has(clientId),
    );

    const clientIds =
      await this.messageFrequencyThrottleService.filterOutThrottledClients(
        dynamicClientIds,
        OVERDUE_FAMILY_TYPES,
      );
    this.logger.log(
      `Weekly overdue reminder: ${clientIds.length} client(s) to notify`,
    );

    for (const clientId of clientIds) {
      try {
        await this.sendReminderForClient(clientId);
      } catch (error) {
        this.logger.error(
          `Failed to send overdue reminder to client ${clientId}`,
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

    const overdue = await findOverdueInstallmentsForClient(
      this.installmentsRepository,
      clientId,
    );
    if (overdue.length === 0 && !options?.allowEmpty) {
      throw new BadRequestException(
        `Client ${clientId} has no overdue installments across their active loans`,
      );
    }
    const upcoming = await findUpcomingInstallmentsForClient(
      this.installmentsRepository,
      clientId,
      this.upcomingTargetDates(),
    );
    // The template catalog has no "nothing to report" variant (unlike the
    // old account_summary message, which could render an empty/$0 list) —
    // allowEmpty only relaxes the overdue-specific guard above, it can't
    // manufacture a template when there's truly nothing in either set
    // (e.g. a retry where the underlying installment was paid off since
    // the original failed attempt).
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
    const sent = await this.whatsAppService.sendTemplateMessage(
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

  // See saldoPendiente.ts — derived from existing Payment rows, never
  // guessed. Saldo a favor isn't detected here yet, see that module's doc
  // comment.
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

  private upcomingTargetDates(): string[] {
    const today = todayDateString();
    const { upcomingDueReminderDays } = this.configService.get('cron', {
      infer: true,
    });
    return upcomingDueReminderDays.map((days) =>
      addDaysToDateString(today, days),
    );
  }
}
