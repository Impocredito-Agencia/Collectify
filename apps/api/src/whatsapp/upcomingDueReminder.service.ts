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
import { UPCOMING_FAMILY_TYPES } from './reminderFamily';
import {
  findClientIdsWithUpcomingInstallments,
  findOverdueInstallmentsForClient,
  findUpcomingInstallmentsForClient,
} from './reminderInstallmentQueries';
import { selectReminderTemplate } from './reminderTemplateSelection';
import { computeSaldoPendiente } from './saldoPendiente';
import { WhatsAppService } from './whatsapp.service';

// Phase 33 rewrite — picks among SingleUpcomingInstallment,
// MultipleUpcomingInstallments, and UpcomingAndOverdueMixed, see
// reminderTemplateSelection.ts. Unlike OverdueReminderService's weekly
// job, the daily job here does NOT exclude anyone — it's the one that owns
// the mixed picture (see OverdueReminderService's doc comment for why).
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
    const dynamicClientIds = await findClientIdsWithUpcomingInstallments(
      this.installmentsRepository,
      this.upcomingTargetDates(),
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
      this.upcomingTargetDates(),
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
