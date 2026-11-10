import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { CronJob, validateCronExpression } from 'cron';
import { Repository } from 'typeorm';

import { BrevoChannel } from '../../brevo/brevoTypes';
import {
  ChannelReminderFamily,
  MessageChannelSchedule,
} from '../entities/messageChannelSchedule.entity';

import { ChannelReminderService } from './channelReminder.service';

// Same as WhatsappCronService — cron expressions are business times.
const COLOMBIA_TIME_ZONE = 'America/Bogota';

// Phase 36, stage 3 — one cron job per (family, channel) row of
// message_channel_schedules, each with its own schedule and on/off,
// independent of the WhatsApp job of the same family. Mirrors
// WhatsappCronService: the row is the source of truth, the in-memory job
// is rebuilt from it on boot and on every change.
@Injectable()
export class ChannelReminderCronService implements OnModuleInit {
  private readonly logger = new Logger(ChannelReminderCronService.name);

  constructor(
    @InjectRepository(MessageChannelSchedule)
    private readonly schedulesRepository: Repository<MessageChannelSchedule>,
    private readonly channelReminderService: ChannelReminderService,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {}

  static jobName(family: ChannelReminderFamily, channel: BrevoChannel): string {
    return `channelReminderCron:${family}:${channel}`;
  }

  async onModuleInit(): Promise<void> {
    const schedules = await this.schedulesRepository.find();
    for (const schedule of schedules) {
      this.registerJob(schedule);
    }
  }

  findAll(): Promise<MessageChannelSchedule[]> {
    return this.schedulesRepository.find({
      order: { family: 'ASC', channel: 'ASC' },
    });
  }

  async reschedule(
    family: ChannelReminderFamily,
    channel: BrevoChannel,
    cronExpression: string,
  ): Promise<MessageChannelSchedule> {
    const { valid } = validateCronExpression(cronExpression);
    if (!valid) {
      throw new BadRequestException(
        `'${cronExpression}' is not a valid cron expression`,
      );
    }
    const schedule = await this.findOneOrThrow(family, channel);
    schedule.cronExpression = cronExpression;
    const saved = await this.schedulesRepository.save(schedule);
    this.registerJob(saved);
    return saved;
  }

  async setPaused(
    family: ChannelReminderFamily,
    channel: BrevoChannel,
    isPaused: boolean,
  ): Promise<MessageChannelSchedule> {
    const schedule = await this.findOneOrThrow(family, channel);
    schedule.isPaused = isPaused;
    const saved = await this.schedulesRepository.save(schedule);
    this.registerJob(saved);
    return saved;
  }

  private async findOneOrThrow(
    family: ChannelReminderFamily,
    channel: BrevoChannel,
  ): Promise<MessageChannelSchedule> {
    const schedule = await this.schedulesRepository.findOneBy({
      family,
      channel,
    });
    if (!schedule) {
      throw new NotFoundException(
        `No ${channel} schedule is configured for '${family}'`,
      );
    }
    return schedule;
  }

  private registerJob(schedule: MessageChannelSchedule): void {
    const { family, channel, cronExpression, isPaused } = schedule;
    const jobName = ChannelReminderCronService.jobName(family, channel);
    if (this.schedulerRegistry.doesExist('cron', jobName)) {
      this.schedulerRegistry.deleteCronJob(jobName);
    }
    const job = new CronJob(
      cronExpression,
      () => {
        void this.channelReminderService
          .runFamily(family, channel)
          .catch((error: unknown) => {
            this.logger.error(`${family} ${channel} cron job failed`, error);
          });
      },
      undefined,
      undefined,
      COLOMBIA_TIME_ZONE,
    );
    this.schedulerRegistry.addCronJob(jobName, job);
    if (!isPaused) {
      job.start();
    }
    this.logger.log(
      `${family} ${channel} cron scheduled: ${cronExpression}${isPaused ? ' (paused)' : ''}`,
    );
  }
}
