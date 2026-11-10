import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { BrevoService } from '../../brevo/brevo.service';
import {
  BrevoChannel,
  BrevoSendFailureReason,
  BrevoSendResult,
} from '../../brevo/brevoTypes';
import { Client } from '../../clients/entities/client.entity';
import { Installment } from '../../loans/entities/installment.entity';
import { MessageChannelTemplatesService } from '../channelTemplates/messageChannelTemplates.service';
import { CreditReportReminderService } from '../creditReportReminder.service';
import { MessageLog, MessageLogStatus } from '../entities/messageLog.entity';
import { MessageLogItem } from '../entities/messageLogItem.entity';
import { MessageChannel } from '../messageChannel.enum';
import { MessageType } from '../messageType.enum';
import { OverdueReminderService } from '../overdueReminder.service';
import { ReminderFamily } from '../reminderFamily';
import {
  findClientIdsWithOverdueInstallments,
  findClientIdsWithUpcomingInstallments,
} from '../reminderInstallmentQueries';
import { PlannedReminder } from '../reminderPlan';
import { UpcomingDueReminderService } from '../upcomingDueReminder.service';

import { ChannelReminderService } from './channelReminder.service';

jest.mock('../reminderInstallmentQueries', () => ({
  findClientIdsWithOverdueInstallments: jest.fn(),
  findClientIdsWithUpcomingInstallments: jest.fn(),
}));

const findOverdueIds = findClientIdsWithOverdueInstallments as jest.Mock;
const findUpcomingIds = findClientIdsWithUpcomingInstallments as jest.Mock;

function client(overrides: Partial<Client> = {}): Client {
  return {
    id: 'client-a',
    firstName: 'Juana',
    lastName: 'Pérez',
    email: 'juana@example.com',
    phoneNumber: '+573001111111',
    emailRemindersEnabled: true,
    smsRemindersEnabled: true,
    ...overrides,
  } as Client;
}

function plan(overrides: Partial<PlannedReminder> = {}): PlannedReminder {
  return {
    type: MessageType.SingleOverdueInstallment,
    bodyParameters: ['Señor/a Juana Pérez', '3'],
    recipientPhoneNumbers: ['+573001111111', '+573002222222'],
    isClientGroup: true,
    breakdownContent: null,
    items: [
      {
        installmentId: 'inst-1',
        overdueDaysSnapshot: 12,
        interestSnapshot: 900,
      },
    ],
    ...overrides,
  };
}

const SENT: BrevoSendResult = {
  sent: true,
  providerMessageId: 'brevo-1',
  failureReason: null,
  errorMessage: null,
};

