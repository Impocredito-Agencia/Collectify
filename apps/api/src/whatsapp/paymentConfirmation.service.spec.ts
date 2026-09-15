import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { ClientCreditBalanceService } from '../clients/clientCreditBalance.service';
import { Installment } from '../loans/entities/installment.entity';
import { Loan } from '../loans/entities/loan.entity';

import { MessageLog, MessageLogStatus } from './entities/messageLog.entity';
import { MessageLogItem } from './entities/messageLogItem.entity';
import { MessageTemplatesService } from './messageTemplates/messageTemplates.service';
import { MessageType } from './messageType.enum';
import { PaymentConfirmationService } from './paymentConfirmation.service';
import { GENERIC_TEMPLATE_CONTENT } from './templateBodyRenderer.testFixtures';
import { WhatsAppService } from './whatsapp.service';

describe('PaymentConfirmationService', () => {
  let service: PaymentConfirmationService;
  let installmentsRepository: {
    findOne: jest.Mock;
    find: jest.Mock;
    count: jest.Mock;
  };
  let loansRepository: { findOne: jest.Mock };
  let messageLogsRepository: { create: jest.Mock; save: jest.Mock };
  let messageLogItemsRepository: { create: jest.Mock; save: jest.Mock };
  let messageTemplatesService: { findByTypeOrThrow: jest.Mock };
  let whatsAppService: { sendTemplateMessage: jest.Mock };
  let configService: { get: jest.Mock };
  let clientCreditBalanceService: { getBalance: jest.Mock };

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
    configService = {
      get: jest.fn().mockReturnValue({ paymentConfirmationPaused: false }),
    };
    // Default: no unclaimed credit — most tests don't care about saldo a
    // favor.
    clientCreditBalanceService = { getBalance: jest.fn().mockResolvedValue(0) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentConfirmationService,
        {
          provide: getRepositoryToken(Installment),
          useValue: installmentsRepository,
        },
        { provide: getRepositoryToken(Loan), useValue: loansRepository },
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
        { provide: ConfigService, useValue: configService },
        {
          provide: ClientCreditBalanceService,
          useValue: clientCreditBalanceService,
        },
      ],
    }).compile();

    service = module.get(PaymentConfirmationService);

    messageTemplatesService.findByTypeOrThrow.mockResolvedValue({
      metaTemplateName: 'confirmacion_pago',
      metaLanguageCode: 'es',
      content: GENERIC_TEMPLATE_CONTENT,
    });
    whatsAppService.sendTemplateMessage.mockResolvedValue({
      sent: true,
      whatsappMessageId: 'wamid.TEST',
    });
  });

  describe('sendPaymentConfirmation', () => {
    // Human report, 2026-09-19 — a loan with alternateContactPhoneNumber
    // set routes the confirmation to that contact instead of the
    // client's own number(s).
    it('sends to the alternate contact instead of the client when the loan has one', async () => {
      installmentsRepository.findOne.mockResolvedValue({
        id: 'inst-1',
        loanId: 'loan-1',
        loan: { ...loan, alternateContactPhoneNumber: '+573009876543' },
        installmentNumber: 14,
        amount: 300000,
        dueDate: notYetDueDate,
      });
      installmentsRepository.count.mockResolvedValue(4);

      await service.sendPaymentConfirmation('inst-1');

      expect(whatsAppService.sendTemplateMessage).toHaveBeenCalledWith(
        '+573009876543',
        expect.any(String),
        expect.any(String),
        expect.any(Array),
      );
      expect(whatsAppService.sendTemplateMessage).not.toHaveBeenCalledWith(
        client.phoneNumber,
        expect.anything(),
        expect.anything(),
        expect.anything(),
      );
    });

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

      const [result] = await service.sendPaymentConfirmation('inst-1');

      expect(messageTemplatesService.findByTypeOrThrow).toHaveBeenCalledWith(
        MessageType.PaymentConfirmation,
      );
      expect(result?.status).toBe(MessageLogStatus.Sent);
    });

    // Human report, 2026-09-14 — messageContent used to be
    // bodyParameters.join(' | '), a raw debug rendering that never matched
    // what the client actually saw. It's now the real template body with
    // its placeholders filled in, the same text Meta sent.
    it('logs the fully rendered message the client actually received, not the raw parameters', async () => {
      installmentsRepository.findOne.mockResolvedValue({
        id: 'inst-1',
        loanId: 'loan-1',
        loan,
        installmentNumber: 14,
        amount: 300000,
        dueDate: notYetDueDate,
      });
      installmentsRepository.count.mockResolvedValue(4);
      messageTemplatesService.findByTypeOrThrow.mockResolvedValue({
        metaTemplateName: 'confirmacion_pago',
        metaLanguageCode: 'es',
        content: 'Hola {{1}}, su cuota {{2}} del pagaré {{3}} fue registrada.',
      });

      const [result] = await service.sendPaymentConfirmation('inst-1');

      expect(result?.messageContent).toBe(
        'Hola Señor/a Angela Fajardo, su cuota 14 del pagaré 778 fue registrada.',
      );
    });

    // Human report, 2026-09-14 — this used to be derived narrowly from
    // this one installment's totalPaid vs totalOwed (see git history for
    // that calculation and its own "does not report accrued mora paid off
    // as saldo a favor" regression test, now covered instead by
    // ClientCreditBalanceService/InstallmentsService's own tests, which own
    // that math). It now just reads the real ledger balance.
    it("reports the client's saldo a favor from the credit ledger", async () => {
      installmentsRepository.findOne.mockResolvedValue({
        id: 'inst-1',
        loanId: 'loan-1',
        loan,
        installmentNumber: 14,
        amount: 300000,
        dueDate: notYetDueDate,
      });
      installmentsRepository.count.mockResolvedValue(0);
      clientCreditBalanceService.getBalance.mockResolvedValue(20000);

      await service.sendPaymentConfirmation('inst-1');

      expect(clientCreditBalanceService.getBalance).toHaveBeenCalledWith(
        loan.clientId,
      );
      const [, , , params] = whatsAppService.sendTemplateMessage.mock
        .calls[0] as [string, string, string, string[]];
      expect(params.at(-1)).toContain('saldo a favor de $20.000');
    });

    // Confirmed with the human, 2026-09-14 — the ledger balance is
    // client-wide, but a loan's alternate contact is scoped to just that
    // one loan, so it must never learn about credit the client may have
    // earned on a different loan of theirs.
    it('never reports saldo a favor to a loan alternate contact', async () => {
      installmentsRepository.findOne.mockResolvedValue({
        id: 'inst-1',
        loanId: 'loan-1',
        loan: { ...loan, alternateContactPhoneNumber: '+573009876543' },
        installmentNumber: 14,
        amount: 300000,
        dueDate: notYetDueDate,
      });
      installmentsRepository.count.mockResolvedValue(0);
      clientCreditBalanceService.getBalance.mockResolvedValue(20000);

      await service.sendPaymentConfirmation('inst-1');

      expect(clientCreditBalanceService.getBalance).not.toHaveBeenCalled();
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

      expect(result).toEqual([]);
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

      const [result] = await service.sendPaymentConfirmation('inst-1', {
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

      const [result] = await service.sendPaidInFull('loan-1');

      expect(messageTemplatesService.findByTypeOrThrow).toHaveBeenCalledWith(
        MessageType.PaidInFull,
      );
      expect(result?.status).toBe(MessageLogStatus.Sent);
    });

    it("reports the client's saldo a favor from the credit ledger", async () => {
      loansRepository.findOne.mockResolvedValue(loan);
      installmentsRepository.find.mockResolvedValue([
        { id: 'inst-1', amount: 300000, dueDate: notYetDueDate },
      ]);
      clientCreditBalanceService.getBalance.mockResolvedValue(15000);

      await service.sendPaidInFull('loan-1');

      expect(clientCreditBalanceService.getBalance).toHaveBeenCalledWith(
        loan.clientId,
      );
      const [, , , params] = whatsAppService.sendTemplateMessage.mock
        .calls[0] as [string, string, string, string[]];
      expect(params.at(-1)).toContain('saldo a favor de $15.000');
    });

    // See sendPaymentConfirmation's identical test/comment.
    it('never reports saldo a favor to a loan alternate contact', async () => {
      loansRepository.findOne.mockResolvedValue({
        ...loan,
        alternateContactPhoneNumber: '+573009876543',
      });
      installmentsRepository.find.mockResolvedValue([
        { id: 'inst-1', amount: 300000, dueDate: notYetDueDate },
      ]);
      clientCreditBalanceService.getBalance.mockResolvedValue(15000);

      await service.sendPaidInFull('loan-1');

      expect(clientCreditBalanceService.getBalance).not.toHaveBeenCalled();
      const [, , , params] = whatsAppService.sendTemplateMessage.mock
        .calls[0] as [string, string, string, string[]];
      expect(params.at(-1)).not.toContain('saldo a favor');
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

      expect(result).toEqual([]);
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

      const [result] = await service.sendPaidInFull('loan-1', {
        bypassPause: true,
      });

      expect(result?.status).toBe(MessageLogStatus.Sent);
      expect(whatsAppService.sendTemplateMessage).toHaveBeenCalled();
    });
  });
});
