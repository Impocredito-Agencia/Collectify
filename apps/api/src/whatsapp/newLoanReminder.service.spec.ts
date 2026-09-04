import { NotFoundException } from '@nestjs/common';
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
      whatsAppService.sendTemplateMessage.mockResolvedValue(true);
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
      whatsAppService.sendTemplateMessage.mockResolvedValue(false);

      const result = await service.sendNewLoanMessage('loan-1');

      expect(result.status).toBe(MessageLogStatus.Failed);
    });

    it('throws NotFoundException when the loan does not exist', async () => {
      loansRepository.findOne.mockResolvedValue(null);

      await expect(service.sendNewLoanMessage('missing-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