describe('ChannelReminderService', () => {
  let service: ChannelReminderService;
  let clientsRepository: { find: jest.Mock; findOneBy: jest.Mock };
  let messageLogsRepository: { create: jest.Mock; save: jest.Mock };
  let messageLogItemsRepository: {
    create: jest.Mock;
    save: jest.Mock;
    findOne: jest.Mock;
  };
  let overdueReminderService: { planReminderForClient: jest.Mock };
  let upcomingDueReminderService: { planReminderForClient: jest.Mock };
  let creditReportReminderService: {
    findLoanIdsDueForNotice: jest.Mock;
    planForLoan: jest.Mock;
    wasAlreadySent: jest.Mock;
  };
  let channelTemplatesService: { findOneOrThrow: jest.Mock; render: jest.Mock };
  let brevoService: { sendEmail: jest.Mock; sendSms: jest.Mock };

  const savedLogs = () =>
    messageLogsRepository.create.mock.calls.map(
      ([log]) => log as Partial<MessageLog>,
    );

  beforeEach(async () => {
    findOverdueIds.mockReset().mockResolvedValue([]);
    findUpcomingIds.mockReset().mockResolvedValue([]);
    clientsRepository = { find: jest.fn(), findOneBy: jest.fn() };
    messageLogsRepository = {
      create: jest.fn((log: Partial<MessageLog>) => log),
      save: jest.fn((log: Partial<MessageLog>) =>
        Promise.resolve({ ...log, id: `log-${Math.random()}` }),
      ),
    };
    messageLogItemsRepository = {
      create: jest.fn((item: unknown) => item),
      save: jest.fn((items: unknown) => Promise.resolve(items)),
      findOne: jest.fn(),
    };
    overdueReminderService = { planReminderForClient: jest.fn() };
    upcomingDueReminderService = { planReminderForClient: jest.fn() };
    creditReportReminderService = {
      findLoanIdsDueForNotice: jest.fn().mockResolvedValue([]),
      planForLoan: jest.fn(),
      wasAlreadySent: jest.fn().mockResolvedValue(false),
    };
    channelTemplatesService = {
      findOneOrThrow: jest.fn((type: MessageType, channel: BrevoChannel) =>
        Promise.resolve({ type, channel }),
      ),
      render: jest.fn(
        (template: { channel: BrevoChannel }, parameters: string[]) => ({
          subject:
            template.channel === BrevoChannel.Email
              ? `Asunto ${parameters[1]}`
              : null,
          text: `Texto *${parameters.join('|')}*`,
        }),
      ),
    };
    brevoService = {
      sendEmail: jest.fn().mockResolvedValue(SENT),
      sendSms: jest.fn().mockResolvedValue(SENT),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChannelReminderService,
        { provide: getRepositoryToken(Client), useValue: clientsRepository },
        { provide: getRepositoryToken(Installment), useValue: {} },
        {
          provide: getRepositoryToken(MessageLog),
          useValue: messageLogsRepository,
        },
        {
          provide: getRepositoryToken(MessageLogItem),
          useValue: messageLogItemsRepository,
        },
        { provide: OverdueReminderService, useValue: overdueReminderService },
        {
          provide: UpcomingDueReminderService,
          useValue: upcomingDueReminderService,
        },
        {
          provide: CreditReportReminderService,
          useValue: creditReportReminderService,
        },
        {
          provide: MessageChannelTemplatesService,
          useValue: channelTemplatesService,
        },
        { provide: BrevoService, useValue: brevoService },
        {
          provide: ConfigService,
          useValue: { get: () => ({ upcomingDueReminderDays: 5 }) },
        },
      ],
    }).compile();

    service = module.get(ChannelReminderService);
  });

  describe('runFamily — overdue', () => {
    it('only reaches selected clients that have something overdue', async () => {
      clientsRepository.find.mockResolvedValue([
        client(),
        client({ id: 'client-c' }),
      ]);
      findOverdueIds.mockResolvedValue(['client-a', 'client-b']);
      overdueReminderService.planReminderForClient.mockResolvedValue([plan()]);

      await service.runFamily(ReminderFamily.Overdue, BrevoChannel.Email);

      expect(
        overdueReminderService.planReminderForClient,
      ).toHaveBeenCalledTimes(1);
      expect(overdueReminderService.planReminderForClient).toHaveBeenCalledWith(
        'client-a',
      );
    });

    it('looks up only clients with email on for email, and with an email', async () => {
      clientsRepository.find.mockResolvedValue([]);

      await service.runFamily(ReminderFamily.Overdue, BrevoChannel.Email);

      const [{ where }] = clientsRepository.find.mock.calls[0] as [
        { where: Record<string, unknown> },
      ];
      expect(where.emailRemindersEnabled).toBe(true);
      expect(where).toHaveProperty('email');
      expect(findOverdueIds).not.toHaveBeenCalled();
    });

    it('emails the client the rendered template and logs it as an email row', async () => {
      clientsRepository.find.mockResolvedValue([client()]);
      findOverdueIds.mockResolvedValue(['client-a']);
      overdueReminderService.planReminderForClient.mockResolvedValue([plan()]);

      await service.runFamily(ReminderFamily.Overdue, BrevoChannel.Email);

      expect(channelTemplatesService.findOneOrThrow).toHaveBeenCalledWith(
        MessageType.SingleOverdueInstallment,
        BrevoChannel.Email,
      );
      expect(brevoService.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'juana@example.com',
          subject: 'Asunto 3',
          textContent: 'Texto Señor/a Juana Pérez|3',
        }),
      );
      const [input] = brevoService.sendEmail.mock.calls[0] as [
        { htmlContent: string },
      ];
      expect(input.htmlContent).toContain('<strong>');
      expect(savedLogs()).toEqual([
        expect.objectContaining({
          clientId: 'client-a',
          type: MessageType.SingleOverdueInstallment,
          channel: MessageChannel.Email,
          email: 'juana@example.com',
          phoneNumber: null,
          status: MessageLogStatus.Sent,
          providerMessageId: 'brevo-1',
          lastErrorTitle: null,
        }),
      ]);
      expect(messageLogItemsRepository.save).toHaveBeenCalledWith([
        expect.objectContaining({
          installmentId: 'inst-1',
          overdueDaysSnapshot: 12,
          interestSnapshot: 900,
        }),
      ]);
    });

    it('never emails the client about a loan whose reminders go to a third party', async () => {
      clientsRepository.find.mockResolvedValue([client()]);
      findOverdueIds.mockResolvedValue(['client-a']);
      overdueReminderService.planReminderForClient.mockResolvedValue([
        plan({
          isClientGroup: false,
          recipientPhoneNumbers: ['+573009999999'],
        }),
      ]);

      await service.runFamily(ReminderFamily.Overdue, BrevoChannel.Email);

      expect(brevoService.sendEmail).not.toHaveBeenCalled();
    });

    it('sends an SMS to every WhatsApp recipient, third parties included', async () => {
      clientsRepository.find.mockResolvedValue([client()]);
      findOverdueIds.mockResolvedValue(['client-a']);
      overdueReminderService.planReminderForClient.mockResolvedValue([
        plan(),
        plan({
          isClientGroup: false,
          recipientPhoneNumbers: ['+573009999999'],
        }),
      ]);

      await service.runFamily(ReminderFamily.Overdue, BrevoChannel.Sms);

      expect(
        brevoService.sendSms.mock.calls.map(
          ([input]) => (input as { to: string }).to,
        ),
      ).toEqual(['+573001111111', '+573002222222', '+573009999999']);
      expect(savedLogs().map((log) => log.channel)).toEqual([
        MessageChannel.Sms,
        MessageChannel.Sms,
        MessageChannel.Sms,
      ]);
      expect(savedLogs()[0]).toMatchObject({
        phoneNumber: '+573001111111',
        email: null,
      });
    });

    it('logs nothing for a send that was never attempted (paused / not configured)', async () => {
      clientsRepository.find.mockResolvedValue([client()]);
      findOverdueIds.mockResolvedValue(['client-a']);
      overdueReminderService.planReminderForClient.mockResolvedValue([plan()]);
      brevoService.sendSms.mockResolvedValue({
        sent: false,
        providerMessageId: null,
        failureReason: BrevoSendFailureReason.Paused,
        errorMessage: 'paused',
      });

      await service.runFamily(ReminderFamily.Overdue, BrevoChannel.Sms);

      expect(messageLogsRepository.save).not.toHaveBeenCalled();
    });

    it("logs a send Brevo refused as failed, with Brevo's reason", async () => {
      clientsRepository.find.mockResolvedValue([client()]);
      findOverdueIds.mockResolvedValue(['client-a']);
      overdueReminderService.planReminderForClient.mockResolvedValue([
        plan({ recipientPhoneNumbers: ['+573001111111'] }),
      ]);
      brevoService.sendSms.mockResolvedValue({
        sent: false,
        providerMessageId: null,
        failureReason: BrevoSendFailureReason.InsufficientCredits,
        errorMessage: 'Not enough credits',
      });

      await service.runFamily(ReminderFamily.Overdue, BrevoChannel.Sms);

      expect(savedLogs()[0]).toMatchObject({
        status: MessageLogStatus.Failed,
        lastErrorTitle: 'insufficient_credits: Not enough credits',
      });
    });

    it('keeps going with the next client when one fails', async () => {
      clientsRepository.find.mockResolvedValue([
        client(),
        client({ id: 'client-b' }),
      ]);
      findOverdueIds.mockResolvedValue(['client-a', 'client-b']);
      overdueReminderService.planReminderForClient
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce([
          plan({ recipientPhoneNumbers: ['+573003333333'] }),
        ]);

      await service.runFamily(ReminderFamily.Overdue, BrevoChannel.Sms);

      expect(brevoService.sendSms).toHaveBeenCalledTimes(1);
    });
  });

  describe('runFamily — upcoming', () => {
    it('skips selected clients that also have something overdue', async () => {
      clientsRepository.find.mockResolvedValue([
        client(),
        client({ id: 'client-b' }),
      ]);
      findOverdueIds.mockResolvedValue(['client-b']);
      findUpcomingIds.mockResolvedValue(['client-a', 'client-b']);
      upcomingDueReminderService.planReminderForClient.mockResolvedValue([
        plan({ type: MessageType.SingleUpcomingInstallment }),
      ]);

      await service.runFamily(ReminderFamily.UpcomingDue, BrevoChannel.Email);

      expect(findUpcomingIds).toHaveBeenCalledWith({}, 5);
      expect(
        upcomingDueReminderService.planReminderForClient,
      ).toHaveBeenCalledTimes(1);
      expect(
        upcomingDueReminderService.planReminderForClient,
      ).toHaveBeenCalledWith('client-a');
    });
  });

  describe('runFamily — credit report', () => {
    const planned = {
      clientId: 'client-a',
      type: MessageType.CreditReport30Days,
      oldestInstallmentId: 'inst-30',
      plans: [plan({ type: MessageType.CreditReport30Days })],
    };

    it('sends the notice of a selected client once per channel', async () => {
      clientsRepository.find.mockResolvedValue([client()]);
      creditReportReminderService.findLoanIdsDueForNotice.mockResolvedValue([
        'loan-1',
      ]);
      creditReportReminderService.planForLoan.mockResolvedValue(planned);

      await service.runFamily(ReminderFamily.CreditReport, BrevoChannel.Email);

      expect(creditReportReminderService.wasAlreadySent).toHaveBeenCalledWith(
        planned,
        MessageChannel.Email,
      );
      expect(brevoService.sendEmail).toHaveBeenCalledTimes(1);
    });

    it('skips a notice already sent on this channel', async () => {
      clientsRepository.find.mockResolvedValue([client()]);
      creditReportReminderService.findLoanIdsDueForNotice.mockResolvedValue([
        'loan-1',
      ]);
      creditReportReminderService.planForLoan.mockResolvedValue(planned);
      creditReportReminderService.wasAlreadySent.mockResolvedValue(true);

      await service.runFamily(ReminderFamily.CreditReport, BrevoChannel.Sms);

      expect(brevoService.sendSms).not.toHaveBeenCalled();
    });

    it("skips a loan whose client isn't selected", async () => {
      clientsRepository.find.mockResolvedValue([client({ id: 'client-z' })]);
      creditReportReminderService.findLoanIdsDueForNotice.mockResolvedValue([
        'loan-1',
      ]);
      creditReportReminderService.planForLoan.mockResolvedValue(planned);

      await service.runFamily(ReminderFamily.CreditReport, BrevoChannel.Sms);

      expect(brevoService.sendSms).not.toHaveBeenCalled();
    });
  });

  describe('retry', () => {
    const failed = (overrides: Partial<MessageLog>): MessageLog =>
      ({
        id: 'log-1',
        clientId: 'client-a',
        type: MessageType.SingleOverdueInstallment,
        channel: MessageChannel.Sms,
        phoneNumber: '+573002222222',
        email: null,
        status: MessageLogStatus.Failed,
        ...overrides,
      }) as MessageLog;

    it('resends an SMS to the same phone only', async () => {
      clientsRepository.findOneBy.mockResolvedValue(client());
      overdueReminderService.planReminderForClient.mockResolvedValue([plan()]);

      const logs = await service.retry(failed({}));

      expect(overdueReminderService.planReminderForClient).toHaveBeenCalledWith(
        'client-a',
        { allowEmpty: true, targetPhoneNumbers: ['+573002222222'] },
      );
      expect(brevoService.sendSms).toHaveBeenCalledTimes(1);
      expect(brevoService.sendSms).toHaveBeenCalledWith(
        expect.objectContaining({ to: '+573002222222' }),
      );
      expect(logs).toHaveLength(1);
    });

    it('resends a Datacrédito email only while it is still a notice day', async () => {
      clientsRepository.findOneBy.mockResolvedValue(client());
      messageLogItemsRepository.findOne.mockResolvedValue({
        installment: { loanId: 'loan-1' },
      });
      creditReportReminderService.planForLoan.mockResolvedValue({
        clientId: 'client-a',
        type: MessageType.CreditReport30Days,
        oldestInstallmentId: 'inst-30',
        plans: [plan({ type: MessageType.CreditReport30Days })],
      });

      await service.retry(
        failed({
          type: MessageType.CreditReport30Days,
          channel: MessageChannel.Email,
          phoneNumber: null,
          email: 'juana@example.com',
        }),
      );

      expect(creditReportReminderService.planForLoan).toHaveBeenCalledWith(
        'loan-1',
        { targetPhoneNumbers: undefined, throwIfNotDue: true },
      );
      expect(brevoService.sendEmail).toHaveBeenCalledTimes(1);
    });

    it('rejects a WhatsApp row and a type never sent by email/SMS', async () => {
      clientsRepository.findOneBy.mockResolvedValue(client());

      await expect(
        service.retry(failed({ channel: MessageChannel.WhatsApp })),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.retry(failed({ type: MessageType.PaymentConfirmation })),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
