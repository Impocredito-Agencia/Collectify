import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';

import { Configuration } from '../config/configuration';

import { MessageTemplate } from './entities/messageTemplate.entity';
import { MessageTemplatesService } from './messageTemplates/messageTemplates.service';
import { OverdueReminderService } from './overdueReminder.service';
import {
  OVERDUE_FAMILY_TYPES,
  ReminderFamily,
  UPCOMING_FAMILY_TYPES,
} from './reminderFamily';
import { UpcomingDueReminderService } from './upcomingDueReminder.service';

// Phase 33 rewrite — one job per FAMILY (confirmed with the human,
// 2026-09-01), not per exact MessageType: "vencida" now spans 4 templates
// and "próxima a vencer" spans 2, but the admin's existing pause/resume/
// reschedule mechanics shouldn't fragment into 6 separate jobs over it. See
// reminderFamily.ts. `new_loan`/refinance and payment-confirmation types
// have no cron job at all — they're sent synchronously at their triggering
// event (NewLoanReminderService, PaymentConfirmationService).
//
// Each family's schedule is still sourced from a single MessageTemplate
// row's `cronExpression` — the first type listed in that family's array
// (OVERDUE_FAMILY_TYPES[0] / UPCOMING_FAMILY_TYPES[0]) is the "schedule
// owner" row an admin edits via PATCH /whatsapp/cron/:family/schedule; the
// other types in the family don't carry their own schedule.
const SCHEDULE_OWNER: Record<
  ReminderFamily,
  (typeof OVERDUE_FAMILY_TYPES)[number]
> = {
  [ReminderFamily.Overdue]: OVERDUE_FAMILY_TYPES[0],
  [ReminderFamily.UpcomingDue]: UPCOMING_FAMILY_TYPES[0],
};

@Injectable()
export class WhatsappCronService implements OnModuleInit {
  private readonly logger = new Logger(WhatsappCronService.name);

  constructor(
    private readonly overdueReminderService: OverdueReminderService,
    private readonly upcomingDueReminderService: UpcomingDueReminderService,
    private readonly messageTemplatesService: MessageTemplatesService,
    private readonly configService: ConfigService<Configuration, true>,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {}

  static jobName(family: ReminderFamily): string {
    return `whatsappCron:${family}`;
  }

  async onModuleInit(): Promise<void> {
    for (const family of Object.values(ReminderFamily)) {
      const expression = await this.resolveExpression(family);
      this.registerJob(family, expression);
    }
  }

  getStatus(family: ReminderFamily): { running: boolean } {
    const job = this.schedulerRegistry.getCronJob(
      WhatsappCronService.jobName(family),
    );
    // The `cron` package's CronJob exposes this as `isActive` (a getter),
    // not `running`.
    return { running: job.isActive };
  }

  async pause(family: ReminderFamily): Promise<{ paused: true }> {
    await this.schedulerRegistry
      .getCronJob(WhatsappCronService.jobName(family))
      .stop();
    return { paused: true };
  }

  resume(family: ReminderFamily): { paused: false } {
    this.schedulerRegistry
      .getCronJob(WhatsappCronService.jobName(family))
      .start();
    return { paused: false };
  }

  async reschedule(
    family: ReminderFamily,
    cronExpression: string,
  ): Promise<MessageTemplate> {
    const template = await this.messageTemplatesService.updateCronExpression(
      SCHEDULE_OWNER[family],
      cronExpression,
    );
    this.registerJob(family, cronExpression);
    return template;
  }

  private async resolveExpression(family: ReminderFamily): Promise<string> {
    const template = await this.messageTemplatesService.findByTypeOrThrow(
      SCHEDULE_OWNER[family],
    );
    return template.cronExpression ?? this.defaultExpression(family);
  }

  private defaultExpression(family: ReminderFamily): string {
    const { overdueReminderExpression, upcomingDueReminderExpression } =
      this.configService.get('cron', { infer: true });

    switch (family) {
      case ReminderFamily.Overdue:
        return overdueReminderExpression;
      case ReminderFamily.UpcomingDue:
        return upcomingDueReminderExpression;
    }
  }

  private runFor(family: ReminderFamily): Promise<void> {
    switch (family) {
      case ReminderFamily.Overdue:
        return this.overdueReminderService.runWeeklyReminder();
      case ReminderFamily.UpcomingDue:
        return this.upcomingDueReminderService.runDailyReminder();
    }
  }

  // Registering over an existing job name replaces it — used both at boot
  // and by reschedule(), so a schedule change takes effect without a
  // restart.
  private registerJob(family: ReminderFamily, expression: string): void {
    const jobName = WhatsappCronService.jobName(family);
    if (this.schedulerRegistry.doesExist('cron', jobName)) {
      this.schedulerRegistry.deleteCronJob(jobName);
    }

    const job = new CronJob(expression, () => {
      void this.runFor(family).catch((error: unknown) => {
        this.logger.error(`${family} cron job failed`, error);
      });
    });

    this.schedulerRegistry.addCronJob(jobName, job);
    job.start();
    this.logger.log(`${family} cron scheduled: ${expression}`);
  }
}
