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
import { Installment } from '../loans/entities/installment.entity';
import { LoanInstallmentConcept } from '../loans/entities/loanInstallmentConcept.entity';
import { Payment } from '../loans/entities/payment.entity';

import { getRecipientPhoneNumbers } from './clientRecipientPhoneNumbers';
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
import { selectReminderTemplate } from './reminderTemplateSelection';
import { computeSaldoPendiente } from './saldoPendiente';
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

    const phoneNumbers =
      options?.targetPhoneNumbers ?? getRecipientPhoneNumbers(client);
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
        messageContent: selection.bodyParameters.join(' | '),
        status: sent ? MessageLogStatus.Sent : MessageLogStatus.Failed,
        sentAt: new Date(),
        whatsappMessageId,
      });
      const savedLog = await this.messageLogsRepository.save(messageLog);

      const items = [
        ...overdue.map((installment) =>
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
      savedLogs.push(savedLog);
    }

    return savedLogs;
  }

  // See saldoPendiente.ts — derived from existing Payment rows, never
  // guessed. Saldo a favor isn't detected here yet, see that module's doc
  // comment.
  //
  // Bug fix, 2026-09-08 — `overdue` widened to admit its already-computed
  // `totalDue` (every OverdueInstallmentResult has one — see
  // reminderInstallmentQueries.ts). computeSaldoPendiente uses it directly
  // when present instead of re-deriving `amount - paid`, which silently
  // ignored accrued mora — see that module's own doc comment on this date.
  private async resolveNotaAdicional(
    overdue: { id: string; amount: number; totalDue?: number }[],
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
