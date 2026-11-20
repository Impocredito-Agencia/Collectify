import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';

import { BrevoService } from '../../brevo/brevo.service';
import {
  BrevoChannel,
  BrevoSendFailureReason,
  BrevoSendResult,
} from '../../brevo/brevoTypes';
import { Client } from '../../clients/entities/client.entity';
import { Configuration } from '../../config/configuration';
import { Installment } from '../../loans/entities/installment.entity';
import {
  renderEmailHtml,
  renderEmailText,
} from '../channelTemplates/channelTemplateText';
import { MessageChannelTemplatesService } from '../channelTemplates/messageChannelTemplates.service';
import { CreditReportReminderService } from '../creditReportReminder.service';
import { ChannelReminderFamily } from '../entities/messageChannelSchedule.entity';
import { MessageLog, MessageLogStatus } from '../entities/messageLog.entity';
import { MessageLogItem } from '../entities/messageLogItem.entity';
import { MessageChannel } from '../messageChannel.enum';
import { OverdueReminderService } from '../overdueReminder.service';
import {
  CREDIT_REPORT_FAMILY_TYPES,
  OVERDUE_FAMILY_TYPES,
  ReminderFamily,
  UPCOMING_FAMILY_TYPES,
} from '../reminderFamily';
import {
  findClientIdsWithOverdueInstallments,
  findClientIdsWithUpcomingInstallments,
} from '../reminderInstallmentQueries';
import { PlannedReminder } from '../reminderPlan';
import { UpcomingDueReminderService } from '../upcomingDueReminder.service';

// Skipped sends that were never attempted — nothing to log for them (see
// sendPlans).
const NOT_ATTEMPTED = new Set([
  BrevoSendFailureReason.Paused,
  BrevoSendFailureReason.NotConfigured,
]);

const CHANNEL_BY_BREVO: Record<BrevoChannel, MessageChannel> = {
  [BrevoChannel.Email]: MessageChannel.Email,
  [BrevoChannel.Sms]: MessageChannel.Sms,
};

interface SendOptions {
  // A retry: only this phone (SMS) — email only ever has one recipient.
  targetPhoneNumber?: string;
}

// Phase 36, stage 3 — the scheduled email and SMS reminders: extra pressure
// on the clients the admin picked (Client.emailRemindersEnabled /
// smsRemindersEnabled), on top of WhatsApp, never instead of it. Each
// message is planned by the same code as its WhatsApp counterpart
// (planReminderForClient / planForLoan) and only rendered differently, so
// the figures always match. The per-client minimum days between reminders
// (Phase 27) doesn't apply here — confirmed with the human. See
// docs/phases/PHASE_36_BREVO_EMAIL_SMS.md.
@Injectable()
export class ChannelReminderService {
  private readonly logger = new Logger(ChannelReminderService.name);

  constructor(
    @InjectRepository(Client)
    private readonly clientsRepository: Repository<Client>,
    @InjectRepository(Installment)
    private readonly installmentsRepository: Repository<Installment>,
    @InjectRepository(MessageLog)
    private readonly messageLogsRepository: Repository<MessageLog>,
    @InjectRepository(MessageLogItem)
    private readonly messageLogItemsRepository: Repository<MessageLogItem>,
    private readonly overdueReminderService: OverdueReminderService,
    private readonly upcomingDueReminderService: UpcomingDueReminderService,
    private readonly creditReportReminderService: CreditReportReminderService,
    private readonly channelTemplatesService: MessageChannelTemplatesService,
    private readonly brevoService: BrevoService,
    private readonly configService: ConfigService<Configuration, true>,
  ) {}

