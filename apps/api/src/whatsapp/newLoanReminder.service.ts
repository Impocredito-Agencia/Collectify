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

// Sent once, synchronously, right after a loan (or a refinance's new loan)
// is created — see docs/phases/PHASE_9_MESSAGE_TYPES.md. Callers are
// expected to catch and log failures themselves rather than let a
// messaging failure block the loan operation — same principle as the rest
// of this module (a failed/skipped send is a business outcome, not an
// application error).
//
// Confirmed with the human (2026-08-18): this is the ONLY way a new-loan
// message is ever sent — no periodic retry sweep. A failed synchronous
// send can still be retried manually via POST /message-logs/:id/retry, but
// nothing does it automatically. See docs/phases/PHASE_18_MESSAGE_AUDIENCES.md
// "Extended after client QA".
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
    const sent = await this.whatsAppService.sendTemplateMessage(
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
