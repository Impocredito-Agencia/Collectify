import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { Client } from '../clients/entities/client.entity';
import { addDaysToDateString, todayDateString } from '../loans/dueDateSchedule';
import {
  Installment,
  InstallmentStatus,
} from '../loans/entities/installment.entity';
import { Loan, LoanStatus } from '../loans/entities/loan.entity';
import { LoanInstallmentConcept } from '../loans/entities/loanInstallmentConcept.entity';
import { Payment } from '../loans/entities/payment.entity';

import {
  CREDIT_REPORT_MORA_DAYS,
  findOldestOverdueInstallment,
  selectCreditReportTemplate,
} from './creditReportTemplateSelection';
import { MessageLog, MessageLogStatus } from './entities/messageLog.entity';
import { MessageLogItem } from './entities/messageLogItem.entity';
import { MessageChannel } from './messageChannel.enum';
import { MessageType } from './messageType.enum';
import { MessageTemplatesService } from './messageTemplates/messageTemplates.service';
import { renderReminderBreakdown } from './reminderBreakdown';
import {
  buildPlannedLogItems,
  isClientGroup,
  PlannedReminder,
} from './reminderPlan';
import { findOverdueInstallmentsForClient } from './reminderInstallmentQueries';
import {
  groupInstallmentsByRecipient,
  restrictToTargetPhoneNumber,
} from './reminderRecipientGrouping';
import { renderTemplateBody } from './templateBodyRenderer';
import { WhatsAppService } from './whatsapp.service';

// Client request, 2026-10-30 — the Datacrédito notices. One message per
// pagaré, since each template names a single one. Unlike the overdue reminder
// this is deliberately NOT cumulative: a day the job doesn't run (paused,
// schedule edited, server down) is not caught up later, because the message
// would state a day count that's no longer true.
export interface PlannedCreditReport {
  clientId: string;
  type: MessageType;
  // The cuota whose day count triggered the notice — the "already sent"
  // key, see wasAlreadySent.
  oldestInstallmentId: string | null;
  plans: PlannedReminder[];
}

@Injectable()
export class CreditReportReminderService {
  private readonly logger = new Logger(CreditReportReminderService.name);

  constructor(
    @InjectRepository(Client)
    private readonly clientsRepository: Repository<Client>,
    @InjectRepository(Loan)
    private readonly loansRepository: Repository<Loan>,
    @InjectRepository(Installment)
    private readonly installmentsRepository: Repository<Installment>,
    @InjectRepository(Payment)
    private readonly paymentsRepository: Repository<Payment>,
    @InjectRepository(LoanInstallmentConcept)
    private readonly loanInstallmentConceptsRepository: Repository<LoanInstallmentConcept>,
    @InjectRepository(MessageLog)
    private readonly messageLogsRepository: Repository<MessageLog>,
    @InjectRepository(MessageLogItem)
    private readonly messageLogItemsRepository: Repository<MessageLogItem>,
    private readonly messageTemplatesService: MessageTemplatesService,
    private readonly whatsAppService: WhatsAppService,
  ) {}

  async runDailyReminder(): Promise<void> {
    const loanIds = await this.findLoanIdsDueForNotice();
    this.logger.log(
      `Credit report notice: ${loanIds.length} candidate loan(s)`,
    );
    for (const loanId of loanIds) {
      try {
        await this.sendForLoan(loanId, { skipIfAlreadySent: true });
      } catch (error) {
        this.logger.error(
          `Failed to send credit report notice for loan ${loanId}`,
          error,
        );
      }
    }
  }

  // Loans with a pending cuota exactly 30 or 50 days overdue today — the
  // only days a notice can go out. Shared with the email/SMS notices
  // (ChannelReminderService), which then keep only their selected clients.
  async findLoanIdsDueForNotice(): Promise<string[]> {
    const today = todayDateString();
    const candidates = await this.installmentsRepository.find({
      where: {
        status: InstallmentStatus.Pending,
        dueDate: In(
          CREDIT_REPORT_MORA_DAYS.map((days) =>
            addDaysToDateString(today, -days),
          ),
        ),
        loan: { status: LoanStatus.Active },
      },
    });
    return [...new Set(candidates.map((i) => i.loanId))];
  }

