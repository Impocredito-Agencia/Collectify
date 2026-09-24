import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { ClientCreditBalanceService } from '../clients/clientCreditBalance.service';
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
import { LoanInstallmentConcept } from '../loans/entities/loanInstallmentConcept.entity';
import { Payment } from '../loans/entities/payment.entity';

import { MessageLog, MessageLogStatus } from './entities/messageLog.entity';
import { MessageLogItem } from './entities/messageLogItem.entity';
import { MessageFrequencyThrottleService } from './messageFrequencyThrottle.service';
import { formatCurrency } from './messageRenderer';
import { GENERIC_TEMPLATE_CONTENT } from './templateBodyRenderer.testFixtures';
import { MessageTemplatesService } from './messageTemplates/messageTemplates.service';
import { MessageType } from './messageType.enum';
import { UPCOMING_FAMILY_TYPES } from './reminderFamily';
import { UpcomingDueReminderService } from './upcomingDueReminder.service';
import { WhatsAppService } from './whatsapp.service';

describe('UpcomingDueReminderService', () => {
  let service: UpcomingDueReminderService;
  let clientsRepository: { findOneBy: jest.Mock };
  let installmentsRepository: { find: jest.Mock };
  let paymentsRepository: { find: jest.Mock };
  let loanInstallmentConceptsRepository: { find: jest.Mock };
  let messageLogsRepository: { create: jest.Mock; save: jest.Mock };
  let messageLogItemsRepository: { create: jest.Mock; save: jest.Mock };
  let messageTemplatesService: { findByTypeOrThrow: jest.Mock };
  let messageFrequencyThrottleService: { filterOutThrottledClients: jest.Mock };
  let whatsAppService: { sendTemplateMessage: jest.Mock };
  let clientCreditBalanceService: { getBalance: jest.Mock };

  const mockClient: Client = {
    id: 'client-1',
    firstName: 'Maria',
    lastName: 'Muñoz',
    documentNumber: '1234567890',
    phoneNumber: '+573001234567',
    creditLimit: null,
    documentType: null,
    dateOfBirth: null,
    gender: null,
    documentIssuePlace: null,
    documentIssueDate: null,
    email: null,
    alternatePhoneNumber: null,
    mutedPhoneNumbers: [],
    homeAddress: null,
    workAddress: null,
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
    promissoryNoteNumber: '#1039',
    principalAmount: 900000,
    disbursedAt: '2024-01-01',
    installmentFrequency: InstallmentFrequency.Monthly,
    totalInstallments: 3,
    status: LoanStatus.Active,
    refinancedFromLoanId: null,
    refinancedFromLoan: null,
    description: null,
    newLoanMessageSentAt: null,
    isNewLoan: false,
    coDebtorClientId: null,
    coDebtorClient: null,
    coDebtorRelationship: null,
    alternateContactName: null,
    alternateContactPhoneNumber: null,
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

  function upcomingInstallment(
    overrides: Partial<Installment> = {},
  ): Installment {
    return {
      id: 'inst-1',
      loanId: mockLoan.id,
      loan: mockLoan,
      installmentNumber: 3,
      amount: 2052000,
      principalPortion: null,
      dueDate: daysFromNowDateString(5),
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
    // Bug fix, 2026-09-08 — see OverdueReminderService's identical mock
    // and its own comment.
    loanInstallmentConceptsRepository = {
      find: jest.fn().mockResolvedValue([]),
    };
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
        content: GENERIC_TEMPLATE_CONTENT,
      }),
    };
    messageFrequencyThrottleService = {
      filterOutThrottledClients: jest
        .fn()
        .mockImplementation((ids: string[]) => Promise.resolve(ids)),
    };
    whatsAppService = {
      sendTemplateMessage: jest
        .fn()
        .mockResolvedValue({ sent: true, whatsappMessageId: 'wamid.TEST' }),
    };
    // Default: no unclaimed credit — see OverdueReminderService's identical
    // mock and its own comment.
    clientCreditBalanceService = {
      getBalance: jest.fn().mockResolvedValue(0),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UpcomingDueReminderService,
        { provide: getRepositoryToken(Client), useValue: clientsRepository },
        {
          provide: getRepositoryToken(Installment),
          useValue: installmentsRepository,
        },
        { provide: getRepositoryToken(Payment), useValue: paymentsRepository },
        {
          provide: getRepositoryToken(LoanInstallmentConcept),
          useValue: loanInstallmentConceptsRepository,
        },
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
            get: jest.fn().mockReturnValue({ upcomingDueReminderDays: 5 }),
          },
        },
        {
          provide: ClientCreditBalanceService,
          useValue: clientCreditBalanceService,
        },
      ],
    }).compile();

    service = module.get<UpcomingDueReminderService>(
      UpcomingDueReminderService,
    );
    clientsRepository.findOneBy.mockResolvedValue(mockClient);
  });

  // installmentsRepository.find is called first for the upcoming query,
  // then for the overdue query — see UpcomingDueReminderService's
  // sendReminderForClient.
  function mockGathered(upcoming: Installment[], overdue: Installment[] = []) {
    installmentsRepository.find
      .mockResolvedValueOnce(upcoming)
      .mockResolvedValueOnce(overdue);
  }

  describe('sendReminderForClient', () => {
    it('sends SingleUpcomingInstallment for one upcoming installment', async () => {
      mockGathered([upcomingInstallment()]);

      const [result] = await service.sendReminderForClient(mockClient.id);

      expect(messageTemplatesService.findByTypeOrThrow).toHaveBeenCalledWith(
        MessageType.SingleUpcomingInstallment,
      );
      expect(result.status).toBe(MessageLogStatus.Sent);
    });

    it('sends MultipleUpcomingInstallments for more than one', async () => {
      mockGathered([
        upcomingInstallment({ id: 'inst-1' }),
        upcomingInstallment({
          id: 'inst-2',
          dueDate: daysFromNowDateString(1),
        }),
      ]);

      await service.sendReminderForClient(mockClient.id);

      expect(messageTemplatesService.findByTypeOrThrow).toHaveBeenCalledWith(
        MessageType.MultipleUpcomingInstallments,
      );
    });

    it('sends UpcomingAndOverdueMixed when the client also has an overdue installment', async () => {
      mockGathered(
        [upcomingInstallment()],
        [upcomingInstallment({ id: 'inst-2', dueDate: daysAgoDateString(3) })],
      );

      await service.sendReminderForClient(mockClient.id);

      expect(messageTemplatesService.findByTypeOrThrow).toHaveBeenCalledWith(
        MessageType.UpcomingAndOverdueMixed,
      );
    });

    // Human report, 2026-09-14 — see OverdueReminderService's identical
    // saldo a favor / priority-order / contact-group tests.
    it('includes the saldo a favor note when the client has an unclaimed credit and no saldo pendiente', async () => {
      mockGathered([upcomingInstallment()]);
      clientCreditBalanceService.getBalance.mockResolvedValue(45000);

      await service.sendReminderForClient(mockClient.id);

      expect(clientCreditBalanceService.getBalance).toHaveBeenCalledWith(
        mockClient.id,
      );
      const [, , , params] = whatsAppService.sendTemplateMessage.mock
        .calls[0] as [string, string, string, string[]];
      expect(params.at(-1)).toContain(
        `saldo a favor de $${formatCurrency(45000)}`,
      );
    });

    it('reports saldo pendiente instead of saldo a favor when both apply', async () => {
      mockGathered(
        [upcomingInstallment()],
        [upcomingInstallment({ id: 'inst-2', dueDate: daysAgoDateString(3) })],
      );
      paymentsRepository.find.mockResolvedValue([
        { installmentId: 'inst-2', amountPaid: 50000 },
      ]);
      clientCreditBalanceService.getBalance.mockResolvedValue(45000);

      await service.sendReminderForClient(mockClient.id);

      const [, , , params] = whatsAppService.sendTemplateMessage.mock
        .calls[0] as [string, string, string, string[]];
      expect(params.at(-1)).toContain('saldo pendiente');
      expect(params.at(-1)).not.toContain('saldo a favor');
    });

    it('never reports saldo a favor to a loan alternate contact', async () => {
      mockGathered([
        upcomingInstallment({
          loan: { ...mockLoan, alternateContactPhoneNumber: '+573009876543' },
        }),
      ]);
      clientCreditBalanceService.getBalance.mockResolvedValue(45000);

      await service.sendReminderForClient(mockClient.id);

      expect(clientCreditBalanceService.getBalance).not.toHaveBeenCalled();
      const [, , , params] = whatsAppService.sendTemplateMessage.mock
        .calls[0] as [string, string, string, string[]];
      expect(params.at(-1)).not.toContain('saldo a favor');
    });

    it('logs the message as failed when WhatsAppService could not send it', async () => {
      mockGathered([upcomingInstallment()]);
      whatsAppService.sendTemplateMessage.mockResolvedValue({
        sent: false,
        whatsappMessageId: null,
      });

      const [result] = await service.sendReminderForClient(mockClient.id);

      expect(result.status).toBe(MessageLogStatus.Failed);
    });

    it('throws NotFoundException when the client does not exist', async () => {
      clientsRepository.findOneBy.mockResolvedValue(null);

      await expect(service.sendReminderForClient('missing-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws BadRequestException when the client has no upcoming installments', async () => {
      mockGathered([]);

      await expect(
        service.sendReminderForClient(mockClient.id),
      ).rejects.toThrow(BadRequestException);
      expect(whatsAppService.sendTemplateMessage).not.toHaveBeenCalled();
    });

    it('sends the overdue-only template when allowEmpty is true and only overdue installments exist', async () => {
      mockGathered(
        [],
        [upcomingInstallment({ dueDate: daysAgoDateString(3) })],
      );

      const [result] = await service.sendReminderForClient(mockClient.id, {
        allowEmpty: true,
      });

      expect(messageTemplatesService.findByTypeOrThrow).toHaveBeenCalledWith(
        MessageType.SingleOverdueInstallment,
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

  describe('runDailyReminder', () => {
    // installmentsRepository.find is called twice: once for
    // findClientIdsWithUpcomingInstallments, then for
    // findClientIdsWithOverdueInstallments (the exclusion check, added
    // 2026-09-07 — see the service's own doc comment for why the daily job
    // now defers clients with an overdue installment to the weekly job).
    function mockDynamicClients(
      upcomingRows: Installment[],
      overdueRows: Installment[] = [],
    ) {
      installmentsRepository.find
        .mockResolvedValueOnce(upcomingRows)
        .mockResolvedValueOnce(overdueRows);
    }

    it('sends a reminder to every dynamically-upcoming client with no whitelist involved', async () => {
      mockDynamicClients([
        upcomingInstallment({ loan: { ...mockLoan, clientId: 'client-1' } }),
        upcomingInstallment({ loan: { ...mockLoan, clientId: 'client-2' } }),
      ]);
      const sendSpy = jest
        .spyOn(service, 'sendReminderForClient')
        .mockResolvedValue([{} as MessageLog]);

      await service.runDailyReminder();

      expect(sendSpy).toHaveBeenCalledWith('client-1');
      expect(sendSpy).toHaveBeenCalledWith('client-2');
    });

    it('excludes a client who also currently has an overdue installment — the weekly job covers them now', async () => {
      mockDynamicClients(
        [
          upcomingInstallment({ loan: { ...mockLoan, clientId: 'client-1' } }),
          upcomingInstallment({ loan: { ...mockLoan, clientId: 'client-2' } }),
        ],
        [upcomingInstallment({ loan: { ...mockLoan, clientId: 'client-2' } })],
      );
      const sendSpy = jest
        .spyOn(service, 'sendReminderForClient')
        .mockResolvedValue([{} as MessageLog]);

      await service.runDailyReminder();

      expect(sendSpy).toHaveBeenCalledWith('client-1');
      expect(sendSpy).not.toHaveBeenCalledWith('client-2');
    });

    it('passes the dynamically-upcoming client ids (minus the excluded ones) through the frequency throttle', async () => {
      mockDynamicClients([
        upcomingInstallment({ loan: { ...mockLoan, clientId: 'client-1' } }),
      ]);
      jest
        .spyOn(service, 'sendReminderForClient')
        .mockResolvedValue([{} as MessageLog]);

      await service.runDailyReminder();

      expect(
        messageFrequencyThrottleService.filterOutThrottledClients,
      ).toHaveBeenCalledWith(['client-1'], UPCOMING_FAMILY_TYPES);
    });

    it('only sends to the clients the frequency throttle actually returns', async () => {
      mockDynamicClients([
        upcomingInstallment({ loan: { ...mockLoan, clientId: 'client-1' } }),
        upcomingInstallment({ loan: { ...mockLoan, clientId: 'client-2' } }),
      ]);
      messageFrequencyThrottleService.filterOutThrottledClients.mockResolvedValue(
        ['client-1'],
      );
      const sendSpy = jest
        .spyOn(service, 'sendReminderForClient')
        .mockResolvedValue([{} as MessageLog]);

      await service.runDailyReminder();

      expect(sendSpy).toHaveBeenCalledTimes(1);
      expect(sendSpy).toHaveBeenCalledWith('client-1');
    });

    it('continues with the next client when one fails', async () => {
      mockDynamicClients([
        upcomingInstallment({ loan: { ...mockLoan, clientId: 'client-1' } }),
        upcomingInstallment({ loan: { ...mockLoan, clientId: 'client-2' } }),
      ]);
      const sendSpy = jest
        .spyOn(service, 'sendReminderForClient')
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce([{} as MessageLog]);

      await expect(service.runDailyReminder()).resolves.toBeUndefined();
      expect(sendSpy).toHaveBeenCalledTimes(2);
    });
  });
});
