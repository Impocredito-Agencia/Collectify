import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';

import { MessageTemplatesService } from './messageTemplates/messageTemplates.service';
import { MessageType } from './messageType.enum';
import { NewLoanReminderService } from './newLoanReminder.service';
import { OverdueReminderService } from './overdueReminder.service';
import { OVERDUE_FAMILY_TYPES, ReminderFamily } from './reminderFamily';
import { UpcomingDueReminderService } from './upcomingDueReminder.service';
import { WhatsappCronService } from './whatsappCron.service';

class FakeCronJob {
  isActive = false;
  constructor(
    readonly cronTime: string,
    readonly onTick: () => void,
  ) {}
  start = jest.fn(() => {
    this.isActive = true;
  });
  stop = jest.fn(() => {
    this.isActive = false;
  });
}

jest.mock('cron', () => ({
  CronJob: jest.fn(
    (cronTime: string, onTick: () => void) => new FakeCronJob(cronTime, onTick),
  ),
}));

describe('WhatsappCronService', () => {
  let service: WhatsappCronService;
  let overdueReminderService: { runWeeklyReminder: jest.Mock };
  let upcomingDueReminderService: { runDailyReminder: jest.Mock };
  let newLoanReminderService: { runPendingLoanNotifications: jest.Mock };
  let messageTemplatesService: {
    findByTypeOrThrow: jest.Mock;
    updateCronExpression: jest.Mock;
    updateCronPaused: jest.Mock;
  };
  let jobs: Map<string, FakeCronJob>;
  let schedulerRegistry: {
    addCronJob: jest.Mock;
    getCronJob: jest.Mock;
    doesExist: jest.Mock;
    deleteCronJob: jest.Mock;
  };

  beforeEach(async () => {
    overdueReminderService = { runWeeklyReminder: jest.fn() };
    upcomingDueReminderService = { runDailyReminder: jest.fn() };
    newLoanReminderService = { runPendingLoanNotifications: jest.fn() };
    messageTemplatesService = {
      findByTypeOrThrow: jest
        .fn()
        .mockResolvedValue({ cronExpression: null, cronPaused: false }),
      updateCronExpression: jest.fn(),
      updateCronPaused: jest.fn(),
    };

    jobs = new Map();
    schedulerRegistry = {
      addCronJob: jest.fn((name: string, job: FakeCronJob) => {
        jobs.set(name, job);
      }),
      getCronJob: jest.fn((name: string) => jobs.get(name)),
      doesExist: jest.fn((_type: string, name: string) => jobs.has(name)),
      deleteCronJob: jest.fn((name: string) => jobs.delete(name)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WhatsappCronService,
        {
          provide: OverdueReminderService,
          useValue: overdueReminderService,
        },
        {
          provide: UpcomingDueReminderService,
          useValue: upcomingDueReminderService,
        },
        {
          provide: NewLoanReminderService,
          useValue: newLoanReminderService,
        },
        {
          provide: MessageTemplatesService,
          useValue: messageTemplatesService,
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue({
              overdueReminderExpression: '0 9 * * 1,3,5',
              upcomingDueReminderExpression: '0 8 * * *',
              newLoanReminderExpression: '0 10 * * 1',
            }),
          },
        },
        { provide: SchedulerRegistry, useValue: schedulerRegistry },
      ],
    }).compile();

    service = module.get<WhatsappCronService>(WhatsappCronService);
  });

  describe('onModuleInit', () => {
    it('registers and starts one job per family', async () => {
      await service.onModuleInit();

      expect(schedulerRegistry.addCronJob).toHaveBeenCalledTimes(3);
      for (const family of [
        ReminderFamily.Overdue,
        ReminderFamily.UpcomingDue,
        ReminderFamily.NewLoan,
      ]) {
        const job = jobs.get(WhatsappCronService.jobName(family));
        expect(job?.isActive).toBe(true);
      }
    });

    it('uses the schedule-owner template cronExpression when set, falling back to the code default otherwise', async () => {
      messageTemplatesService.findByTypeOrThrow.mockImplementation(
        (type: MessageType) =>
          Promise.resolve({
            cronExpression:
              type === OVERDUE_FAMILY_TYPES[0] ? '0 7 * * *' : null,
            cronPaused: false,
          }),
      );

      await service.onModuleInit();

      const cronJobMock = CronJob as unknown as jest.Mock;
      expect(cronJobMock).toHaveBeenCalledWith(
        '0 7 * * *',
        expect.any(Function) as unknown,
        undefined,
        undefined,
        'America/Bogota',
      );
      expect(cronJobMock).toHaveBeenCalledWith(
        '0 8 * * *',
        expect.any(Function) as unknown,
        undefined,
        undefined,
        'America/Bogota',
      );
    });

    // Bug fix, 2026-09-03 (human report): a schedule picked in the admin
    // panel never fired at the wall-clock time the admin actually set —
    // CronJob defaults to the server's own time zone (UTC on Railway),
    // not the admin's (Colombia).
    it('pins every job to Colombia time, not the server default', async () => {
      await service.onModuleInit();

      const cronJobMock = CronJob as unknown as jest.Mock;
      for (const call of cronJobMock.mock.calls as unknown[][]) {
        expect(call[4]).toBe('America/Bogota');
      }
    });
  });

  describe('getStatus/pause/resume', () => {
    beforeEach(async () => {
      await service.onModuleInit();
    });

    it('reports the running state', () => {
      expect(service.getStatus(ReminderFamily.Overdue)).toEqual({
        running: true,
      });
    });

    it('pauses a job', async () => {
      await service.pause(ReminderFamily.Overdue);

      expect(service.getStatus(ReminderFamily.Overdue)).toEqual({
        running: false,
      });
    });

    it('resumes a paused job', async () => {
      await service.pause(ReminderFamily.Overdue);

      await service.resume(ReminderFamily.Overdue);

      expect(service.getStatus(ReminderFamily.Overdue)).toEqual({
        running: true,
      });
    });

    // Human report, 2026-09-19 — pause()/resume() used to only touch the
    // in-memory CronJob; nothing survived a restart. See
    // WhatsappCronService's own comment on this date.
    it('persists the pause on the schedule-owner template', async () => {
      await service.pause(ReminderFamily.Overdue);

      expect(messageTemplatesService.updateCronPaused).toHaveBeenCalledWith(
        OVERDUE_FAMILY_TYPES[0],
        true,
      );
    });

    it('persists the resume on the schedule-owner template', async () => {
      await service.resume(ReminderFamily.Overdue);

      expect(messageTemplatesService.updateCronPaused).toHaveBeenCalledWith(
        OVERDUE_FAMILY_TYPES[0],
        false,
      );
    });
  });

  describe('onModuleInit — pause survives a restart', () => {
    // Human report, 2026-09-19 — the whole point of persisting cronPaused:
    // a fresh boot (simulated here by a brand-new onModuleInit(), the same
    // call a real restart/deploy makes) must not silently resume a family
    // an admin had paused before.
    it('does not start a job whose schedule-owner template has cronPaused: true', async () => {
      messageTemplatesService.findByTypeOrThrow.mockImplementation(
        (type: MessageType) =>
          Promise.resolve({
            cronExpression: null,
            cronPaused: type === OVERDUE_FAMILY_TYPES[0],
          }),
      );

      await service.onModuleInit();

      expect(service.getStatus(ReminderFamily.Overdue)).toEqual({
        running: false,
      });
      expect(service.getStatus(ReminderFamily.UpcomingDue)).toEqual({
        running: true,
      });
    });
  });

  describe('reschedule', () => {
    beforeEach(async () => {
      await service.onModuleInit();
    });

    it('persists the new expression on the schedule-owner template and replaces the running job', async () => {
      messageTemplatesService.updateCronExpression.mockResolvedValue({
        type: OVERDUE_FAMILY_TYPES[0],
        cronExpression: '0 10 * * *',
      });

      const result = await service.reschedule(
        ReminderFamily.Overdue,
        '0 10 * * *',
      );

      expect(messageTemplatesService.updateCronExpression).toHaveBeenCalledWith(
        OVERDUE_FAMILY_TYPES[0],
        '0 10 * * *',
      );
      expect(result.cronExpression).toBe('0 10 * * *');
      expect(schedulerRegistry.deleteCronJob).toHaveBeenCalledWith(
        WhatsappCronService.jobName(ReminderFamily.Overdue),
      );
      expect(service.getStatus(ReminderFamily.Overdue)).toEqual({
        running: true,
      });
    });

    // Human report, 2026-09-19 — a schedule change shouldn't silently
    // resume a family an admin had paused.
    it('does not resume an already-paused family just because its schedule changed', async () => {
      await service.pause(ReminderFamily.Overdue);
      messageTemplatesService.updateCronExpression.mockResolvedValue({
        type: OVERDUE_FAMILY_TYPES[0],
        cronExpression: '0 10 * * *',
        cronPaused: true,
      });

      await service.reschedule(ReminderFamily.Overdue, '0 10 * * *');

      expect(service.getStatus(ReminderFamily.Overdue)).toEqual({
        running: false,
      });
    });
  });

  describe('cron job execution', () => {
    it('invokes runWeeklyReminder when the overdue job ticks', async () => {
      await service.onModuleInit();
      const job = jobs.get(WhatsappCronService.jobName(ReminderFamily.Overdue));
      overdueReminderService.runWeeklyReminder.mockResolvedValue(undefined);

      job?.onTick();

      expect(overdueReminderService.runWeeklyReminder).toHaveBeenCalled();
    });

    it('invokes runDailyReminder when the upcoming_due job ticks', async () => {
      await service.onModuleInit();
      const job = jobs.get(
        WhatsappCronService.jobName(ReminderFamily.UpcomingDue),
      );
      upcomingDueReminderService.runDailyReminder.mockResolvedValue(undefined);

      job?.onTick();

      expect(upcomingDueReminderService.runDailyReminder).toHaveBeenCalled();
    });

    it('invokes runPendingLoanNotifications when the new_loan job ticks', async () => {
      await service.onModuleInit();
      const job = jobs.get(WhatsappCronService.jobName(ReminderFamily.NewLoan));
      newLoanReminderService.runPendingLoanNotifications.mockResolvedValue(
        undefined,
      );

      job?.onTick();

      expect(
        newLoanReminderService.runPendingLoanNotifications,
      ).toHaveBeenCalled();
    });
  });
});
