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
import { MessageTemplatesService } from './messageTemplates/messageTemplates.service';
import { renderReminderBreakdown } from './reminderBreakdown';
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
    const loanIds = [...new Set(candidates.map((i) => i.loanId))];
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
      if (options?.targetPhoneNumbers) {
        throw new BadRequestException(
          'El aviso de Datacrédito solo se puede reenviar el mismo día en que el pagaré cumple 30 o 50 días de mora.',
        );
      }
      return [];
    }

    if (options?.skipIfAlreadySent) {
      const oldest = findOldestOverdueInstallment(overdue);
      const alreadySent = await this.messageLogItemsRepository.existsBy({
        installmentId: oldest?.id,
        messageLog: { type: selection.type },
      });
      if (alreadySent) {
        return [];
      }
    }

    let groups = groupInstallmentsByRecipient(overdue, [], client);
    if (options?.targetPhoneNumbers) {
      groups = restrictToTargetPhoneNumber(
        groups,
        options.targetPhoneNumbers[0],
      );
    }

    const template = await this.messageTemplatesService.findByTypeOrThrow(
      selection.type,
    );

    const savedLogs: MessageLog[] = [];
    for (const group of groups) {
      for (const phoneNumber of group.recipientPhoneNumbers) {
        const { sent, whatsappMessageId } =
          await this.whatsAppService.sendTemplateMessage(
            phoneNumber,
            template.metaTemplateName,
            template.metaLanguageCode,
            selection.bodyParameters,
          );

        const savedLog = await this.messageLogsRepository.save(
          this.messageLogsRepository.create({
            clientId: client.id,
            type: selection.type,
            phoneNumber,
            messageContent: renderTemplateBody(
              template.content,
              selection.bodyParameters,
            ),
            breakdownContent: renderReminderBreakdown(overdue, []),
            status: sent ? MessageLogStatus.Sent : MessageLogStatus.Failed,
            sentAt: new Date(),
            whatsappMessageId,
          }),
        );
        await this.messageLogItemsRepository.save(
          overdue.map((installment) =>
            this.messageLogItemsRepository.create({
              messageLogId: savedLog.id,
              installmentId: installment.id,
              overdueDaysSnapshot: installment.overdueDays,
              interestSnapshot: installment.interest,
            }),
          ),
        );
        savedLogs.push(savedLog);
      }
    }

    return savedLogs;
  }
}