  async runFamily(
    family: ChannelReminderFamily,
    channel: BrevoChannel,
  ): Promise<void> {
    const clients = await this.findSelectedClients(channel);
    if (clients.length === 0) {
      this.logger.log(`${family} ${channel} reminder: no client selected`);
      return;
    }
    const clientsById = new Map(clients.map((client) => [client.id, client]));

    if (family === ReminderFamily.CreditReport) {
      await this.runCreditReport(clientsById, channel);
      return;
    }

    const targetIds = await this.findClientIdsFor(family, clientsById);
    this.logger.log(
      `${family} ${channel} reminder: ${targetIds.length} client(s) to notify`,
    );
    for (const clientId of targetIds) {
      try {
        const plans =
          family === ReminderFamily.Overdue
            ? await this.overdueReminderService.planReminderForClient(clientId)
            : await this.upcomingDueReminderService.planReminderForClient(
                clientId,
              );
        await this.sendPlans(clientsById.get(clientId)!, plans, channel);
      } catch (error) {
        this.logger.error(
          `Failed to send ${family} ${channel} reminder to client ${clientId}`,
          error,
        );
      }
    }
  }

  // Manual retry (Phase 18) of a failed email/SMS row: the client's current
  // state for that family, to the same recipient, over the same channel.
  async retry(original: MessageLog): Promise<MessageLog[]> {
    const channel =
      original.channel === MessageChannel.Sms
        ? BrevoChannel.Sms
        : original.channel === MessageChannel.Email
          ? BrevoChannel.Email
          : null;
    if (!channel) {
      throw new BadRequestException(
        `Message log ${original.id} is not an email or SMS message`,
      );
    }
    const client = await this.clientsRepository.findOneBy({
      id: original.clientId,
    });
    if (!client) {
      throw new BadRequestException(
        `Client ${original.clientId} no longer exists`,
      );
    }
    const targetPhoneNumbers =
      channel === BrevoChannel.Sms && original.phoneNumber
        ? [original.phoneNumber]
        : undefined;
    const options: SendOptions = {
      targetPhoneNumber: targetPhoneNumbers?.[0],
    };

    if (OVERDUE_FAMILY_TYPES.includes(original.type)) {
      const plans = await this.overdueReminderService.planReminderForClient(
        client.id,
        { allowEmpty: true, targetPhoneNumbers },
      );
      return this.sendPlans(client, plans, channel, options);
    }
    if (UPCOMING_FAMILY_TYPES.includes(original.type)) {
      const plans = await this.upcomingDueReminderService.planReminderForClient(
        client.id,
        { allowEmpty: true, targetPhoneNumbers },
      );
      return this.sendPlans(client, plans, channel, options);
    }
    if (CREDIT_REPORT_FAMILY_TYPES.includes(original.type)) {
      const item = await this.messageLogItemsRepository.findOne({
        where: { messageLogId: original.id },
        relations: { installment: true },
      });
      if (!item) {
        throw new BadRequestException(
          `Cannot retry message log ${original.id}: no related installments found`,
        );
      }
      const planned = await this.creditReportReminderService.planForLoan(
        item.installment.loanId,
        { targetPhoneNumbers, throwIfNotDue: true },
      );
      return planned
        ? this.sendPlans(client, planned.plans, channel, options)
        : [];
    }
    throw new BadRequestException(
      `Message log ${original.id} has a type that is never sent by ${channel}: ${original.type}`,
    );
  }

  private async runCreditReport(
    clientsById: Map<string, Client>,
    channel: BrevoChannel,
  ): Promise<void> {
    const loanIds =
      await this.creditReportReminderService.findLoanIdsDueForNotice();
    for (const loanId of loanIds) {
      try {
        const planned =
          await this.creditReportReminderService.planForLoan(loanId);
        const client = planned && clientsById.get(planned.clientId);
        if (!planned || !client) {
          continue;
        }
        const alreadySent =
          await this.creditReportReminderService.wasAlreadySent(
            planned,
            CHANNEL_BY_BREVO[channel],
          );
        if (!alreadySent) {
          await this.sendPlans(client, planned.plans, channel);
        }
      } catch (error) {
        this.logger.error(
          `Failed to send credit report ${channel} notice for loan ${loanId}`,
          error,
        );
      }
    }
  }

