import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { ClientCreditBalanceService } from '../clients/clientCreditBalance.service';
import { Client } from '../clients/entities/client.entity';
import { Configuration } from '../config/configuration';
import { Installment } from '../loans/entities/installment.entity';
import { LoanInstallmentConcept } from '../loans/entities/loanInstallmentConcept.entity';
import { Payment } from '../loans/entities/payment.entity';

import { MessageLog, MessageLogStatus } from './entities/messageLog.entity';
import { MessageLogItem } from './entities/messageLogItem.entity';
import { MessageFrequencyThrottleService } from './messageFrequencyThrottle.service';
import { MessageTemplatesService } from './messageTemplates/messageTemplates.service';
import { NotaAdicionalInput, NotaAdicionalState } from './notaAdicional';
import { OVERDUE_FAMILY_TYPES } from './reminderFamily';
import {
  findClientIdsWithOverdueInstallments,
  findOverdueInstallmentsForClient,
  findUpcomingInstallmentsForClient,
} from './reminderInstallmentQueries';
import {
  groupInstallmentsByRecipient,
  restrictToTargetPhoneNumber,
} from './reminderRecipientGrouping';
import { renderReminderBreakdown } from './reminderBreakdown';
import { selectReminderTemplate } from './reminderTemplateSelection';
import { computeSaldoPendiente } from './saldoPendiente';
import { renderTemplateBody } from './templateBodyRenderer';
import { WhatsAppService } from './whatsapp.service';

