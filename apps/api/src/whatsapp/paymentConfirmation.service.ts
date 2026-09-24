import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { ClientCreditBalanceService } from '../clients/clientCreditBalance.service';
import { Configuration } from '../config/configuration';
import {
  Installment,
  InstallmentStatus,
} from '../loans/entities/installment.entity';
import { Loan } from '../loans/entities/loan.entity';

import { getRecipientPhoneNumbers } from './clientRecipientPhoneNumbers';
import { renderTemplateBody } from './templateBodyRenderer';

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
    @InjectRepository(MessageLog)
    private readonly messageLogsRepository: Repository<MessageLog>,
    @InjectRepository(MessageLogItem)
    private readonly messageLogItemsRepository: Repository<MessageLogItem>,
    private readonly messageTemplatesService: MessageTemplatesService,
    private readonly whatsAppService: WhatsAppService,
    private readonly configService: ConfigService<Configuration, true>,
    private readonly clientCreditBalanceService: ClientCreditBalanceService,
  ) {}

  // Human report, 2026-09-11 — see WhatsappConfig.paymentConfirmationPaused's
  // own comment. Checked at the very top of both public methods below,
  // before any DB work or WhatsAppService.sendTemplateMessage call — so no
  // message_logs row gets created for a backfilled payment at all, not
  // even a Failed one (unlike WHATSAPP_SENDING_PAUSED, which still logs a
  // Failed row since that check happens one layer down, inside
  // WhatsAppService). bypassPause (human report, 2026-09-19) — set by
  // InstallmentsService.registerPayment/registerBulkPayments whenever
  // either (a) the payment came from the "Registrar pago con este
  // comprobante" WhatsApp flow (dto.sourceWhatsappMessageId), or (b) the
  // installment's loan is marked isNewLoan. Both cases are, by
  // construction, real activity happening right now, never one of the
  // historical/backfilled payments this flag exists to silence — same
  // "explicit, opt-in exception" precedent as WHATSAPP_TEST_RECIPIENTS
  // bypassing WHATSAPP_SENDING_PAUSED.
  private isPaused(bypassPause: boolean): boolean {
    if (bypassPause) {
      return false;
    }
    return this.configService.get('whatsapp', { infer: true })
      .paymentConfirmationPaused;
  }

  // Call once an installment has just been marked Paid by a normal
  // (non-payoff) payment. Returns [] (not a MessageLog) when
  // paymentConfirmationPaused is on and bypassPause isn't set — see
  // isPaused() above. targetPhoneNumbers (human report, 2026-09-19) lets
  // a manual retry resend to exactly the one number the original attempt
  // failed on — see OverdueReminderService's identical comment. Omitted
  // (the normal real-time path) sends to every number on file.
  async sendPaymentConfirmation(
    installmentId: string,
    options?: { bypassPause?: boolean; targetPhoneNumbers?: string[] },
  ): Promise<MessageLog[]> {
    if (this.isPaused(options?.bypassPause ?? false)) {
      this.logger.log(
        `Payment confirmation messages are paused — skipping installment ${installmentId}.`,
      );
      return [];
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
    // Human report, 2026-09-14 — this used to be derived narrowly from
    // this one installment's own totalPaid vs totalOwed (see git history),
    // which by design almost never fires anymore: registerPayment now caps
    // a payment at maxPayable and shunts any excess straight into
    // ClientCreditBalanceService's ledger (installments.service.ts) instead
    // of letting it inflate this installment's totalPaid. Reading the real
    // ledger balance here reports what the client can actually go apply —
    // including credit left over from a DIFFERENT loan of theirs — instead
    // of a number that's now structurally close to always 0.
    //
    // alternateContactPhoneNumber carve-out (confirmed with the human,
    // 2026-09-14): the ledger balance is client-wide, but a loan's
    // alternate contact is scoped to just that one loan — showing them the
    // client's aggregate credit (possibly earned on a loan that isn't
    // theirs to know about) would leak more than this message should. So a
    // routed-to-contact confirmation never reports a saldo a favor.
    const overpaymentAmount = installment.loan.alternateContactPhoneNumber
      ? 0
      : await this.clientCreditBalanceService.getBalance(
          installment.loan.clientId,
        );

    const selection = selectPaymentConfirmationTemplate({
      clientFullName: `${installment.loan.client.firstName} ${installment.loan.client.lastName}`,
      installmentNumber: installment.installmentNumber,
      promissoryNoteNumber: installment.loan.promissoryNoteNumber,
      remainingInstallments,
      overpaymentAmount,
    });

    // Human report, 2026-09-19 — a loan with alternateContactPhoneNumber
    // set routes here instead of the client's own number(s) — see
    // Loan.alternateContactPhoneNumber's own comment. A contact is a
    // single number, never fanned out the way a client's own numbers are.
    const phoneNumbers =
      options?.targetPhoneNumbers ??
      (installment.loan.alternateContactPhoneNumber
        ? [installment.loan.alternateContactPhoneNumber]
        : getRecipientPhoneNumbers(installment.loan.client));
    return this.sendAndLog(installment.loan.clientId, phoneNumbers, selection, [
      installmentId,
    ]);
  }

  // Call once a loan's last installment has just cascaded it to
  // LoanStatus.Paid. Returns [] when paymentConfirmationPaused is on —
  // see sendPaymentConfirmation's identical guard above.
  async sendPaidInFull(
    loanId: string,
    options?: { bypassPause?: boolean; targetPhoneNumbers?: string[] },
  ): Promise<MessageLog[]> {
    if (this.isPaused(options?.bypassPause ?? false)) {
      this.logger.log(
        `Payment confirmation messages are paused — skipping loan ${loanId}.`,
      );
      return [];
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

    // Human report, 2026-09-14 — see sendPaymentConfirmation's identical
    // alternateContactPhoneNumber carve-out.
    const overpaymentAmount = loan.alternateContactPhoneNumber
      ? 0
      : await this.clientCreditBalanceService.getBalance(loan.clientId);

    const selection = selectPaidInFullTemplate({
      clientFullName: `${loan.client.firstName} ${loan.client.lastName}`,
      promissoryNoteNumber: loan.promissoryNoteNumber,
      overpaymentAmount,
    });

    // See sendPaymentConfirmation's identical comment above.
    const phoneNumbers =
      options?.targetPhoneNumbers ??
      (loan.alternateContactPhoneNumber
        ? [loan.alternateContactPhoneNumber]
        : getRecipientPhoneNumbers(loan.client));
    return this.sendAndLog(
      loan.clientId,
      phoneNumbers,
      selection,
      installments.map((installment) => installment.id),
    );
  }

  private async sendAndLog(
    clientId: string,
    phoneNumbers: string[],
    selection: { type: MessageType; bodyParameters: string[] },
    installmentIds: string[],
  ): Promise<MessageLog[]> {
    const template = await this.messageTemplatesService.findByTypeOrThrow(
      selection.type,
    );

    const savedLogs: MessageLog[] = [];
    for (const phoneNumber of phoneNumbers) {
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
        messageContent: renderTemplateBody(
          template.content,
          selection.bodyParameters,
        ),
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
      savedLogs.push(savedLog);
    }

    return savedLogs;
  }
}