  // targetPhoneNumbers — a manual retry (MessageLogsService.dispatchRetry),
  // same contract as OverdueReminderService. A retry throws when today isn't a
  // notice day anymore, instead of telling the client a stale day count.
  //
  // skipIfAlreadySent — the cron path: guards a legal notice against going out
  // twice when the admin changes the schedule mid-day. Keyed on the oldest
  // cuota, so another cuota later reaching the same day still gets its notice.
  async sendForLoan(
    loanId: string,
    options?: { targetPhoneNumbers?: string[]; skipIfAlreadySent?: boolean },
  ): Promise<MessageLog[]> {
    const planned = await this.planForLoan(loanId, options);
    if (!planned) {
      return [];
    }
    if (
      options?.skipIfAlreadySent &&
      (await this.wasAlreadySent(planned, MessageChannel.WhatsApp))
    ) {
      return [];
    }

    const template = await this.messageTemplatesService.findByTypeOrThrow(
      planned.type,
    );
    const savedLogs: MessageLog[] = [];
    for (const plan of planned.plans) {
      for (const phoneNumber of plan.recipientPhoneNumbers) {
        const { sent, whatsappMessageId } =
          await this.whatsAppService.sendTemplateMessage(
            phoneNumber,
            template.metaTemplateName,
            template.metaLanguageCode,
            plan.bodyParameters,
          );
        const savedLog = await this.messageLogsRepository.save(
          this.messageLogsRepository.create({
            clientId: planned.clientId,
            type: plan.type,
            phoneNumber,
            messageContent: renderTemplateBody(
              template.content,
              plan.bodyParameters,
            ),
            breakdownContent: plan.breakdownContent,
            status: sent ? MessageLogStatus.Sent : MessageLogStatus.Failed,
            sentAt: new Date(),
            whatsappMessageId,
          }),
        );
        await this.messageLogItemsRepository.save(
          plan.items.map((item) =>
            this.messageLogItemsRepository.create({
              messageLogId: savedLog.id,
              ...item,
            }),
          ),
        );
        savedLogs.push(savedLog);
      }
    }
    return savedLogs;
  }

  // Phase 36, stage 3 — the notice sendForLoan sends, worked out without
  // sending it, so the email/SMS notice (ChannelReminderService) carries
  // exactly the same figures. Null when the loan isn't on its 30th/50th
  // day of mora today (a retry then throws instead: the text would state a
  // false day count).
  async planForLoan(
    loanId: string,
    options?: { targetPhoneNumbers?: string[]; throwIfNotDue?: boolean },
  ): Promise<PlannedCreditReport | null> {
    const loan = await this.loansRepository.findOneBy({ id: loanId });
    const client =
      loan && (await this.clientsRepository.findOneBy({ id: loan.clientId }));
    if (!loan || !client) {
      throw new BadRequestException(
        `Loan ${loanId} or its client no longer exists`,
      );
    }
    const allOverdue = await findOverdueInstallmentsForClient(
      this.installmentsRepository,
      this.paymentsRepository,
      this.loanInstallmentConceptsRepository,
      client.id,
    );
    const overdue = allOverdue.filter((i) => i.loanId === loanId);
    const selection = selectCreditReportTemplate(
      `${client.firstName} ${client.lastName}`,
      overdue,
    );
    if (!selection) {
      if (options?.targetPhoneNumbers || options?.throwIfNotDue) {
        throw new BadRequestException(
          'El aviso de Datacrédito solo se puede reenviar el mismo día en que el pagaré cumple 30 o 50 días de mora.',
        );
      }
      return null;
    }

    let groups = groupInstallmentsByRecipient(overdue, [], client);
    if (options?.targetPhoneNumbers) {
      groups = restrictToTargetPhoneNumber(
        groups,
        options.targetPhoneNumbers[0],
      );
    }

    const breakdownContent = renderReminderBreakdown(overdue, []);
    const items = buildPlannedLogItems(overdue, []);
    return {
      clientId: client.id,
      type: selection.type,
      oldestInstallmentId: findOldestOverdueInstallment(overdue)?.id ?? null,
      plans: groups.map((group) => ({
        type: selection.type,
        bodyParameters: selection.bodyParameters,
        recipientPhoneNumbers: group.recipientPhoneNumbers,
        isClientGroup: isClientGroup(group.overdue, group.upcoming),
        breakdownContent,
        items,
      })),
    };
  }

  // Each notice goes out once per cuota and channel: the email notice
  // having gone out doesn't stop the SMS or WhatsApp one, nor vice versa.
  async wasAlreadySent(
    planned: PlannedCreditReport,
    channel: MessageChannel,
  ): Promise<boolean> {
    if (!planned.oldestInstallmentId) {
      return false;
    }
    return this.messageLogItemsRepository.existsBy({
      installmentId: planned.oldestInstallmentId,
      messageLog: { type: planned.type, channel },
    });
  }
}
