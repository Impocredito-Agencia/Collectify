import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { Client } from '../clients/entities/client.entity';
import {
  Installment,
  InstallmentStatus,
} from '../loans/entities/installment.entity';
import {
  InstallmentFrequency,
  Loan,
  LoanStatus,
} from '../loans/entities/loan.entity';
import { Payment } from '../loans/entities/payment.entity';

import { MessageLog, MessageLogStatus } from './entities/messageLog.entity';
import { MessageLogItem } from './entities/messageLogItem.entity';
import { MessageFrequencyThrottleService } from './messageFrequencyThrottle.service';
import { MessageTemplatesService } from './messageTemplates/messageTemplates.service';
import { MessageType } from './messageType.enum';
import { OverdueReminderService } from './overdueReminder.service';
import { OVERDUE_FAMILY_TYPES } from './reminderFamily';
import { WhatsAppService } from './whatsapp.service';

describe('OverdueReminderService', () => {
  let service: OverdueReminderService;
  let clientsRepository: { findOneBy: jest.Mock };
  let installmentsRepository: { find: jest.Mock };
  let paymentsRepository: { find: jest.Mock };
  let messageLogsRepository: { create: jest.Mock; save: jest.Mock };
  let messageLogItemsRepository: { create: jest.Mock; save: jest.Mock };
  let messageTemplatesService: { findByTypeOrThrow: jest.Mock };
  let messageFrequencyThrottleService: { filterOutThrottledClients: jest.Mock };
  let whatsAppService: { sendTemplateMessage: jest.Mock };

  const mockClient: Client = {
    id: 'client-1',
    firstName: 'Juana',
    lastName: 'Pérez',
    documentNumber: '1234567890',
    phoneNumber: '+573001234567',
    creditLimit: null,
    documentType: null,
    dateOfBirth: null,
    documentIssuePlace: null,
    email: null,
    alternatePhoneNumber: null,
    homeAddress: null,
    workAddress: null,
    neighborhood: null,
    city: null,
    occupation: null,
    employerName: null,
    monthlyIncome: null,
    idDocumentFrontUrl: null,
    idDocumentBackUrl: null,
    selfieImageUrl: null,
    dataProcessingConsent: false,
    consentGivenAt: null,
    consentDocumentUrl: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };

  const mockLoan: Loan = {
    id: 'loan-1',
    clientId: mockClient.id,
    client: undefined as never,
    promissoryNoteNumber: '#743',
    principalAmount: 900000,
    interestRate: 6,
    disbursedAt: '2024-01-01',
    installmentFrequency: InstallmentFrequency.Monthly,
    totalInstallments: 3,
    status: LoanStatus.Active,
    refinancedFromLoanId: null,
    refinancedFromLoan: null,
    description: null,
    newLoanMessageSentAt: null,
    coDebtorClientId: null,
    coDebtorClient: null,
    coDebtorRelationship: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };

  function daysAgoDateString(days: number): string {
    const date = new Date();
    date.setDate(date.getDate() - days);
    return date.toISOString().slice(0, 10);
  }

  function daysFromNowDateString(days: number): string {
    return daysAgoDateString(-days);
  }

  function overdueInstallment(
    overrides: Partial<Installment> = {},
  ): Installment {
    return {
      id: 'inst-1',
      loanId: mockLoan.id,
      loan: mockLoan,
      installmentNumber: 1,
      amount: 210000,
      principalPortion: null,
      dueDate: '2024-01-01',
      status: InstallmentStatus.Pending,
      isDownPayment: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      ...overrides,
    };
  }

  beforeEach(async () => {
    clientsRepository = { findOneBy: jest.fn() };
    installmentsRepository = { find: jest.fn() };
    paymentsRepository = { find: jest.fn().mockResolvedValue([]) };
    messageLogsRepository = {
      create: jest.fn((dto: Partial<MessageLog>) => dto),
      save: jest.fn((log: Partial<MessageLog>) =>
        Promise.resolve({ id: 'log-1', ...log }),
      ),
    };
    messageLogItemsRepository = {
      create: jest.fn((dto: Partial<MessageLogItem>) => dto),
      save: jest.fn((items: unknown[]) => Promise.resolve(items)),
    };
    messageTemplatesService = {
      findByTypeOrThrow: jest.fn().mockResolvedValue({
        metaTemplateName: 'some_template',
        metaLanguageCode: 'es',
      }),
    };
    // Default: no throttling — passes every dynamically-qualifying client
    // straight through, matching "no whitelist entries" behavior.
    messageFrequencyThrottleService = {
      filterOutThrottledClients: jest
        .fn()
        .mockImplementation((ids: string[]) => Promise.resolve(ids)),
    };
    whatsAppService = {
      sendTemplateMessage: jest.fn().mockResolvedValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OverdueReminderService,
        { provide: getRepositoryToken(Client), useValue: clientsRepository },
        {
          provide: getRepositoryToken(Installment),
          useValue: installmentsRepository,
        },
        { provide: getRepositoryToken(Payment), useValue: paymentsRepository },
        {
          provide: getRepositoryToken(MessageLog),
          useValue: messageLogsRepository,
        },
        {
          provide: getRepositoryToken(MessageLogItem),
          useValue: messageLogItemsRepository,
        },
        { provide: MessageTemplatesService, useValue: messageTemplatesService },
        {
          provide: MessageFrequencyThrottleService,
          useValue: messageFrequencyThrottleService,
        },
        { provide: WhatsAppService, useValue: whatsAppService },
        {
          provide: ConfigService,
          useValue: {
            get: jest
              .fn()
              .mockReturnValue({ upcomingDueReminderDays: [5, 3, 1] }),
          },
        },
      ],
    }).compile();

    service = module.get<OverdueReminderService>(OverdueReminderService);
    clientsRepository.findOneBy.mockResolvedValue(mockClient);
  });

  // installmentsRepository.find is called first for the overdue query,
  // then for the upcoming query — see findOverdueInstallmentsForClient/
  // findUpcomingInstallmentsForClient in reminderInstallmentQueries.ts.
  function mockGathered(overdue: Installment[], upcoming: Installment[] = []) {
    installmentsRepository.find
      .mockResolvedValueOnce(overdue)
      .mockResolvedValueOnce(upcoming);
  }

  describe('sendReminderForClient', () => {
    it('sends SingleOverdueInstallment for one overdue installment within 8 days', async () => {
      mockGathered([overdueInstallment({ dueDate: daysAgoDateString(3) })]);

      const result = await service.sendReminderForClient(mockClient.id);

      expect(messageTemplatesService.findByTypeOrThrow).toHaveBeenCalledWith(
        MessageType.SingleOverdueInstallment,
      );
      expect(result.status).toBe(MessageLogStatus.Sent);
      expect(messageLogItemsRepository.save).toHaveBeenCalledWith([
        expect.objectContaining({
          messageLogId: 'log-1',
          installmentId: 'inst-1',
        }),
      ]);
    });

    it('sends MultipleOverdueInstallments across several loans', async () => {
      const otherLoan: Loan = {
        ...mockLoan,
        id: 'loan-2',
        promissoryNoteNumber: '#959',
      };
      mockGathered([
        overdueInstallment({ id: 'inst-1', loan: mockLoan }),
        overdueInstallment({ id: 'inst-2', loan: otherLoan }),
      ]);

      await service.sendReminderForClient(mockClient.id);

      expect(messageTemplatesService.findByTypeOrThrow).toHaveBeenCalledWith(
        MessageType.MultipleOverdueInstallments,
      );
    });

    it('sends UpcomingAndOverdueMixed when the client has both', async () => {
      mockGathered(
        [overdueInstallment()],
        [
          overdueInstallment({
            id: 'inst-2',
            dueDate: daysFromNowDateString(5),
          }),
        ],
      );

      await service.sendReminderForClient(mockClient.id);

      expect(messageTemplatesService.findByTypeOrThrow).toHaveBeenCalledWith(
        MessageType.UpcomingAndOverdueMixed,
      );
      expect(messageLogItemsRepository.save).toHaveBeenCalledWith([
        expect.objectContaining({ installmentId: 'inst-1' }),
        expect.objectContaining({ installmentId: 'inst-2' }),
      ]);
    });

    it('includes the saldo pendiente note when a partial payment exists on an overdue installment', async () => {
      mockGathered([overdueInstallment({ amount: 300000 })]);
      paymentsRepository.find.mockResolvedValue([
        { installmentId: 'inst-1', amountPaid: 100000 },
      ]);

      await service.sendReminderForClient(mockClient.id);

      const [, , , params] = whatsAppService.sendTemplateMessage.mock
        .calls[0] as [string, string, string, string[]];
      expect(params.at(-1)).toContain('saldo pendiente de $200.000');
    });

    it('logs the message as failed when WhatsAppService could not send it', async () => {
      mockGathered([overdueInstallment()]);
      whatsAppService.sendTemplateMessage.mockResolvedValue(false);

      const result = await service.sendReminderForClient(mockClient.id);

      expect(result.status).toBe(MessageLogStatus.Failed);
    });

    it('throws NotFoundException when the client does not exist', async () => {
      clientsRepository.findOneBy.mockResolvedValue(null);

      await expect(service.sendReminderForClient('missing-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws BadRequestException when the client has no overdue installments', async () => {
      mockGathered([]);

      await expect(
        service.sendReminderForClient(mockClient.id),
      ).rejects.toThrow(BadRequestException);
      expect(whatsAppService.sendTemplateMessage).not.toHaveBeenCalled();
    });

    it('sends the upcoming-only template when allowEmpty is true and only upcoming installments exist', async () => {
      mockGathered(
        [],
        [overdueInstallment({ dueDate: daysFromNowDateString(5) })],
      );

      const result = await service.sendReminderForClient(mockClient.id, {
        allowEmpty: true,
      });

      expect(messageTemplatesService.findByTypeOrThrow).toHaveBeenCalledWith(
        MessageType.SingleUpcomingInstallment,
      );
      expect(result.status).toBe(MessageLogStatus.Sent);
    });

    it('throws BadRequestException even with allowEmpty when there is nothing to report at all', async () => {
      mockGathered([], []);

      await expect(
        service.sendReminderForClient(mockClient.id, { allowEmpty: true }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('runWeeklyReminder', () => {
    // installmentsRepository.find is called for
    // findClientIdsWithOverdueInstallments, then for
    // findClientIdsWithUpcomingInstallments (the exclusion check).
    function mockDynamicClients(
      overdueRows: Installment[],
      upcomingRows: Installment[] = [],
    ) {
      installmentsRepository.find
        .mockResolvedValueOnce(overdueRows)
        .mockResolvedValueOnce(upcomingRows);
    }

    it('sends a reminder to every dynamically-overdue client with no whitelist involved', async () => {
      mockDynamicClients([
        overdueInstallment({ loan: { ...mockLoan, clientId: 'client-1' } }),
        overdueInstallment({ loan: { ...mockLoan, clientId: 'client-2' } }),
      ]);
      const sendSpy = jest
        .spyOn(service, 'sendReminderForClient')
        .mockResolvedValue({} as MessageLog);

      await service.runWeeklyReminder();

      expect(sendSpy).toHaveBeenCalledWith('client-1');
      expect(sendSpy).toHaveBeenCalledWith('client-2');
    });

    it('excludes a client who also currently has an upcoming installment — the daily job covers them', async () => {
      mockDynamicClients(
        [
          overdueInstallment({ loan: { ...mockLoan, clientId: 'client-1' } }),
          overdueInstallment({ loan: { ...mockLoan, clientId: 'client-2' } }),
        ],
        [overdueInstallment({ loan: { ...mockLoan, clientId: 'client-2' } })],
      );
      const sendSpy = jest
        .spyOn(service, 'sendReminderForClient')
        .mockResolvedValue({} as MessageLog);

      await service.runWeeklyReminder();

      expect(sendSpy).toHaveBeenCalledWith('client-1');
      expect(sendSpy).not.toHaveBeenCalledWith('client-2');
    });

    it('passes the dynamically-overdue client ids (minus the excluded ones) through the frequency throttle', async () => {
      mockDynamicClients([
        overdueInstallment({ loan: { ...mockLoan, clientId: 'client-1' } }),
        overdueInstallment({ loan: { ...mockLoan, clientId: 'client-2' } }),
      ]);
      jest
        .spyOn(service, 'sendReminderForClient')
        .mockResolvedValue({} as MessageLog);

      await service.runWeeklyReminder();

      expect(
        messageFrequencyThrottleService.filterOutThrottledClients,
      ).toHaveBeenCalledWith(['client-1', 'client-2'], OVERDUE_FAMILY_TYPES);
    });

    it('only sends to the clients the frequency throttle actually returns', async () => {
      mockDynamicClients([
        overdueInstallment({ loan: { ...mockLoan, clientId: 'client-1' } }),
        overdueInstallment({ loan: { ...mockLoan, clientId: 'client-2' } }),
      ]);
      messageFrequencyThrottleService.filterOutThrottledClients.mockResolvedValue(
        ['client-1'],
      );
      const sendSpy = jest
        .spyOn(service, 'sendReminderForClient')
        .mockResolvedValue({} as MessageLog);

      await service.runWeeklyReminder();

      expect(sendSpy).toHaveBeenCalledTimes(1);
      expect(sendSpy).toHaveBeenCalledWith('client-1');
    });

    it('continues with the next client when one fails', async () => {
      mockDynamicClients([
        overdueInstallment({ loan: { ...mockLoan, clientId: 'client-1' } }),
        overdueInstallment({ loan: { ...mockLoan, clientId: 'client-2' } }),
      ]);
      const sendSpy = jest
        .spyOn(service, 'sendReminderForClient')
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce({} as MessageLog);

      await expect(service.runWeeklyReminder()).resolves.toBeUndefined();
      expect(sendSpy).toHaveBeenCalledTimes(2);
    });
  });
});