  // Same client selection as the WhatsApp job of the family: overdue = any
  // overdue cuota; upcoming = a cuota due soon and nothing overdue (the
  // overdue reminder already covers those).
  private async findClientIdsFor(
    family: ReminderFamily.Overdue | ReminderFamily.UpcomingDue,
    clientsById: Map<string, Client>,
  ): Promise<string[]> {
    const overdueIds = await findClientIdsWithOverdueInstallments(
      this.installmentsRepository,
    );
    if (family === ReminderFamily.Overdue) {
      return overdueIds.filter((id) => clientsById.has(id));
    }
    const overdue = new Set(overdueIds);
    const { upcomingDueReminderDays } = this.configService.get('cron', {
      infer: true,
    });
    const upcomingIds = await findClientIdsWithUpcomingInstallments(
      this.installmentsRepository,
      upcomingDueReminderDays,
    );
    return upcomingIds.filter((id) => clientsById.has(id) && !overdue.has(id));
  }

  private findSelectedClients(channel: BrevoChannel): Promise<Client[]> {
    return this.clientsRepository.find({
      where:
        channel === BrevoChannel.Email
          ? { emailRemindersEnabled: true, email: Not(IsNull()) }
          : { smsRemindersEnabled: true },
    });
  }

  private async sendPlans(
    client: Client,
    plans: PlannedReminder[],
    channel: BrevoChannel,
    options: SendOptions = {},
  ): Promise<MessageLog[]> {
    const savedLogs: MessageLog[] = [];
    for (const plan of plans) {
      const template = await this.channelTemplatesService.findOneOrThrow(
        plan.type,
        channel,
      );
      const rendered = this.channelTemplatesService.render(
        template,
        plan.bodyParameters,
      );

      if (channel === BrevoChannel.Email) {
        // Email only exists for the client: a loan whose reminders go to a
        // third-party contact isn't emailed to the client, the same way
        // WhatsApp doesn't message the client about it.
        const email = client.email?.trim();
        if (!plan.isClientGroup || !email) {
          continue;
        }
        const result = await this.brevoService.sendEmail({
          to: email,
          subject: rendered.subject ?? '',
          htmlContent: renderEmailHtml(rendered.text),
          textContent: renderEmailText(rendered.text),
        });
        const log = await this.saveLog(client.id, plan, result, {
          channel: MessageChannel.Email,
          email,
          messageContent: `Asunto: ${rendered.subject ?? ''}\n\n${renderEmailText(rendered.text)}`,
        });
        if (log) {
          savedLogs.push(log);
        }
        continue;
      }

      const phoneNumbers = options.targetPhoneNumber
        ? plan.recipientPhoneNumbers.filter(
            (phone) => phone === options.targetPhoneNumber,
          )
        : plan.recipientPhoneNumbers;
      for (const phoneNumber of phoneNumbers) {
        const result = await this.brevoService.sendSms({
          to: phoneNumber,
          content: rendered.text,
        });
        const log = await this.saveLog(client.id, plan, result, {
          channel: MessageChannel.Sms,
          phoneNumber,
          messageContent: rendered.text,
        });
        if (log) {
          savedLogs.push(log);
        }
      }
    }
    return savedLogs;
  }

  // Null when the send was never attempted (channel paused or not
  // configured): logging those as failed is what filled message_logs with
  // junk twice before (see docs/DATABASE.md's 2026-09-11 / 2026-09-19
  // cleanups).
  private async saveLog(
    clientId: string,
    plan: PlannedReminder,
    result: BrevoSendResult,
    recipient: {
      channel: MessageChannel;
      phoneNumber?: string;
      email?: string;
      messageContent: string;
    },
  ): Promise<MessageLog | null> {
    if (result.failureReason && NOT_ATTEMPTED.has(result.failureReason)) {
      return null;
    }
    const savedLog = await this.messageLogsRepository.save(
      this.messageLogsRepository.create({
        clientId,
        type: plan.type,
        channel: recipient.channel,
        phoneNumber: recipient.phoneNumber ?? null,
        email: recipient.email ?? null,
        messageContent: recipient.messageContent,
        breakdownContent: plan.breakdownContent,
        status: result.sent ? MessageLogStatus.Sent : MessageLogStatus.Failed,
        sentAt: new Date(),
        providerMessageId: result.providerMessageId,
        lastErrorTitle: result.sent
          ? null
          : `${result.failureReason}: ${result.errorMessage ?? ''}`.trim(),
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
    return savedLog;
  }
}
