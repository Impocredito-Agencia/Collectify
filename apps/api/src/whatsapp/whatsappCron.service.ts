import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';

import { Configuration } from '../config/configuration';

import { MessageTemplate } from './entities/messageTemplate.entity';
import { MessageTemplatesService } from './messageTemplates/messageTemplates.service';
import { NewLoanReminderService } from './newLoanReminder.service';
import { OverdueReminderService } from './overdueReminder.service';
import {
  NEW_LOAN_FAMILY_TYPES,
  OVERDUE_FAMILY_TYPES,
  ReminderFamily,
  UPCOMING_FAMILY_TYPES,
} from './reminderFamily';
import { UpcomingDueReminderService } from './upcomingDueReminder.service';

// Phase 33 rewrite — one job per FAMILY (confirmed with the human,
// 2026-09-01), not per exact MessageType: "vencida" now spans 4 templates
// and "próxima a vencer" spans 2, but the admin's existing pause/resume/
// reschedule mechanics shouldn't fragment into 6 separate jobs over it. See
// reminderFamily.ts. NewLoan added 2026-09-06 (see that file's comment) —
// payment-confirmation/paid-in-full types still have no cron job at all,
// sent synchronously at their triggering event (PaymentConfirmationService).
//
// Each family's schedule is still sourced from a single MessageTemplate
// row's `cronExpression` — the first type listed in that family's array
// (OVERDUE_FAMILY_TYPES[0] / UPCOMING_FAMILY_TYPES[0] / NEW_LOAN_FAMILY_TYPES[0])
// is the "schedule owner" row an admin edits via
// PATCH /whatsapp/cron/:family/schedule; the other types in the family
// don't carry their own schedule.
const SCHEDULE_OWNER: Record<
  ReminderFamily,
  (typeof OVERDUE_FAMILY_TYPES)[number]
> = {
  [ReminderFamily.Overdue]: OVERDUE_FAMILY_TYPES[0],
  [ReminderFamily.UpcomingDue]: UPCOMING_FAMILY_TYPES[0],
  [ReminderFamily.NewLoan]: NEW_LOAN_FAMILY_TYPES[0],
};

// Bug fix, 2026-09-03 (human report): a schedule saved via the admin
// panel's hour/minute picker (cronScheduleUtils.ts) never fired at the
// wall-clock time the admin actually picked. `CronJob` without an explicit
// timeZone runs the cron fields against the SERVER's local time zone
// (UTC on Railway) — but the picker builds its hour/minute assuming the
// admin's own local time, and IMPROCRÉDITO operates out of Pasto,
// Colombia (see the "Pasto" mention baked into the new-loan template
// body). Every job here is pinned to Colombia's zone explicitly so the
// two agree regardless of what time zone the Node process itself runs
// in. Colombia has no DST, so this needs no seasonal handling.
const COLOMBIA_TIME_ZONE = 'America/Bogota';

@Injectable()
export class WhatsappCronService implements OnModuleInit {
  private readonly logger = new Logger(WhatsappCronService.name);

  constructor(
    private readonly overdueReminderService: OverdueReminderService,
    private readonly upcomingDueReminderService: UpcomingDueReminderService,
    private readonly newLoanReminderService: NewLoanReminderService,
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
    const {
      overdueReminderExpression,
      upcomingDueReminderExpression,
      newLoanReminderExpression,
    } = this.configService.get('cron', { infer: true });

    switch (family) {
      case ReminderFamily.Overdue:
        return overdueReminderExpression;
      case ReminderFamily.UpcomingDue:
        return upcomingDueReminderExpression;
      case ReminderFamily.NewLoan:
        return newLoanReminderExpression;
    }
  }

  private runFor(family: ReminderFamily): Promise<void> {
    switch (family) {
      case ReminderFamily.Overdue:
        return this.overdueReminderService.runWeeklyReminder();
      case ReminderFamily.UpcomingDue:
        return this.upcomingDueReminderService.runDailyReminder();
      case ReminderFamily.NewLoan:
        return this.newLoanReminderService.runPendingLoanNotifications();
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

    const job = new CronJob(
      expression,
      () => {
        void this.runFor(family).catch((error: unknown) => {
          this.logger.error(`${family} cron job failed`, error);
        });
      },
      undefined,
      undefined,
      COLOMBIA_TIME_ZONE,
    );

    this.schedulerRegistry.addCronJob(jobName, job);
    job.start();
    this.logger.log(`${family} cron scheduled: ${expression}`);
  }
}
