import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { Configuration } from '../config/configuration';
import { ConceptCategory } from '../interestConceptTypes/entities/interestConceptType.entity';
import {
  Installment,
  InstallmentStatus,
} from '../loans/entities/installment.entity';
import { Loan } from '../loans/entities/loan.entity';
import { LoanInstallmentConcept } from '../loans/entities/loanInstallmentConcept.entity';
import { Payment } from '../loans/entities/payment.entity';
import { findConceptsByInstallmentId } from '../loans/installments/conceptsByInstallmentId';
import {
  calculateMoratoryCharges,
  calculateOverdueDays,
  calculateTotalDue,
} from '../loans/installments/installmentCalculations';

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
    @InjectRepository(LoanInstallmentConcept)
    private readonly loanInstallmentConceptsRepository: Repository<LoanInstallmentConcept>,
    private readonly messageTemplatesService: MessageTemplatesService,
    private readonly whatsAppService: WhatsAppService,
    private readonly configService: ConfigService<Configuration, true>,
  ) {}

  // Human report, 2026-09-11 — see WhatsappConfig.paymentConfirmationPaused's
  // own comment. Checked at the very top of both public methods below,
  // before any DB work or WhatsAppService.sendTemplateMessage call — so no
  // message_logs row gets created for a backfilled payment at all, not
  // even a Failed one (unlike WHATSAPP_SENDING_PAUSED, which still logs a
  // Failed row since that check happens one layer down, inside
  // WhatsAppService). bypassPause (human report, 2026-09-19) — set by
  // InstallmentsService.registerPayment whenever the payment came from
  // the "Registrar pago con este comprobante" WhatsApp flow
  // (dto.sourceWhatsappMessageId): that payment is, by construction, a
  // real transaction happening right now, never one of the historical
  // payments this flag exists to silence — same "explicit, opt-in
  // exception" precedent as WHATSAPP_TEST_RECIPIENTS bypassing
  // WHATSAPP_SENDING_PAUSED.
  private isPaused(bypassPause: boolean): boolean {
    if (bypassPause) {
      return false;
    }
    return this.configService.get('whatsapp', { infer: true })
      .paymentConfirmationPaused;
  }

  // Call once an installment has just been marked Paid by a normal
  // (non-payoff) payment. Returns null (not a MessageLog) when
  // paymentConfirmationPaused is on and bypassPause isn't set — see
  // isPaused() above.
  async sendPaymentConfirmation(
    installmentId: string,
    options?: { bypassPause?: boolean },
  ): Promise<MessageLog | null> {
    if (this.isPaused(options?.bypassPause ?? false)) {
      this.logger.log(
        `Payment confirmation messages are paused — skipping installment ${installmentId}.`,
      );
      return null;
    }

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
    const overpaymentAmount = await this.overpaymentFor(installment);

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
  // LoanStatus.Paid. Returns null when paymentConfirmationPaused is on —
  // see sendPaymentConfirmation's identical guard above.
  async sendPaidInFull(
    loanId: string,
    options?: { bypassPause?: boolean },
  ): Promise<MessageLog | null> {
    if (this.isPaused(options?.bypassPause ?? false)) {
      this.logger.log(
        `Payment confirmation messages are paused — skipping loan ${loanId}.`,
      );
      return null;
    }

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
    const { sent, whatsappMessageId } =
      await this.whatsAppService.sendTemplateMessage(
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
      whatsappMessageId,
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

  // Bug fix, 2026-09-08 (human report — a fully-mora'd cuota's payment
  // confirmation reported the accrued mora as "saldo a favor"): this used to
  // compare totalPaid against the installment's bare `amount` (capital
  // only), so once the same-day closing-rule fix (see docs/DATABASE.md)
  // started requiring a payment to cover capital AND accrued mora before an
  // installment can close, paying exactly that full balance got
  // misreported as an in-favor credit equal to whatever mora had accrued —
  // money that was correctly owed and collected, not an overpayment.
  //
  // Now compares against the installment's real total owed (capital +
  // accrued mora), computed with the exact same formulas
  // installments.service.ts's resolveRemainingBalance/registerPayment
  // ceiling use. Deliberately doesn't call enrichInstallment() directly:
  // by the time this runs, the installment has already been flipped to
  // Paid (installments.service.ts), and enrichInstallment() short-circuits
  // a non-Pending installment's interest/totalDue to 0 — so the raw
  // calculation functions are used instead, which only need `dueDate` and
  // don't care about the installment's current status.
  private computeTotalOwed(
    installment: Installment,
    moratoryConcepts: LoanInstallmentConcept[],
  ): number {
    const overdueDays = calculateOverdueDays(new Date(installment.dueDate));
    const interest = calculateMoratoryCharges(
      installment.amount,
      overdueDays,
      moratoryConcepts.map((concept) => ({
        name: concept.nameSnapshot,
        calculationType: concept.calculationType,
        value: concept.value,
      })),
    ).reduce((sum, item) => sum + item.amount, 0);
    return calculateTotalDue(installment.amount, interest);
  }

  // The excess of what was actually paid on this installment over its real
  // total owed — see paymentConfirmationTemplateSelection.ts's doc comment
  // on why this is the narrow, directly-derivable definition used, not a
  // persisted running credit balance.
  private async overpaymentFor(installment: Installment): Promise<number> {
    const payments = await this.paymentsRepository.find({
      where: { installmentId: installment.id },
      select: { amountPaid: true },
    });
    const totalPaid = payments.reduce((sum, p) => sum + p.amountPaid, 0);
    const concepts = await this.loanInstallmentConceptsRepository.find({
      where: { installmentId: installment.id },
    });
    const moratoryConcepts = concepts.filter(
      (concept) => concept.category === ConceptCategory.Moratorio,
    );
    const totalOwed = this.computeTotalOwed(installment, moratoryConcepts);
    return Math.max(0, totalPaid - totalOwed);
  }

  private async overpaymentAcrossInstallments(
    installments: Installment[],
  ): Promise<number> {
    if (installments.length === 0) {
      return 0;
    }
    const installmentIds = installments.map((installment) => installment.id);
    const payments = await this.paymentsRepository.find({
      where: { installmentId: In(installmentIds) },
    });
    const paidByInstallmentId = new Map<string, number>();
    for (const payment of payments) {
      paidByInstallmentId.set(
        payment.installmentId,
        (paidByInstallmentId.get(payment.installmentId) ?? 0) +
          payment.amountPaid,
      );
    }
    const conceptsByInstallmentId = await findConceptsByInstallmentId(
      this.loanInstallmentConceptsRepository,
      installmentIds,
    );
    return installments.reduce((sum, installment) => {
      const paid = paidByInstallmentId.get(installment.id) ?? 0;
      const moratoryConcepts = (
        conceptsByInstallmentId.get(installment.id) ?? []
      ).filter((concept) => concept.category === ConceptCategory.Moratorio);
      const totalOwed = this.computeTotalOwed(installment, moratoryConcepts);
      return sum + Math.max(0, paid - totalOwed);
    }, 0);
  }
}
