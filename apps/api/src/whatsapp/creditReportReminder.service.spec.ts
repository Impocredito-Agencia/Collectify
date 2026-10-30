import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { FindOperator } from 'typeorm';

import { Client } from '../clients/entities/client.entity';
import { addDaysToDateString, todayDateString } from '../loans/dueDateSchedule';
import {
  Installment,
  InstallmentStatus,
} from '../loans/entities/installment.entity';
import { Loan } from '../loans/entities/loan.entity';
import { LoanInstallmentConcept } from '../loans/entities/loanInstallmentConcept.entity';
import { Payment } from '../loans/entities/payment.entity';

import { CreditReportReminderService } from './creditReportReminder.service';
import { MessageLog, MessageLogStatus } from './entities/messageLog.entity';
import { MessageLogItem } from './entities/messageLogItem.entity';
import { MessageTemplatesService } from './messageTemplates/messageTemplates.service';
import { MessageType } from './messageType.enum';
import { WhatsAppService } from './whatsapp.service';

describe('CreditReportReminderService', () => {
  let service: CreditReportReminderService;
  let installmentsRepository: { find: jest.Mock };
  let clientsRepository: { findOneBy: jest.Mock };
  let loansRepository: { findOneBy: jest.Mock };
  let messageLogsRepository: { create: jest.Mock; save: jest.Mock };
  let messageLogItemsRepository: {
    create: jest.Mock;
    save: jest.Mock;
    existsBy: jest.Mock;
  };
  let messageTemplatesService: { findByTypeOrThrow: jest.Mock };
  let whatsAppService: { sendTemplateMessage: jest.Mock };

  const client = {
    id: 'client-1',
    firstName: 'Miguel',
    lastName: 'Perez',
    phoneNumber: '+573001234567',
    alternatePhoneNumber: null,
    mutedPhoneNumbers: [],
  };
  const loan = {
    id: 'loan-1',
    clientId: client.id,
    promissoryNoteNumber: '#1001',
    alternateContactPhoneNumber: null,
  };

  function installmentOverdueBy(days: number, id = `inst-${days}`) {
    return {
      id,
      loanId: loan.id,
      loan,
      installmentNumber: 1,
      amount: 250000,
      status: InstallmentStatus.Pending,
      dueDate: addDaysToDateString(todayDateString(), -days),
    };
  }

  beforeEach(async () => {
    installmentsRepository = { find: jest.fn().mockResolvedValue([]) };
    clientsRepository = { findOneBy: jest.fn().mockResolvedValue(client) };
    loansRepository = { findOneBy: jest.fn().mockResolvedValue(loan) };
    messageLogsRepository = {
      create: jest.fn((data: Partial<MessageLog>) => data),
      save: jest.fn((data: Partial<MessageLog>) =>
        Promise.resolve({ ...data, id: 'log-1' }),
      ),
    };
    messageLogItemsRepository = {
      create: jest.fn((data: Partial<MessageLogItem>) => data),
      save: jest.fn(),
      existsBy: jest.fn().mockResolvedValue(false),
    };
    messageTemplatesService = {
      findByTypeOrThrow: jest.fn((type: MessageType) =>
        Promise.resolve({
          metaTemplateName: type,
          metaLanguageCode: 'es',
          content: '{{1}} {{2}} {{3}}',
        }),
      ),
    };
    whatsAppService = {
      sendTemplateMessage: jest
        .fn()
        .mockResolvedValue({ sent: true, whatsappMessageId: 'wamid-1' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CreditReportReminderService,
        { provide: getRepositoryToken(Client), useValue: clientsRepository },
        { provide: getRepositoryToken(Loan), useValue: loansRepository },
        {
          provide: getRepositoryToken(Installment),
          useValue: installmentsRepository,
        },
        {
          provide: getRepositoryToken(Payment),
          useValue: { find: jest.fn().mockResolvedValue([]) },
        },
        {
          provide: getRepositoryToken(LoanInstallmentConcept),
          useValue: { find: jest.fn().mockResolvedValue([]) },
        },
        {
          provide: getRepositoryToken(MessageLog),
          useValue: messageLogsRepository,
        },
        {
          provide: getRepositoryToken(MessageLogItem),
          useValue: messageLogItemsRepository,
        },
        {
          provide: MessageTemplatesService,
          useValue: messageTemplatesService,
        },
        { provide: WhatsAppService, useValue: whatsAppService },
      ],
    }).compile();

    service = module.get(CreditReportReminderService);
  });

  describe('runDailyReminder', () => {
    it('only looks for cuotas due exactly 30 or 50 days ago', async () => {
      await service.runDailyReminder();

      const [{ where }] = installmentsRepository.find.mock.calls[0] as [
        { where: { dueDate: FindOperator<string> } },
      ];
      expect(where.dueDate.value).toEqual([
        addDaysToDateString(todayDateString(), -30),
        addDaysToDateString(todayDateString(), -50),
      ]);
      expect(whatsAppService.sendTemplateMessage).not.toHaveBeenCalled();
    });

    it('does not send when an older cuota already put the pagaré past the day', async () => {
      installmentsRepository.find
        .mockResolvedValueOnce([installmentOverdueBy(30)])
        .mockResolvedValueOnce([
          installmentOverdueBy(44),
          installmentOverdueBy(30),
        ]);

      await service.runDailyReminder();

      expect(whatsAppService.sendTemplateMessage).not.toHaveBeenCalled();
    });

    it('does not repeat a notice already sent for that cuota', async () => {
      installmentsRepository.find
        .mockResolvedValueOnce([installmentOverdueBy(30)])
        .mockResolvedValueOnce([installmentOverdueBy(30)]);
      messageLogItemsRepository.existsBy.mockResolvedValue(true);

      await service.runDailyReminder();

      expect(messageLogItemsRepository.existsBy).toHaveBeenCalledWith({
        installmentId: 'inst-30',
        messageLog: { type: MessageType.CreditReport30Days },
      });
      expect(whatsAppService.sendTemplateMessage).not.toHaveBeenCalled();
    });

    it('keeps going when one loan fails', async () => {
      installmentsRepository.find.mockResolvedValueOnce([
        { ...installmentOverdueBy(30), loanId: 'loan-a' },
        { ...installmentOverdueBy(50), loanId: 'loan-b' },
      ]);
      loansRepository.findOneBy.mockRejectedValueOnce(new Error('boom'));
      installmentsRepository.find.mockResolvedValueOnce([
        { ...installmentOverdueBy(50), loanId: 'loan-b' },
      ]);

      await service.runDailyReminder();

      expect(whatsAppService.sendTemplateMessage).toHaveBeenCalledTimes(1);
    });
  });

  describe('sendForLoan', () => {
    it('sends the 50-day template and logs it with its cuotas', async () => {
      installmentsRepository.find.mockResolvedValue([installmentOverdueBy(50)]);

      const logs = await service.sendForLoan(loan.id);

      expect(whatsAppService.sendTemplateMessage).toHaveBeenCalledWith(
        client.phoneNumber,
        MessageType.CreditReport50Days,
        'es',
        ['Señor/a Miguel Perez', '#1001', expect.stringMatching(/^\$/)],
      );
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({
        type: MessageType.CreditReport50Days,
        status: MessageLogStatus.Sent,
      });
      expect(messageLogItemsRepository.save).toHaveBeenCalledWith([
        expect.objectContaining({
          installmentId: 'inst-50',
          overdueDaysSnapshot: 50,
        }),
      ]);
    });

    it("leaves out the client's other pagarés", async () => {
      installmentsRepository.find.mockResolvedValue([
        installmentOverdueBy(30),
        { ...installmentOverdueBy(90, 'other'), loanId: 'loan-2' },
      ]);

      const logs = await service.sendForLoan(loan.id);

      expect(logs).toHaveLength(1);
      expect(messageLogItemsRepository.save).toHaveBeenCalledWith([
        expect.objectContaining({ installmentId: 'inst-30' }),
      ]);
    });

    it("routes to the loan's alternate contact instead of the client", async () => {
      installmentsRepository.find.mockResolvedValue([
        {
          ...installmentOverdueBy(30),
          loan: { ...loan, alternateContactPhoneNumber: '+573009999999' },
        },
      ]);

      await service.sendForLoan(loan.id);

      expect(whatsAppService.sendTemplateMessage).toHaveBeenCalledTimes(1);
      expect(whatsAppService.sendTemplateMessage).toHaveBeenCalledWith(
        '+573009999999',
        MessageType.CreditReport30Days,
        'es',
        expect.any(Array),
      );
    });

    it('does not send to a muted number', async () => {
      clientsRepository.findOneBy.mockResolvedValue({
        ...client,
        mutedPhoneNumbers: [client.phoneNumber],
      });
      installmentsRepository.find.mockResolvedValue([installmentOverdueBy(30)]);

      await expect(service.sendForLoan(loan.id)).resolves.toEqual([]);
      expect(whatsAppService.sendTemplateMessage).not.toHaveBeenCalled();
    });

    it('records a failed send', async () => {
      installmentsRepository.find.mockResolvedValue([installmentOverdueBy(30)]);
      whatsAppService.sendTemplateMessage.mockResolvedValue({
        sent: false,
        whatsappMessageId: null,
      });

      const logs = await service.sendForLoan(loan.id);

      expect(logs[0].status).toBe(MessageLogStatus.Failed);
    });

    it('refuses a retry once the day count is no longer true', async () => {
      installmentsRepository.find.mockResolvedValue([installmentOverdueBy(31)]);

      await expect(
        service.sendForLoan(loan.id, {
          targetPhoneNumbers: [client.phoneNumber],
        }),
      ).rejects.toThrow(BadRequestException);
      expect(whatsAppService.sendTemplateMessage).not.toHaveBeenCalled();
    });

    it('retries on the same day, to the one number, past the duplicate guard', async () => {
      clientsRepository.findOneBy.mockResolvedValue({
        ...client,
        alternatePhoneNumber: '+573008888888',
      });
      installmentsRepository.find.mockResolvedValue([installmentOverdueBy(30)]);
      messageLogItemsRepository.existsBy.mockResolvedValue(true);

      const logs = await service.sendForLoan(loan.id, {
        targetPhoneNumbers: ['+573008888888'],
      });

      expect(logs).toHaveLength(1);
      expect(whatsAppService.sendTemplateMessage).toHaveBeenCalledTimes(1);
      expect(whatsAppService.sendTemplateMessage).toHaveBeenCalledWith(
        '+573008888888',
        MessageType.CreditReport30Days,
        'es',
        expect.any(Array),
      );
    });
  });
});
