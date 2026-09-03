import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { Installment } from '../loans/entities/installment.entity';
import { Loan } from '../loans/entities/loan.entity';
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
  let messageTemplatesService: { findByTypeOrThrow: jest.Mock };
  let whatsAppService: { sendTemplateMessage: jest.Mock };

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
    messageTemplatesService = { findByTypeOrThrow: jest.fn() };
    whatsAppService = { sendTemplateMessage: jest.fn() };

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
        { provide: MessageTemplatesService, useValue: messageTemplatesService },
        { provide: WhatsAppService, useValue: whatsAppService },
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
      });
      installmentsRepository.count.mockResolvedValue(4);
      paymentsRepository.find.mockResolvedValue([
        { installmentId: 'inst-1', amountPaid: 300000 },
      ]);

      const result = await service.sendPaymentConfirmation('inst-1');

      expect(messageTemplatesService.findByTypeOrThrow).toHaveBeenCalledWith(
        MessageType.PaymentConfirmation,
      );
      expect(result.status).toBe(MessageLogStatus.Sent);
    });

    it('reports an overpayment as saldo a favor', async () => {
      installmentsRepository.findOne.mockResolvedValue({
        id: 'inst-1',
        loanId: 'loan-1',
        loan,
        installmentNumber: 14,
        amount: 300000,
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

    it('throws NotFoundException when the installment does not exist', async () => {
      installmentsRepository.findOne.mockResolvedValue(null);

      await expect(service.sendPaymentConfirmation('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('sendPaidInFull', () => {
    it('sends PaidInFull for the loan', async () => {
      loansRepository.findOne.mockResolvedValue(loan);
      installmentsRepository.find.mockResolvedValue([
        { id: 'inst-1', amount: 300000 },
        { id: 'inst-2', amount: 300000 },
      ]);
      paymentsRepository.find.mockResolvedValue([
        { installmentId: 'inst-1', amountPaid: 300000 },
        { installmentId: 'inst-2', amountPaid: 300000 },
      ]);

      const result = await service.sendPaidInFull('loan-1');

      expect(messageTemplatesService.findByTypeOrThrow).toHaveBeenCalledWith(
        MessageType.PaidInFull,
      );
      expect(result.status).toBe(MessageLogStatus.Sent);
    });

    it('throws NotFoundException when the loan does not exist', async () => {
      loansRepository.findOne.mockResolvedValue(null);

      await expect(service.sendPaidInFull('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
