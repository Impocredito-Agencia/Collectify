import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';

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

// Restored, 2026-09-09 (confirmed with the human) — the cron-sweep design
// briefly reverted on 2026-09-07 is back: sendNewLoanMessage() is called
// from two places, runPendingLoanNotifications() below on the admin's
// configured schedule (WhatsappCronService's NewLoan family), and a manual
// POST /message-logs/:id/retry for a previously-failed send. LoansService
// no longer calls this synchronously at loan creation/refinance — see
// LoansService.create()/refinance() and Loan.isNewLoan for what decides
// whether a loan is eligible for the sweep at all. Loan.isNewLoan now
// defaults to false on both the create() DTO and the LoanForm checkbox
// (unchecked by default) — most loans entered right now are historical
// backfills, so the sweep gap the 2026-09-07 revert was worried about (a
// backfilled loan left marked isNewLoan: true) requires an admin to have
// actively opted the loan in, rather than being the default state.
//
// Callers are expected to catch and log failures themselves rather than
// let a messaging failure block anything — same principle as the rest of
// this module (a failed/skipped send is a business outcome, not an
// application error). newLoanMessageSentAt is only ever set here, on a
// genuinely Sent result, regardless of which caller triggered the send —
// centralizing it here (rather than in each caller) is what makes a
// manual retry and the sweep both safe to call without double-sending.
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
    // thrown) must leave it null, so runPendingLoanNotifications() picks
    // the loan back up on its next scheduled run.
    if (sent) {
      await this.loansRepository.update(
        { id: loanId },
        { newLoanMessageSentAt: new Date() },
      );
    }

    return savedLog;
  }

  // Called on the admin's configured schedule (WhatsappCronService's
  // NewLoan family, default weekly — see CronConfig.newLoanReminderExpression).
  // isNewLoan: true scopes this to loans the admin explicitly marked as a
  // genuinely new credit event (see Loan.isNewLoan); newLoanMessageSentAt
  // IS NULL scopes it to ones that haven't gotten their message yet. One
  // bad loan's failure is logged and never blocks the rest of the batch —
  // same no-throw principle as sendNewLoanMessage's caller-facing contract.
  async runPendingLoanNotifications(): Promise<void> {
    const pendingLoans = await this.loansRepository.find({
      where: { isNewLoan: true, newLoanMessageSentAt: IsNull() },
    });

    for (const loan of pendingLoans) {
      try {
        await this.sendNewLoanMessage(loan.id);
      } catch (error) {
        this.logger.error(
          `Failed to send new-loan WhatsApp message for loan ${loan.id}`,
          error,
        );
      }
    }
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
