import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import {
  ConceptCalculationType,
  ConceptCategory,
} from '../interestConceptTypes/entities/interestConceptType.entity';
import { Installment } from '../loans/entities/installment.entity';
import { Loan } from '../loans/entities/loan.entity';
import { LoanInstallmentConcept } from '../loans/entities/loanInstallmentConcept.entity';
import { Payment } from '../loans/entities/payment.entity';

import { MessageLog, MessageLogStatus } from './entities/messageLog.entity';
import { MessageLogItem } from './entities/messageLogItem.entity';
import { MessageTemplatesService } from './messageTemplates/messageTemplates.service';
import { MessageType } from './messageType.enum';
import { PaymentConfirmationService } from './paymentConfirmation.service';
import { WhatsAppService } from './whatsapp.service';

describe('PaymentConfirmationService', () => {
  let service: PaymentConfirmationService;
  let installmentsRepository: {
    findOne: jest.Mock;
    find: jest.Mock;
    count: jest.Mock;
  };
  let loansRepository: { findOne: jest.Mock };
  let paymentsRepository: { find: jest.Mock };
  let messageLogsRepository: { create: jest.Mock; save: jest.Mock };
  let messageLogItemsRepository: { create: jest.Mock; save: jest.Mock };
  let loanInstallmentConceptsRepository: { find: jest.Mock };
  let messageTemplatesService: { findByTypeOrThrow: jest.Mock };
  let whatsAppService: { sendTemplateMessage: jest.Mock };
  let configService: { get: jest.Mock };

  const client = {
    id: 'client-1',
    firstName: 'Angela',
    lastName: 'Fajardo',
    phoneNumber: '+573001234567',
  };
  const loan = {
    id: 'loan-1',
    clientId: 'client-1',
    client,
    promissoryNoteNumber: '778',
  };
  // Far enough in the future that calculateOverdueDays always resolves to 0
  // regardless of when the test suite runs — the "no mora accrued" baseline
  // most of these tests assume.
  const notYetDueDate = '2099-01-01';

  beforeEach(async () => {
    installmentsRepository = {
      findOne: jest.fn(),
      find: jest.fn(),
      count: jest.fn(),
    };
    loansRepository = { findOne: jest.fn() };
    paymentsRepository = { find: jest.fn() };
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
    loanInstallmentConceptsRepository = {
      find: jest.fn().mockResolvedValue([]),
    };
    messageTemplatesService = { findByTypeOrThrow: jest.fn() };
    whatsAppService = { sendTemplateMessage: jest.fn() };
    configService = {
      get: jest.fn().mockReturnValue({ paymentConfirmationPaused: false }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentConfirmationService,
        {
          provide: getRepositoryToken(Installment),
          useValue: installmentsRepository,
        },
        { provide: getRepositoryToken(Loan), useValue: loansRepository },
        { provide: getRepositoryToken(Payment), useValue: paymentsRepository },
        {
          provide: getRepositoryToken(MessageLog),
          useValue: messageLogsRepository,
        },
        {
          provide: getRepositoryToken(MessageLogItem),
          useValue: messageLogItemsRepository,
        },
        {
          provide: getRepositoryToken(LoanInstallmentConcept),
          useValue: loanInstallmentConceptsRepository,
        },
        { provide: MessageTemplatesService, useValue: messageTemplatesService },
        { provide: WhatsAppService, useValue: whatsAppService },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get(PaymentConfirmationService);

    messageTemplatesService.findByTypeOrThrow.mockResolvedValue({
      metaTemplateName: 'confirmacion_pago',
      metaLanguageCode: 'es',
    });
    whatsAppService.sendTemplateMessage.mockResolvedValue({
      sent: true,
      whatsappMessageId: 'wamid.TEST',
    });
  });

  describe('sendPaymentConfirmation', () => {
    it('sends PaymentConfirmation with the remaining installment count', async () => {
      installmentsRepository.findOne.mockResolvedValue({
        id: 'inst-1',
        loanId: 'loan-1',
        loan,
        installmentNumber: 14,
        amount: 300000,
        dueDate: notYetDueDate,
      });
      installmentsRepository.count.mockResolvedValue(4);
      paymentsRepository.find.mockResolvedValue([
        { installmentId: 'inst-1', amountPaid: 300000 },
      ]);

      const result = await service.sendPaymentConfirmation('inst-1');

      expect(messageTemplatesService.findByTypeOrThrow).toHaveBeenCalledWith(
        MessageType.PaymentConfirmation,
      );
      expect(result?.status).toBe(MessageLogStatus.Sent);
    });

    it('reports an overpayment as saldo a favor', async () => {
      installmentsRepository.findOne.mockResolvedValue({
        id: 'inst-1',
        loanId: 'loan-1',
        loan,
        installmentNumber: 14,
        amount: 300000,
        dueDate: notYetDueDate,
      });
      installmentsRepository.count.mockResolvedValue(0);
      paymentsRepository.find.mockResolvedValue([
        { installmentId: 'inst-1', amountPaid: 320000 },
      ]);

      await service.sendPaymentConfirmation('inst-1');

      const [, , , params] = whatsAppService.sendTemplateMessage.mock
        .calls[0] as [string, string, string, string[]];
      expect(params.at(-1)).toContain('saldo a favor de $20.000');
    });

    // Bug fix, 2026-09-08 (human report) — a cuota that was overdue and
    // required paying capital + accrued mora to close (per the same-day
    // closing-rule fix) had that mora misreported as "saldo a favor" once
    // the payment cleared, since overpayment used to be derived from
    // `amountPaid - installment.amount` alone. Real numbers from the report:
    // a $205.000 cuota with $119.584 of accrued mora, paid in full for
    // $324.584 — must NOT be reported as an overpayment.
    it('does not report accrued mora paid off as saldo a favor', async () => {
      installmentsRepository.findOne.mockResolvedValue({
        id: 'inst-1',
        loanId: 'loan-1',
        loan,
        installmentNumber: 1,
        amount: 205000,
        dueDate: '2020-01-01',
      });
      installmentsRepository.count.mockResolvedValue(11);
      paymentsRepository.find.mockResolvedValue([
        { installmentId: 'inst-1', amountPaid: 324584 },
      ]);
      loanInstallmentConceptsRepository.find.mockResolvedValue([
        {
          installmentId: 'inst-1',
          nameSnapshot: 'Intereses moratorios',
          category: ConceptCategory.Moratorio,
          calculationType: ConceptCalculationType.FixedAmount,
          value: 119584,
        },
      ]);

      await service.sendPaymentConfirmation('inst-1');

      const [, , , params] = whatsAppService.sendTemplateMessage.mock
        .calls[0] as [string, string, string, string[]];
      expect(params.at(-1)).not.toContain('saldo a favor');
    });

    it('throws NotFoundException when the installment does not exist', async () => {
      installmentsRepository.findOne.mockResolvedValue(null);

      await expect(service.sendPaymentConfirmation('missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    // Human report, 2026-09-11 — see WhatsappConfig.paymentConfirmationPaused.
    it('returns null and never touches the DB or WhatsAppService when paused', async () => {
      configService.get.mockReturnValue({ paymentConfirmationPaused: true });

      const result = await service.sendPaymentConfirmation('inst-1');

      expect(result).toBeNull();
      expect(installmentsRepository.findOne).not.toHaveBeenCalled();
      expect(whatsAppService.sendTemplateMessage).not.toHaveBeenCalled();
      expect(messageLogsRepository.save).not.toHaveBeenCalled();
    });

    // Human report, 2026-09-19 — a payment sourced from a real WhatsApp
    // comprobante always sends, regardless of the flag.
    it('sends anyway when paused but bypassPause is set', async () => {
      configService.get.mockReturnValue({ paymentConfirmationPaused: true });
      installmentsRepository.findOne.mockResolvedValue({
        id: 'inst-1',
        loanId: 'loan-1',
        loan,
        installmentNumber: 14,
        amount: 300000,
        dueDate: notYetDueDate,
      });
      installmentsRepository.count.mockResolvedValue(4);
      paymentsRepository.find.mockResolvedValue([
        { installmentId: 'inst-1', amountPaid: 300000 },
      ]);

      const result = await service.sendPaymentConfirmation('inst-1', {
        bypassPause: true,
      });

      expect(result?.status).toBe(MessageLogStatus.Sent);
      expect(whatsAppService.sendTemplateMessage).toHaveBeenCalled();
    });
  });

  describe('sendPaidInFull', () => {
    it('sends PaidInFull for the loan', async () => {
      loansRepository.findOne.mockResolvedValue(loan);
      installmentsRepository.find.mockResolvedValue([
        { id: 'inst-1', amount: 300000, dueDate: notYetDueDate },
        { id: 'inst-2', amount: 300000, dueDate: notYetDueDate },
      ]);
      paymentsRepository.find.mockResolvedValue([
        { installmentId: 'inst-1', amountPaid: 300000 },
        { installmentId: 'inst-2', amountPaid: 300000 },
      ]);

      const result = await service.sendPaidInFull('loan-1');

      expect(messageTemplatesService.findByTypeOrThrow).toHaveBeenCalledWith(
        MessageType.PaidInFull,
      );
      expect(result?.status).toBe(MessageLogStatus.Sent);
    });

    it('throws NotFoundException when the loan does not exist', async () => {
      loansRepository.findOne.mockResolvedValue(null);

      await expect(service.sendPaidInFull('missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns null and never touches the DB or WhatsAppService when paused', async () => {
      configService.get.mockReturnValue({ paymentConfirmationPaused: true });

      const result = await service.sendPaidInFull('loan-1');

      expect(result).toBeNull();
      expect(loansRepository.findOne).not.toHaveBeenCalled();
      expect(whatsAppService.sendTemplateMessage).not.toHaveBeenCalled();
      expect(messageLogsRepository.save).not.toHaveBeenCalled();
    });

    it('sends anyway when paused but bypassPause is set', async () => {
      configService.get.mockReturnValue({ paymentConfirmationPaused: true });
      loansRepository.findOne.mockResolvedValue(loan);
      installmentsRepository.find.mockResolvedValue([
        { id: 'inst-1', amount: 300000, dueDate: notYetDueDate },
      ]);
      paymentsRepository.find.mockResolvedValue([
        { installmentId: 'inst-1', amountPaid: 300000 },
      ]);

      const result = await service.sendPaidInFull('loan-1', {
        bypassPause: true,
      });

      expect(result?.status).toBe(MessageLogStatus.Sent);
      expect(whatsAppService.sendTemplateMessage).toHaveBeenCalled();
    });
  });
});
