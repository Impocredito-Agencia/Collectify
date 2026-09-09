import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { IsNull } from 'typeorm';

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

import { MessageLog, MessageLogStatus } from './entities/messageLog.entity';
import { MessageLogItem } from './entities/messageLogItem.entity';
import { MessageTemplatesService } from './messageTemplates/messageTemplates.service';
import { MessageType } from './messageType.enum';
import { NewLoanReminderService } from './newLoanReminder.service';
import { WhatsAppService } from './whatsapp.service';

describe('NewLoanReminderService', () => {
  let service: NewLoanReminderService;
  let loansRepository: {
    findOne: jest.Mock;
    find: jest.Mock;
    update: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let installmentsRepository: { find: jest.Mock };
  let messageLogsRepository: { create: jest.Mock; save: jest.Mock };
  let messageLogItemsRepository: { create: jest.Mock; save: jest.Mock };
  let messageTemplatesService: { findByTypeOrThrow: jest.Mock };
  let whatsAppService: { sendTemplateMessage: jest.Mock };
  let otherLoanCount: number;

  const mockClient: Client = {
    id: 'client-1',
    firstName: 'David',
    lastName: 'Ordoñez',
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

  function loan(overrides: Partial<Loan> = {}): Loan {
    return {
      id: 'loan-1',
      clientId: mockClient.id,
      client: mockClient,
      promissoryNoteNumber: '1093',
      principalAmount: 4308000,
      interestRate: 6,
      disbursedAt: '2026-05-20',
      installmentFrequency: InstallmentFrequency.Monthly,
      totalInstallments: 12,
      status: LoanStatus.Active,
      refinancedFromLoanId: null,
      refinancedFromLoan: null,
      description: 'Compra de Apple MacBook Air M5',
      isNewLoan: false,
      coDebtorClientId: null,
      coDebtorClient: null,
      coDebtorRelationship: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      ...overrides,
    } as Loan;
  }

  function installment(overrides: Partial<Installment> = {}): Installment {
    return {
      id: 'inst-1',
      loanId: 'loan-1',
      loan: loan(),
      installmentNumber: 1,
      amount: 359000,
      principalPortion: null,
      dueDate: '2026-06-20',
      status: InstallmentStatus.Pending,
      isDownPayment: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      ...overrides,
    };
  }

  beforeEach(async () => {
    otherLoanCount = 0;
    loansRepository = {
      findOne: jest.fn(),
      find: jest.fn(),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      createQueryBuilder: jest.fn(() => ({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getCount: jest.fn(() => Promise.resolve(otherLoanCount)),
      })),
    };
    installmentsRepository = { find: jest.fn() };
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
    messageTemplatesService = { findByTypeOrThrow: jest.fn() };
    whatsAppService = { sendTemplateMessage: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NewLoanReminderService,
        { provide: getRepositoryToken(Loan), useValue: loansRepository },
        {
          provide: getRepositoryToken(Installment),
          useValue: installmentsRepository,
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
        { provide: WhatsAppService, useValue: whatsAppService },
      ],
    }).compile();

    service = module.get<NewLoanReminderService>(NewLoanReminderService);
  });

  describe('sendNewLoanMessage', () => {
    beforeEach(() => {
      installmentsRepository.find.mockResolvedValue([
        installment({ id: 'inst-1', installmentNumber: 1 }),
        installment({ id: 'inst-2', installmentNumber: 2 }),
      ]);
      messageTemplatesService.findByTypeOrThrow.mockResolvedValue({
        metaTemplateName: 'some_template',
        metaLanguageCode: 'es',
      });
      whatsAppService.sendTemplateMessage.mockResolvedValue({
        sent: true,
        whatsappMessageId: 'wamid.TEST',
      });
    });

    it('sends NewLoanNewClient when the client has no other loan', async () => {
      loansRepository.findOne.mockResolvedValue(loan());
      otherLoanCount = 0;

      const result = await service.sendNewLoanMessage('loan-1');

      expect(messageTemplatesService.findByTypeOrThrow).toHaveBeenCalledWith(
        MessageType.NewLoanNewClient,
      );
      expect(result.status).toBe(MessageLogStatus.Sent);
    });

    it('sends NewLoanExistingClient when the client already has another loan', async () => {
      loansRepository.findOne.mockResolvedValue(loan());
      otherLoanCount = 1;

      await service.sendNewLoanMessage('loan-1');

      expect(messageTemplatesService.findByTypeOrThrow).toHaveBeenCalledWith(
        MessageType.NewLoanExistingClient,
      );
    });

    it('sends NewLoanNewClientInitialInstallment when there is a cuota inicial', async () => {
      loansRepository.findOne.mockResolvedValue(loan());
      installmentsRepository.find.mockResolvedValue([
        installment({
          id: 'inst-1',
          installmentNumber: 1,
          amount: 1400000,
          isDownPayment: true,
        }),
        installment({ id: 'inst-2', installmentNumber: 2 }),
      ]);
      otherLoanCount = 0;

      await service.sendNewLoanMessage('loan-1');

      expect(messageTemplatesService.findByTypeOrThrow).toHaveBeenCalledWith(
        MessageType.NewLoanNewClientInitialInstallment,
      );
    });

    it('sends RefinanceSingleLoan when the loan came from a refinance', async () => {
      const originalLoan = loan({
        id: 'old-loan',
        promissoryNoteNumber: '1029',
      });
      loansRepository.findOne.mockResolvedValue(
        loan({
          refinancedFromLoanId: 'old-loan',
          refinancedFromLoan: originalLoan,
        }),
      );

      await service.sendNewLoanMessage('loan-1');

      expect(messageTemplatesService.findByTypeOrThrow).toHaveBeenCalledWith(
        MessageType.RefinanceSingleLoan,
      );
      expect(whatsAppService.sendTemplateMessage).toHaveBeenCalledWith(
        mockClient.phoneNumber,
        'some_template',
        'es',
        expect.arrayContaining(['1029']),
      );
    });

    it('logs the message as failed when WhatsAppService could not send it', async () => {
      loansRepository.findOne.mockResolvedValue(loan());
      whatsAppService.sendTemplateMessage.mockResolvedValue({
        sent: false,
        whatsappMessageId: null,
      });

      const result = await service.sendNewLoanMessage('loan-1');

      expect(result.status).toBe(MessageLogStatus.Failed);
    });

    it('throws NotFoundException when the loan does not exist', async () => {
      loansRepository.findOne.mockResolvedValue(null);

      await expect(service.sendNewLoanMessage('missing-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    // Redesign, 2026-09-06 — marking newLoanMessageSentAt lives here now
    // (not in a caller-side wrapper), so a manual POST /message-logs/:id/retry
    // and the scheduled sweep are both safe to call without double-sending.
    it('marks newLoanMessageSentAt on the loan when the send succeeds', async () => {
      loansRepository.findOne.mockResolvedValue(loan());

      await service.sendNewLoanMessage('loan-1');

      expect(loansRepository.update).toHaveBeenCalledWith(
        { id: 'loan-1' },
        { newLoanMessageSentAt: expect.any(Date) as unknown },
      );
    });

    it('does not mark newLoanMessageSentAt when the send fails', async () => {
      loansRepository.findOne.mockResolvedValue(loan());
      whatsAppService.sendTemplateMessage.mockResolvedValue({
        sent: false,
        whatsappMessageId: null,
      });

      await service.sendNewLoanMessage('loan-1');

      expect(loansRepository.update).not.toHaveBeenCalled();
    });
  });

  describe('runPendingLoanNotifications', () => {
    beforeEach(() => {
      installmentsRepository.find.mockResolvedValue([
        installment({ id: 'inst-1', installmentNumber: 1 }),
      ]);
      messageTemplatesService.findByTypeOrThrow.mockResolvedValue({
        metaTemplateName: 'some_template',
        metaLanguageCode: 'es',
      });
    });

    it('queries only loans flagged isNewLoan with no message sent yet', async () => {
      loansRepository.find.mockResolvedValue([]);

      await service.runPendingLoanNotifications();

      expect(loansRepository.find).toHaveBeenCalledWith({
        where: { isNewLoan: true, newLoanMessageSentAt: IsNull() },
      });
    });

    it('sends the message for every pending loan found', async () => {
      loansRepository.find.mockResolvedValue([
        loan({ id: 'loan-1' }),
        loan({ id: 'loan-2' }),
      ]);
      loansRepository.findOne.mockImplementation(
        (options: { where: { id: string } }) =>
          Promise.resolve(loan({ id: options.where.id })),
      );
      whatsAppService.sendTemplateMessage.mockResolvedValue({
        sent: true,
        whatsappMessageId: 'wamid.TEST',
      });

      await service.runPendingLoanNotifications();

      expect(whatsAppService.sendTemplateMessage).toHaveBeenCalledTimes(2);
      expect(loansRepository.update).toHaveBeenCalledWith(
        { id: 'loan-1' },
        { newLoanMessageSentAt: expect.any(Date) as unknown },
      );
      expect(loansRepository.update).toHaveBeenCalledWith(
        { id: 'loan-2' },
        { newLoanMessageSentAt: expect.any(Date) as unknown },
      );
    });

    it("one loan's failure does not stop the rest of the batch", async () => {
      loansRepository.find.mockResolvedValue([
        loan({ id: 'loan-1' }),
        loan({ id: 'loan-2' }),
      ]);
      loansRepository.findOne.mockImplementation(
        (options: { where: { id: string } }) =>
          options.where.id === 'loan-1'
            ? Promise.resolve(null) // sendNewLoanMessage throws NotFoundException
            : Promise.resolve(loan({ id: options.where.id })),
      );
      whatsAppService.sendTemplateMessage.mockResolvedValue({
        sent: true,
        whatsappMessageId: 'wamid.TEST',
      });

      await service.runPendingLoanNotifications();

      expect(loansRepository.update).toHaveBeenCalledWith(
        { id: 'loan-2' },
        { newLoanMessageSentAt: expect.any(Date) as unknown },
      );
      expect(loansRepository.update).toHaveBeenCalledTimes(1);
    });
  });
});
