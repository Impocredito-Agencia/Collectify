import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { BrevoChannel } from '../../brevo/brevoTypes';
import { MessageChannelSchedule } from '../entities/messageChannelSchedule.entity';
import { ReminderFamily } from '../reminderFamily';

import { ChannelReminderService } from './channelReminder.service';
import { ChannelReminderCronService } from './channelReminderCron.service';

function schedule(
  overrides: Partial<MessageChannelSchedule> = {},
): MessageChannelSchedule {
  return {
    id: 'schedule-1',
    family: ReminderFamily.Overdue,
    channel: BrevoChannel.Sms,
    cronExpression: '0 10 * * 5',
    isPaused: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('ChannelReminderCronService', () => {
  let service: ChannelReminderCronService;
  let repository: { find: jest.Mock; findOneBy: jest.Mock; save: jest.Mock };
  let registry: SchedulerRegistry;

  const job = (row: MessageChannelSchedule) =>
    registry.getCronJob(
      ChannelReminderCronService.jobName(row.family, row.channel),
    );

  beforeEach(async () => {
    repository = {
      find: jest.fn(),
      findOneBy: jest.fn(),
      save: jest.fn((row: MessageChannelSchedule) => Promise.resolve(row)),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChannelReminderCronService,
        SchedulerRegistry,
        {
          provide: getRepositoryToken(MessageChannelSchedule),
          useValue: repository,
        },
        { provide: ChannelReminderService, useValue: { runFamily: jest.fn() } },
      ],
    }).compile();
    service = module.get(ChannelReminderCronService);
    registry = module.get(SchedulerRegistry);
  });

  afterEach(() => {
    for (const [, cronJob] of registry.getCronJobs()) {
      void cronJob.stop();
    }
  });

  it('registers one job per row on boot, started only when not paused', async () => {
    const paused = schedule();
    const active = schedule({
      id: 'schedule-2',
      channel: BrevoChannel.Email,
      isPaused: false,
    });
    repository.find.mockResolvedValue([paused, active]);

    await service.onModuleInit();

    expect(job(paused).isActive).toBe(false);
    expect(job(active).isActive).toBe(true);
  });

  it('resumes and pauses a job, persisting the flag', async () => {
    const row = schedule();
    repository.find.mockResolvedValue([row]);
    repository.findOneBy.mockResolvedValue(row);
    await service.onModuleInit();

    await service.setPaused(ReminderFamily.Overdue, BrevoChannel.Sms, false);
    expect(repository.save).toHaveBeenLastCalledWith(
      expect.objectContaining({ isPaused: false }),
    );
    expect(job(row).isActive).toBe(true);

    await service.setPaused(ReminderFamily.Overdue, BrevoChannel.Sms, true);
    expect(job(row).isActive).toBe(false);
  });

  it('reschedules with a valid expression and keeps the paused state', async () => {
    const row = schedule();
    repository.findOneBy.mockResolvedValue(row);

    const saved = await service.reschedule(
      ReminderFamily.Overdue,
      BrevoChannel.Sms,
      '0 9 * * 1,3',
    );

    expect(saved.cronExpression).toBe('0 9 * * 1,3');
    expect(job(row).isActive).toBe(false);
  });

  it('rejects an invalid expression without saving', async () => {
    await expect(
      service.reschedule(ReminderFamily.Overdue, BrevoChannel.Sms, 'nope'),
    ).rejects.toThrow(BadRequestException);
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('throws NotFound for a family with no email/SMS schedule', async () => {
    repository.findOneBy.mockResolvedValue(null);

    await expect(
      service.setPaused(
        ReminderFamily.NewLoan as never,
        BrevoChannel.Email,
        false,
      ),
    ).rejects.toThrow(NotFoundException);
  });
});