// Phase 33 rewrite — picks among 4 templates (SingleOverdueInstallment,
// SingleOverdueInstallmentWithSurcharge, MultipleOverdueInstallments,
// UpcomingAndOverdueMixed), see reminderTemplateSelection.ts.
//
// Reversed 2026-09-07 (human) — the weekly job now OWNS the mixed picture:
// a client with both an overdue and an upcoming installment gets sent the
// mixed template from HERE, not from the daily job. Rationale (human):
// overdue installments take precedence over upcoming ones, so whichever
// job actually fires for that client should be the one built around the
// overdue debt, not the one built around what's still to come. This
// reverses the original Phase 33 assignment (confirmed 2026-09-01, kept
// the daily job as owner) — see UpcomingDueReminderService's doc comment,
// which now excludes these clients instead. sendReminderForClient itself
// (used by the manual on-demand endpoint too) always looks at both sets
// regardless — an admin explicitly asking for one client's status should
// see the accurate picture; the exclusion only applies to which clients
// each automated cron run picks up.
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
    // Bug fix, 2026-09-08 — see findOverdueInstallmentsForClient's own
    // comment in reminderInstallmentQueries.ts.
    @InjectRepository(LoanInstallmentConcept)
    private readonly loanInstallmentConceptsRepository: Repository<LoanInstallmentConcept>,
    @InjectRepository(MessageLog)
    private readonly messageLogsRepository: Repository<MessageLog>,
    @InjectRepository(MessageLogItem)
    private readonly messageLogItemsRepository: Repository<MessageLogItem>,
    private readonly messageTemplatesService: MessageTemplatesService,
    private readonly messageFrequencyThrottleService: MessageFrequencyThrottleService,
    private readonly whatsAppService: WhatsAppService,
    private readonly configService: ConfigService<Configuration, true>,
    private readonly clientCreditBalanceService: ClientCreditBalanceService,
  ) {}

  async runWeeklyReminder(): Promise<void> {
    const dynamicClientIds = await findClientIdsWithOverdueInstallments(
      this.installmentsRepository,
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

  // Human report, 2026-09-19 — targetPhoneNumbers lets a manual retry
  // (MessageLogsService.dispatchRetry) resend to exactly the one number
  // the original attempt failed on, instead of fanning out to every
  // number on file again (which would re-send to a number that may have
  // already succeeded). Omitted (the normal cron path) defaults to every
  // known number — see getRecipientPhoneNumbers.
  async sendReminderForClient(
    clientId: string,
    options?: { allowEmpty?: boolean; targetPhoneNumbers?: string[] },
  ): Promise<MessageLog[]> {
    const client = await this.clientsRepository.findOneBy({ id: clientId });
    if (!client) {
      throw new NotFoundException(`Client with id ${clientId} not found`);
    }

    const overdue = await findOverdueInstallmentsForClient(
      this.installmentsRepository,
      this.paymentsRepository,
      this.loanInstallmentConceptsRepository,
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
      this.maxUpcomingDaysUntilDue(),
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

    // Human report, 2026-09-19 — a loan with alternateContactPhoneNumber
    // set routes ITS installments to that contact instead of the client,
    // in their own message scoped to just that loan; the client's other
    // loans (if any) still get their own normal message. Template
    // selection/notaAdicional run per group, since a contact's message
    // must never leak the counts/wording of installments that belong to
    // a DIFFERENT loan than theirs. See groupInstallmentsByRecipient.
    let groups = groupInstallmentsByRecipient(overdue, upcoming, client);
    if (options?.targetPhoneNumbers) {
      groups = restrictToTargetPhoneNumber(
        groups,
        options.targetPhoneNumbers[0],
      );
    }

    const savedLogs: MessageLog[] = [];
    for (const group of groups) {
      const notaAdicional = await this.resolveNotaAdicional(
        clientId,
        group.overdue,
        group.upcoming,
      );
      const selection = selectReminderTemplate(
        `${client.firstName} ${client.lastName}`,
        group.overdue,
        group.upcoming,
        notaAdicional,
      );
      const template = await this.messageTemplatesService.findByTypeOrThrow(
        selection.type,
      );

      for (const phoneNumber of group.recipientPhoneNumbers) {
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
          breakdownContent: renderReminderBreakdown(
            group.overdue,
            group.upcoming,
          ),
          status: sent ? MessageLogStatus.Sent : MessageLogStatus.Failed,
          sentAt: new Date(),
          whatsappMessageId,
        });
        const savedLog = await this.messageLogsRepository.save(messageLog);

        const items = [
          ...group.overdue.map((installment) =>
            this.messageLogItemsRepository.create({
              messageLogId: savedLog.id,
              installmentId: installment.id,
              overdueDaysSnapshot: installment.overdueDays,
              // Bug fix, 2026-09-07 — was `totalDue - amount`, which broke once
              // totalDue started netting out payments already made (see
              // reminderInstallmentQueries.ts's OverdueInstallmentResult.interest
              // doc comment): a partially paid overdue installment would
              // otherwise snapshot an understated, even negative, "interest".
              interestSnapshot: installment.interest,
            }),
          ),
          ...group.upcoming.map((installment) =>
            this.messageLogItemsRepository.create({
              messageLogId: savedLog.id,
              installmentId: installment.id,
              overdueDaysSnapshot: 0,
              interestSnapshot: 0,
            }),
          ),
        ];
        await this.messageLogItemsRepository.save(items);
        savedLogs.push(savedLog);
      }
    }

    return savedLogs;
  }

  // See saldoPendiente.ts — derived from existing Payment rows, never
  // guessed.
  //
  // Bug fix, 2026-09-08 — `overdue` widened to admit its already-computed
  // `totalDue` (every OverdueInstallmentResult has one — see
  // reminderInstallmentQueries.ts). computeSaldoPendiente uses it directly
  // when present instead of re-deriving `amount - paid`, which silently
  // ignored accrued mora — see that module's own doc comment on this date.
  //
  // Human report, 2026-09-14 — saldo a favor now checked too, via
  // ClientCreditBalanceService's ledger, once saldo pendiente comes back
  // empty. Priority order confirmed with the human: a client with BOTH a
  // pendiente gap and an unclaimed favor balance at once sees the
  // pendiente note — the more urgent of the two. Skipped entirely for a
  // contact group (every installment here carries the SAME
  // alternateContactPhoneNumber, per groupInstallmentsByRecipient): that
  // balance is client-wide, not scoped to the one loan the contact is
  // actually being told about, and disclosing it there was confirmed with
  // the human to be out of scope for that contact.
  private async resolveNotaAdicional(
    clientId: string,
    overdue: {
      id: string;
      amount: number;
      totalDue?: number;
      alternateContactPhoneNumber?: string | null;
    }[],
    upcoming: {
      id: string;
      amount: number;
      alternateContactPhoneNumber?: string | null;
    }[],
  ): Promise<NotaAdicionalInput> {
    const combined = [...overdue, ...upcoming];
    const installmentIds = combined.map((i) => i.id);
    if (installmentIds.length === 0) {
      return { state: NotaAdicionalState.Normal };
    }
    const payments = await this.paymentsRepository.find({
      where: { installmentId: In(installmentIds) },
    });
    const saldoPendiente = computeSaldoPendiente(combined, payments);
    if (saldoPendiente > 0) {
      return {
        state: NotaAdicionalState.SaldoPendiente,
        amount: saldoPendiente,
      };
    }

    const isContactGroup = combined.some(
      (installment) => installment.alternateContactPhoneNumber,
    );
    if (isContactGroup) {
      return { state: NotaAdicionalState.Normal };
    }

    const saldoAFavor =
      await this.clientCreditBalanceService.getBalance(clientId);
    return saldoAFavor > 0
      ? { state: NotaAdicionalState.SaldoAFavor, amount: saldoAFavor }
      : { state: NotaAdicionalState.Normal };
  }

  // Reworked 2026-09-07 alongside reminderInstallmentQueries.ts's move to a
  // cumulative window ("due within N days" instead of three exact
  // checkpoints) — UPCOMING_DUE_REMINDER_DAYS simplified from a
  // comma-separated list to a single number the same day, once only its
  // max was ever used. Kept as its own method (rather than inlining the
  // config read at each call site) for a self-documenting name.
  private maxUpcomingDaysUntilDue(): number {
    const { upcomingDueReminderDays } = this.configService.get('cron', {
      infer: true,
    });
    return upcomingDueReminderDays;
  }
}
