import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { ClientCreditBalanceService } from '../clients/clientCreditBalance.service';
import { Client } from '../clients/entities/client.entity';
import {
  ConceptCalculationType,
  ConceptCategory,
} from '../interestConceptTypes/entities/interestConceptType.entity';
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
import { enrichInstallment } from '../loans/installments/enrichInstallment';

import { MessageLog, MessageLogStatus } from './entities/messageLog.entity';
import { MessageLogItem } from './entities/messageLogItem.entity';
import { formatCurrency } from './messageRenderer';
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
  let loanInstallmentConceptsRepository: { find: jest.Mock };
  let messageLogsRepository: { create: jest.Mock; save: jest.Mock };
  let messageLogItemsRepository: { create: jest.Mock; save: jest.Mock };
  let messageTemplatesService: { findByTypeOrThrow: jest.Mock };
  let messageFrequencyThrottleService: { filterOutThrottledClients: jest.Mock };
  let whatsAppService: { sendTemplateMessage: jest.Mock };
  let clientCreditBalanceService: { getBalance: jest.Mock };

  const mockClient: Client = {
    id: 'client-1',
    firstName: 'Juana',
    lastName: 'Pérez',
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
    promissoryNoteNumber: '#743',
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
    // Bug fix, 2026-09-08 — defaults to no concepts assigned, so
    // findOverdueInstallmentsForClient's new findConceptsByInstallmentId
    // call has something iterable rather than undefined in every existing
    // test that doesn't care about moratory-concept scenarios. Tests that
    // DO care override this per-case, same convention as
    // paymentsRepository above.
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
      sendTemplateMessage: jest
        .fn()
        .mockResolvedValue({ sent: true, whatsappMessageId: 'wamid.TEST' }),
    };
    // Default: no unclaimed credit — most tests don't care about saldo a
    // favor, same "defaults to the non-triggering case" convention as
    // paymentsRepository above.
    clientCreditBalanceService = {
      getBalance: jest.fn().mockResolvedValue(0),
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
    // Human report, 2026-09-19 — a client with an alternatePhoneNumber on
    // file gets the reminder sent to both numbers, each logged as its own
    // MessageLog row (never one row covering two sends — see
    // getRecipientPhoneNumbers/MessageLogsService.retry's own comment on
    // why retrying must be able to target just one number specifically).
    it('sends to both numbers and logs one MessageLog per number when an alternate is on file', async () => {
      clientsRepository.findOneBy.mockResolvedValue({
        ...mockClient,
        alternatePhoneNumber: '+573009876543',
      });
      mockGathered([overdueInstallment({ dueDate: daysAgoDateString(3) })]);

      const result = await service.sendReminderForClient(mockClient.id);

      expect(result).toHaveLength(2);
      expect(whatsAppService.sendTemplateMessage).toHaveBeenCalledWith(
        '+573001234567',
        expect.any(String),
        expect.any(String),
        expect.any(Array),
      );
      expect(whatsAppService.sendTemplateMessage).toHaveBeenCalledWith(
        '+573009876543',
        expect.any(String),
        expect.any(String),
        expect.any(Array),
      );
      expect(messageLogsRepository.save).toHaveBeenCalledTimes(2);
    });

    // Human report, 2026-09-19 — confirmed with the human: a client with
    // one normal loan and one loan carrying an alternate contact gets TWO
    // separate messages — their own, scoped to only the normal loan, and
    // the contact's, scoped to only the override loan. Neither message
    // mentions the other loan's installments.
    it('splits into a client message and a contact message when one loan has an alternate contact', async () => {
      const contactLoan: Loan = {
        ...mockLoan,
        id: 'loan-2',
        alternateContactPhoneNumber: '+573009876543',
      };
      mockGathered([
        overdueInstallment({
          id: 'inst-normal',
          dueDate: daysAgoDateString(3),
        }),
        overdueInstallment({
          id: 'inst-contact',
          loanId: contactLoan.id,
          loan: contactLoan,
          dueDate: daysAgoDateString(3),
        }),
      ]);

      const result = await service.sendReminderForClient(mockClient.id);

      expect(result).toHaveLength(2);
      expect(whatsAppService.sendTemplateMessage).toHaveBeenCalledWith(
        mockClient.phoneNumber,
        expect.any(String),
        expect.any(String),
        expect.any(Array),
      );
      expect(whatsAppService.sendTemplateMessage).toHaveBeenCalledWith(
        '+573009876543',
        expect.any(String),
        expect.any(String),
        expect.any(Array),
      );
      // Each message's items list only its OWN loan's installment — never
      // both — proving the two loans' installments were never merged into
      // one message.
      expect(messageLogItemsRepository.save).toHaveBeenCalledWith([
        expect.objectContaining({ installmentId: 'inst-normal' }),
      ]);
      expect(messageLogItemsRepository.save).toHaveBeenCalledWith([
        expect.objectContaining({ installmentId: 'inst-contact' }),
      ]);
      expect(messageLogItemsRepository.save).not.toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ installmentId: 'inst-normal' }),
          expect.objectContaining({ installmentId: 'inst-contact' }),
        ]),
      );
    });

    it('sends SingleOverdueInstallment for one overdue installment within 8 days', async () => {
      mockGathered([overdueInstallment({ dueDate: daysAgoDateString(3) })]);

      const [result] = await service.sendReminderForClient(mockClient.id);

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

    // Bug fix, 2026-09-08 — this note used to report only the unpaid slice
    // of capital (amount - paid), silently ignoring accrued mora on an
    // overdue installment. It now reports the real remaining balance —
    // computed here via the same enrichInstallment() the service itself
    // uses, rather than a hand-derived figure, so the assertion doesn't
    // drift as "today" (and this fixture's accrued mora) advances.
    it('includes the saldo pendiente note, factoring in accrued mora, when a partial payment exists on an overdue installment', async () => {
      const installment = overdueInstallment({ amount: 300000 });
      mockGathered([installment]);
      paymentsRepository.find.mockResolvedValue([
        { installmentId: 'inst-1', amountPaid: 100000 },
      ]);
      const concepts = [
        {
          installmentId: installment.id,
          category: ConceptCategory.Moratorio,
          calculationType: ConceptCalculationType.Percentage,
          nameSnapshot: 'Intereses moratorios',
          value: 6,
        } as never,
      ];
      loanInstallmentConceptsRepository.find.mockResolvedValue(concepts);

      await service.sendReminderForClient(mockClient.id);

      const expectedRemaining = enrichInstallment(
        installment,
        concepts,
        100000,
      ).totalDue;
      // Sanity check the fix actually matters for this fixture — it's been
      // overdue since 2024-01-01, so real accrued mora should push the
      // balance well past the old, mora-blind figure of 200000
      // (300000 - 100000).
      expect(expectedRemaining).toBeGreaterThan(200000);

      const [, , , params] = whatsAppService.sendTemplateMessage.mock
        .calls[0] as [string, string, string, string[]];
      expect(params.at(-1)).toContain(
        `saldo pendiente de $${formatCurrency(expectedRemaining)}`,
      );
    });

    // Human report, 2026-09-14 — once saldo pendiente comes back empty, an
    // unclaimed saldo a favor (ClientCreditBalanceService's ledger) is now
    // reported instead.
    it('includes the saldo a favor note when the client has an unclaimed credit and no saldo pendiente', async () => {
      mockGathered([overdueInstallment()]);
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

    // Priority confirmed with the human, 2026-09-14: a client with BOTH a
    // pendiente gap and an unclaimed favor balance at once sees the
    // pendiente note — the more urgent of the two.
    it('reports saldo pendiente instead of saldo a favor when both apply', async () => {
      const installment = overdueInstallment({ amount: 300000 });
      mockGathered([installment]);
      paymentsRepository.find.mockResolvedValue([
        { installmentId: 'inst-1', amountPaid: 100000 },
      ]);
      clientCreditBalanceService.getBalance.mockResolvedValue(45000);

      await service.sendReminderForClient(mockClient.id);

      const [, , , params] = whatsAppService.sendTemplateMessage.mock
        .calls[0] as [string, string, string, string[]];
      expect(params.at(-1)).toContain('saldo pendiente');
      expect(params.at(-1)).not.toContain('saldo a favor');
    });

    // Confirmed with the human, 2026-09-14 — the ledger balance is
    // client-wide, but a loan's alternate contact is scoped to just that
    // one loan, so it must never learn about credit the client may have
    // earned on a different loan of theirs.
    it('never reports saldo a favor to a loan alternate contact', async () => {
      mockGathered([
        overdueInstallment({
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

    // Bug fix, 2026-09-08 — findOverdueInstallmentsForClient used to pass
    // `[]` straight to enrichInstallment, silently reporting ZERO accrued
    // mora for an overdue installment with real moratory concepts assigned
    // — this reminder's own interestSnapshot would have been 0 regardless
    // of how overdue the cuota was.
    it("uses the installment's real moratory concepts", async () => {
      const installment = overdueInstallment({ amount: 300000 });
      mockGathered([installment]);
      const concepts = [
        {
          installmentId: installment.id,
          category: ConceptCategory.Moratorio,
          calculationType: ConceptCalculationType.Percentage,
          nameSnapshot: 'Intereses moratorios',
          value: 3,
        } as never,
      ];
      loanInstallmentConceptsRepository.find.mockResolvedValue(concepts);

      await service.sendReminderForClient(mockClient.id);

      const expectedInterest = enrichInstallment(
        installment,
        concepts,
        0,
      ).interest;
      // Without concepts (the bug) this would be exactly 0.
      expect(expectedInterest).toBeGreaterThan(0);
      expect(messageLogItemsRepository.save).toHaveBeenCalledWith([
        expect.objectContaining({ interestSnapshot: expectedInterest }),
      ]);
    });

    it('logs the message as failed when WhatsAppService could not send it', async () => {
      mockGathered([overdueInstallment()]);
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

      const [result] = await service.sendReminderForClient(mockClient.id, {
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
    // installmentsRepository.find is called once, for
    // findClientIdsWithOverdueInstallments. Reversed 2026-09-07 (human,
    // see the service's own doc comment): the weekly job no longer
    // cross-checks upcoming installments to exclude anyone — it now owns
    // the mixed picture, so every dynamically-overdue client goes through,
    // upcoming installments or not.
    function mockDynamicClients(overdueRows: Installment[]) {
      installmentsRepository.find.mockResolvedValueOnce(overdueRows);
    }

    it('sends a reminder to every dynamically-overdue client with no whitelist involved', async () => {
      mockDynamicClients([
        overdueInstallment({ loan: { ...mockLoan, clientId: 'client-1' } }),
        overdueInstallment({ loan: { ...mockLoan, clientId: 'client-2' } }),
      ]);
      const sendSpy = jest
        .spyOn(service, 'sendReminderForClient')
        .mockResolvedValue([{} as MessageLog]);

      await service.runWeeklyReminder();

      expect(sendSpy).toHaveBeenCalledWith('client-1');
      expect(sendSpy).toHaveBeenCalledWith('client-2');
    });

    it('no longer excludes a client who also currently has an upcoming installment — this job now owns the mixed picture', async () => {
      mockDynamicClients([
        overdueInstallment({ loan: { ...mockLoan, clientId: 'client-1' } }),
        overdueInstallment({ loan: { ...mockLoan, clientId: 'client-2' } }),
      ]);
      const sendSpy = jest
        .spyOn(service, 'sendReminderForClient')
        .mockResolvedValue([{} as MessageLog]);

      await service.runWeeklyReminder();

      expect(sendSpy).toHaveBeenCalledWith('client-1');
      expect(sendSpy).toHaveBeenCalledWith('client-2');
      expect(installmentsRepository.find).toHaveBeenCalledTimes(1);
    });

    it('passes the dynamically-overdue client ids through the frequency throttle', async () => {
      mockDynamicClients([
        overdueInstallment({ loan: { ...mockLoan, clientId: 'client-1' } }),
        overdueInstallment({ loan: { ...mockLoan, clientId: 'client-2' } }),
      ]);
      jest
        .spyOn(service, 'sendReminderForClient')
        .mockResolvedValue([{} as MessageLog]);

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
        .mockResolvedValue([{} as MessageLog]);

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
        .mockResolvedValueOnce([{} as MessageLog]);

      await expect(service.runWeeklyReminder()).resolves.toBeUndefined();
      expect(sendSpy).toHaveBeenCalledTimes(2);
    });
  });
});
