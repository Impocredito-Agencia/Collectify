import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Installment } from '../loans/entities/installment.entity';
import { Loan } from '../loans/entities/loan.entity';

import { MessageLog, MessageLogStatus } from './entities/messageLog.entity';
import { MessageLogItem } from './entities/messageLogItem.entity';
import { MessageTemplatesService } from './messageTemplates/messageTemplates.service';
import {
  selectNewLoanTemplate,
  selectRefinanceTemplate,
} from './newLoanTemplateSelection';
import { WhatsAppService } from './whatsapp.service';

// Reverted, 2026-09-06 (confirmed with the human) — the 2026-09-05/06
// cron-sweep redesign (a WhatsappCronService "NewLoan" family running
// sendNewLoanMessage via runPendingLoanNotifications() on a schedule) is
// removed. It introduced a real gap: a historical/backfilled loan that
// slipped through with isNewLoan left true would only get caught — and
// wrongly message the client — whenever the next scheduled run happened,
// which could land well after WHATSAPP_SENDING_PAUSED had already been
// lifted for legitimate traffic. Back to how it worked before that
// redesign: LoansService.create()/refinance() call sendNewLoanMessage()
// synchronously right after persisting, gated by Loan.isNewLoan (always
// true for refinance — see refinance()'s own comment). A manual
// POST /message-logs/:id/retry still exists for a previously-failed send.
//
// Callers are expected to catch and log failures themselves rather than
// let a messaging failure block anything — same principle as the rest of
// this module (a failed/skipped send is a business outcome, not an
// application error).
//
// Phase 33 rewrite — picks among 5 templates (see
// docs/phases/PHASE_33_MESSAGE_TEMPLATES_V2.md and newLoanTemplateSelection.ts):
// a refinance (loan.refinancedFromLoanId set) always uses
// RefinanceSingleLoan; otherwise the choice is new/existing client ×
// with/without cuota inicial. A multi-loan refinance merge is NOT a
// separate code path — it's an ordinary new-loan send for an existing
// client, with the merged pagarés listed in the loan's own description.
@Injectable()
export class NewLoanReminderService {
  private readonly logger = new Logger(NewLoanReminderService.name);

  constructor(
    @InjectRepository(Loan)
    private readonly loansRepository: Repository<Loan>,
    @InjectRepository(Installment)
    private readonly installmentsRepository: Repository<Installment>,
    @InjectRepository(MessageLog)
    private readonly messageLogsRepository: Repository<MessageLog>,
    @InjectRepository(MessageLogItem)
    private readonly messageLogItemsRepository: Repository<MessageLogItem>,
    private readonly messageTemplatesService: MessageTemplatesService,
    private readonly whatsAppService: WhatsAppService,
  ) {}

  async sendNewLoanMessage(loanId: string): Promise<MessageLog> {
    const loan = await this.loansRepository.findOne({
      where: { id: loanId },
      relations: ['client', 'refinancedFromLoan'],
    });
    if (!loan) {
      throw new NotFoundException(`Loan with id ${loanId} not found`);
    }

    const installments = await this.installmentsRepository.find({
      where: { loanId },
      order: { installmentNumber: 'ASC' },
    });
    const clientFullName = `${loan.client.firstName} ${loan.client.lastName}`;

    // Redesign, 2026-09-03 — the down payment is now installmentNumber 1
    // with isDownPayment=true inside these same fetched rows (used to be
    // loan.initialPayment, a separate informational field). Both template
    // selectors expect the down payment split out from the interest-
    // bearing installments — see newLoanTemplateSelection.ts.
    const downPaymentInstallment =
      installments.find((installment) => installment.isDownPayment) ?? null;
    const trackedInstallments = installments.filter(
      (installment) => !installment.isDownPayment,
    );

    const selection = loan.refinancedFromLoan
      ? selectRefinanceTemplate({
          clientFullName,
          originalPromissoryNoteNumber:
            loan.refinancedFromLoan.promissoryNoteNumber,
          frequency: loan.installmentFrequency,
          // RefinanceSingleLoan has no down-payment variant (only one
          // refinance template exists) — mirrors this message's
          // pre-redesign behavior, which never saw a down payment at all
          // since it wasn't a real installment yet.
          installments: trackedInstallments,
        })
      : selectNewLoanTemplate({
          clientFullName,
          promissoryNoteNumber: loan.promissoryNoteNumber,
          disbursedAt: loan.disbursedAt,
          description: loan.description,
          frequency: loan.installmentFrequency,
          installments: trackedInstallments,
          downPayment: downPaymentInstallment,
          isNewClient: await this.isFirstLoanEver(loan.clientId, loan.id),
        });

    const template = await this.messageTemplatesService.findByTypeOrThrow(
      selection.type,
    );
    const { sent, whatsappMessageId } =
      await this.whatsAppService.sendTemplateMessage(
        loan.client.phoneNumber,
        template.metaTemplateName,
        template.metaLanguageCode,
        selection.bodyParameters,
      );

    const messageLog = this.messageLogsRepository.create({
      clientId: loan.clientId,
      type: selection.type,
      phoneNumber: loan.client.phoneNumber,
      messageContent: selection.bodyParameters.join(' | '),
      status: sent ? MessageLogStatus.Sent : MessageLogStatus.Failed,
      sentAt: new Date(),
      whatsappMessageId,
    });
    const savedLog = await this.messageLogsRepository.save(messageLog);

    // overdueDaysSnapshot/interestSnapshot are legitimately 0 here — a
    // brand-new installment is never overdue. See docs/DATABASE.md.
    const items = installments.map((installment) =>
      this.messageLogItemsRepository.create({
        messageLogId: savedLog.id,
        installmentId: installment.id,
        overdueDaysSnapshot: 0,
        interestSnapshot: 0,
      }),
    );
    await this.messageLogItemsRepository.save(items);

    // Only a genuinely Sent result marks newLoanMessageSentAt — a Failed
    // result (WhatsAppService itself reported failure, no exception
    // thrown) leaves it null. Nothing re-picks the loan up automatically
    // anymore (no sweep) — a failed send has to go through the manual
    // POST /message-logs/:id/retry, same as any other failed message.
    if (sent) {
      await this.loansRepository.update(
        { id: loanId },
        { newLoanMessageSentAt: new Date() },
      );
    }

    return savedLog;
  }

  // A client is "new" exactly when they have no OTHER loan on file, of any
  // status — confirmed by the human (2026-09-01). Excludes the loan we're
  // currently sending the message for, which already exists in the DB by
  // the time this runs.
  private async isFirstLoanEver(
    clientId: string,
    excludingLoanId: string,
  ): Promise<boolean> {
    const otherLoanCount = await this.loansRepository
      .createQueryBuilder('loan')
      .where('loan.clientId = :clientId', { clientId })
      .andWhere('loan.id != :excludingLoanId', { excludingLoanId })
      .getCount();
    return otherLoanCount === 0;
  }
}
