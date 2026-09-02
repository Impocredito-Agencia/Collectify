import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import {
  Installment,
  InstallmentStatus,
} from '../loans/entities/installment.entity';
import { Loan } from '../loans/entities/loan.entity';
import { Payment } from '../loans/entities/payment.entity';

import { MessageLog, MessageLogStatus } from './entities/messageLog.entity';
import { MessageLogItem } from './entities/messageLogItem.entity';
import { MessageTemplatesService } from './messageTemplates/messageTemplates.service';
import { MessageType } from './messageType.enum';
import {
  selectPaidInFullTemplate,
  selectPaymentConfirmationTemplate,
} from './paymentConfirmationTemplateSelection';
import { WhatsAppService } from './whatsapp.service';

// Templates 9 & 10 — fired synchronously right when a payment settles an
// installment/loan (installments.service.ts), same "callers catch and log
// their own failures, a failed send never blocks the payment" principle as
// NewLoanReminderService. See docs/phases/PHASE_33_MESSAGE_TEMPLATES_V2.md.
//
// Deliberately NOT wired into LoansService.payoff() (early payoff, which
// settles every remaining installment in one action) — sending one
// confirmacion_pago per installment there would be spammy for what's a
// single settlement action, and plantillas.md's worked examples only ever
// describe an ordinary one-at-a-time payment. Whether/how payoff should
// notify the client is a separate, unconfirmed question — not guessed
// here.
@Injectable()
export class PaymentConfirmationService {
  private readonly logger = new Logger(PaymentConfirmationService.name);

  constructor(
    @InjectRepository(Installment)
    private readonly installmentsRepository: Repository<Installment>,
    @InjectRepository(Loan)
    private readonly loansRepository: Repository<Loan>,
    @InjectRepository(Payment)
    private readonly paymentsRepository: Repository<Payment>,
    @InjectRepository(MessageLog)
    private readonly messageLogsRepository: Repository<MessageLog>,
    @InjectRepository(MessageLogItem)
    private readonly messageLogItemsRepository: Repository<MessageLogItem>,
    private readonly messageTemplatesService: MessageTemplatesService,
    private readonly whatsAppService: WhatsAppService,
  ) {}

  // Call once an installment has just been marked Paid by a normal
  // (non-payoff) payment.
  async sendPaymentConfirmation(installmentId: string): Promise<MessageLog> {
    const installment = await this.installmentsRepository.findOne({
      where: { id: installmentId },
      relations: { loan: { client: true } },
    });
    if (!installment) {
      throw new NotFoundException(
        `Installment with id ${installmentId} not found`,
      );
    }

    const remainingInstallments = await this.installmentsRepository.count({
      where: { loanId: installment.loanId, status: InstallmentStatus.Pending },
    });
    const overpaymentAmount = await this.overpaymentFor(
      installmentId,
      installment.amount,
    );

    const selection = selectPaymentConfirmationTemplate({
      clientFullName: `${installment.loan.client.firstName} ${installment.loan.client.lastName}`,
      installmentNumber: installment.installmentNumber,
      promissoryNoteNumber: installment.loan.promissoryNoteNumber,
      remainingInstallments,
      overpaymentAmount,
    });

    const savedLog = await this.sendAndLog(
      installment.loan.clientId,
      installment.loan.client.phoneNumber,
      selection,
      [installmentId],
    );
    return savedLog;
  }

  // Call once a loan's last installment has just cascaded it to
  // LoanStatus.Paid.
  async sendPaidInFull(loanId: string): Promise<MessageLog> {
    const loan = await this.loansRepository.findOne({
      where: { id: loanId },
      relations: { client: true },
    });
    if (!loan) {
      throw new NotFoundException(`Loan with id ${loanId} not found`);
    }

    const installments = await this.installmentsRepository.find({
      where: { loanId },
    });
    const overpaymentAmount =
      await this.overpaymentAcrossInstallments(installments);

    const selection = selectPaidInFullTemplate({
      clientFullName: `${loan.client.firstName} ${loan.client.lastName}`,
      promissoryNoteNumber: loan.promissoryNoteNumber,
      overpaymentAmount,
    });

    return this.sendAndLog(
      loan.clientId,
      loan.client.phoneNumber,
      selection,
      installments.map((installment) => installment.id),
    );
  }

  private async sendAndLog(
    clientId: string,
    phoneNumber: string,
    selection: { type: MessageType; bodyParameters: string[] },
    installmentIds: string[],
  ): Promise<MessageLog> {
    const template = await this.messageTemplatesService.findByTypeOrThrow(
      selection.type,
    );
    const sent = await this.whatsAppService.sendTemplateMessage(
      phoneNumber,
      template.metaTemplateName,
      template.metaLanguageCode,
      selection.bodyParameters,
    );

    const messageLog = this.messageLogsRepository.create({
      clientId,
      type: selection.type,
      phoneNumber,
      messageContent: selection.bodyParameters.join(' | '),
      status: sent ? MessageLogStatus.Sent : MessageLogStatus.Failed,
      sentAt: new Date(),
    });
    const savedLog = await this.messageLogsRepository.save(messageLog);

    const items = installmentIds.map((installmentId) =>
      this.messageLogItemsRepository.create({
        messageLogId: savedLog.id,
        installmentId,
        overdueDaysSnapshot: 0,
        interestSnapshot: 0,
      }),
    );
    await this.messageLogItemsRepository.save(items);

    return savedLog;
  }

  // The excess of what was actually paid on this installment over its
  // amount — see paymentConfirmationTemplateSelection.ts's doc comment on
  // why this is the narrow, directly-derivable definition used, not a
  // persisted running credit balance.
  private async overpaymentFor(
    installmentId: string,
    amount: number,
  ): Promise<number> {
    const payments = await this.paymentsRepository.find({
      where: { installmentId },
      select: { amountPaid: true },
    });
    const totalPaid = payments.reduce((sum, p) => sum + p.amountPaid, 0);
    return Math.max(0, totalPaid - amount);
  }

  private async overpaymentAcrossInstallments(
    installments: Installment[],
  ): Promise<number> {
    if (installments.length === 0) {
      return 0;
    }
    const payments = await this.paymentsRepository.find({
      where: { installmentId: In(installments.map((i) => i.id)) },
    });
    const paidByInstallmentId = new Map<string, number>();
    for (const payment of payments) {
      paidByInstallmentId.set(
        payment.installmentId,
        (paidByInstallmentId.get(payment.installmentId) ?? 0) +
          payment.amountPaid,
      );
    }
    return installments.reduce((sum, installment) => {
      const paid = paidByInstallmentId.get(installment.id) ?? 0;
      return sum + Math.max(0, paid - installment.amount);
    }, 0);
  }
}
