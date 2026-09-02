import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { MessageLog, MessageLogStatus } from '../entities/messageLog.entity';
import { MessageLogItem } from '../entities/messageLogItem.entity';
import { MessageType } from '../messageType.enum';
import { NewLoanReminderService } from '../newLoanReminder.service';
import { OverdueReminderService } from '../overdueReminder.service';
import { PaymentConfirmationService } from '../paymentConfirmation.service';
import { UpcomingDueReminderService } from '../upcomingDueReminder.service';

import { MessageLogsService } from './messageLogs.service';

describe('MessageLogsService', () => {
  let service: MessageLogsService;
  let repository: {
    findAndCount: jest.Mock;
    findOneBy: jest.Mock;
    update: jest.Mock;
  };
  let messageLogItemsRepository: { find: jest.Mock; findOne: jest.Mock };
  let overdueReminderService: { sendReminderForClient: jest.Mock };
  let upcomingDueReminderService: { sendReminderForClient: jest.Mock };
  let newLoanReminderService: { sendNewLoanMessage: jest.Mock };
  let paymentConfirmationService: {
    sendPaymentConfirmation: jest.Mock;
    sendPaidInFull: jest.Mock;
  };

  const mockLog: MessageLog = {
    id: 'log-1',
    clientId: 'client-1',
    client: undefined as never,
    type: MessageType.SingleOverdueInstallment,
    phoneNumber: '+573001234567',
    messageContent: 'Hola...',
    status: MessageLogStatus.Sent,
    sentAt: new Date(),
    retriedAt: null,
    retryOfMessageLogId: null,
    retryOfMessageLog: null,
    createdAt: new Date(),
  };

  beforeEach(async () => {
    repository = {
      findAndCount: jest.fn(),
      findOneBy: jest.fn(),
      update: jest.fn(),
    };
    messageLogItemsRepository = {
      find: jest.fn(),
      findOne: jest.fn(),
    };
    overdueReminderService = { sendReminderForClient: jest.fn() };
    upcomingDueReminderService = { sendReminderForClient: jest.fn() };
    newLoanReminderService = { sendNewLoanMessage: jest.fn() };
    paymentConfirmationService = {
      sendPaymentConfirmation: jest.fn(),
      sendPaidInFull: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MessageLogsService,
        { provide: getRepositoryToken(MessageLog), useValue: repository },
        {
          provide: getRepositoryToken(MessageLogItem),
          useValue: messageLogItemsRepository,
        },
        {
          provide: OverdueReminderService,
          useValue: overdueReminderService,
        },
        {
          provide: UpcomingDueReminderService,
          useValue: upcomingDueReminderService,
        },
        { provide: NewLoanReminderService, useValue: newLoanReminderService },
        {
          provide: PaymentConfirmationService,
          useValue: paymentConfirmationService,
        },
      ],
    }).compile();

    service = module.get<MessageLogsService>(MessageLogsService);
  });

  it('returns a paginated page and applies the clientId/type/status/date filters', async () => {
    repository.findAndCount.mockResolvedValue([[mockLog], 1]);

    const result = await service.findAll({
      clientId: 'client-1',
      type: MessageType.SingleOverdueInstallment,
      status: MessageLogStatus.Sent,
      dateFrom: '2026-01-01',
      dateTo: '2026-01-31',
    });

    expect(result).toEqual({
      items: [mockLog],
      meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    expect(repository.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          clientId: 'client-1',
          type: MessageType.SingleOverdueInstallment,
          status: MessageLogStatus.Sent,
          sentAt: expect.objectContaining({
            _type: 'between',
            _value: [new Date('2026-01-01'), new Date('2026-01-31')],
          }) as unknown,
        },
        order: { sentAt: 'DESC' },
        relations: { client: true },
      }),
    );
  });

  it('applies an open-ended sentAt filter when only dateFrom is given', async () => {
    repository.findAndCount.mockResolvedValue([[mockLog], 1]);

    await service.findAll({ dateFrom: '2026-01-01' });

    expect(repository.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          sentAt: expect.objectContaining({
            _type: 'moreThanOrEqual',
            _value: new Date('2026-01-01'),
          }) as unknown,
        }) as unknown,
      }),
    );
  });

  it('returns an empty page when there are no matches', async () => {
    repository.findAndCount.mockResolvedValue([[], 0]);

    const result = await service.findAll({});

    expect(result.items).toEqual([]);
    expect(result.meta.totalPages).toBe(0);
  });

  it('applies the search filter as an OR across first/last name', async () => {
    repository.findAndCount.mockResolvedValue([[mockLog], 1]);

    await service.findAll({ search: 'Juana' });

    expect(repository.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({
        where: [
          {
            client: {
              firstName: expect.objectContaining({
                _type: 'ilike',
                _value: '%Juana%',
              }) as unknown,
            },
          },
          {
            client: {
              lastName: expect.objectContaining({
                _type: 'ilike',
                _value: '%Juana%',
              }) as unknown,
            },
          },
        ],
        relations: { client: true },
      }),
    );
  });

  it('respects custom page and limit', async () => {
    repository.findAndCount.mockResolvedValue([[], 0]);

    await service.findAll({ page: 2, limit: 5 });

    expect(repository.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 5, take: 5 }),
    );
  });

  describe('getItems', () => {
    it('returns the items for an existing message log', async () => {
      repository.findOneBy.mockResolvedValue(mockLog);
      const items = [{ id: 'item-1', messageLogId: 'log-1' }];
      messageLogItemsRepository.find.mockResolvedValue(items);

      const result = await service.getItems('log-1');

      expect(result).toEqual(items);
      expect(messageLogItemsRepository.find).toHaveBeenCalledWith({
        where: { messageLogId: 'log-1' },
        relations: { installment: { loan: true } },
        order: { createdAt: 'ASC' },
      });
    });

    it('throws NotFoundException when the message log does not exist', async () => {
      repository.findOneBy.mockResolvedValue(null);

      await expect(service.getItems('missing-id')).rejects.toThrow(
        NotFoundException,
      );
      expect(messageLogItemsRepository.find).not.toHaveBeenCalled();
    });
  });

  describe('retry', () => {
    it('throws NotFoundException when the message log does not exist', async () => {
      repository.findOneBy.mockResolvedValue(null);

      await expect(service.retry('missing-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws BadRequestException when the message was not failed', async () => {
      repository.findOneBy.mockResolvedValue({
        ...mockLog,
        status: MessageLogStatus.Sent,
      });

      await expect(service.retry('log-1')).rejects.toThrow(BadRequestException);
      expect(
        overdueReminderService.sendReminderForClient,
      ).not.toHaveBeenCalled();
    });

    it('re-sends an overdue reminder and links the retry to the original', async () => {
      const failedLog = { ...mockLog, status: MessageLogStatus.Failed };
      repository.findOneBy.mockResolvedValue(failedLog);
      const newLog = { ...mockLog, id: 'log-2', status: MessageLogStatus.Sent };
      overdueReminderService.sendReminderForClient.mockResolvedValue(newLog);

      const result = await service.retry('log-1');

      expect(overdueReminderService.sendReminderForClient).toHaveBeenCalledWith(
        'client-1',
        { allowEmpty: true },
      );
      expect(repository.update).toHaveBeenCalledWith(
        { id: 'log-1' },
        { retriedAt: expect.any(Date) as unknown },
      );
      expect(repository.update).toHaveBeenCalledWith(
        { id: 'log-2' },
        { retryOfMessageLogId: 'log-1' },
      );
      expect(result).toEqual(newLog);
    });

    it('re-sends an upcoming-due reminder', async () => {
      repository.findOneBy.mockResolvedValue({
        ...mockLog,
        type: MessageType.SingleUpcomingInstallment,
        status: MessageLogStatus.Failed,
      });
      upcomingDueReminderService.sendReminderForClient.mockResolvedValue({
        ...mockLog,
        id: 'log-2',
      });

      await service.retry('log-1');

      expect(
        upcomingDueReminderService.sendReminderForClient,
      ).toHaveBeenCalledWith('client-1', { allowEmpty: true });
    });

    it('re-sends the mixed overdue+upcoming reminder via the overdue family path', async () => {
      repository.findOneBy.mockResolvedValue({
        ...mockLog,
        type: MessageType.UpcomingAndOverdueMixed,
        status: MessageLogStatus.Failed,
      });
      overdueReminderService.sendReminderForClient.mockResolvedValue({
        ...mockLog,
        id: 'log-2',
      });

      await service.retry('log-1');

      expect(overdueReminderService.sendReminderForClient).toHaveBeenCalledWith(
        'client-1',
        { allowEmpty: true },
      );
    });

    it('re-sends a new-loan message using the loan found via the message items', async () => {
      repository.findOneBy.mockResolvedValue({
        ...mockLog,
        type: MessageType.NewLoanNewClient,
        status: MessageLogStatus.Failed,
      });
      messageLogItemsRepository.findOne.mockResolvedValue({
        installment: { loanId: 'loan-1' },
      });
      newLoanReminderService.sendNewLoanMessage.mockResolvedValue({
        ...mockLog,
        id: 'log-2',
      });

      await service.retry('log-1');

      expect(newLoanReminderService.sendNewLoanMessage).toHaveBeenCalledWith(
        'loan-1',
      );
    });

    it('throws BadRequestException for a new-loan message with no related items', async () => {
      repository.findOneBy.mockResolvedValue({
        ...mockLog,
        type: MessageType.NewLoanNewClient,
        status: MessageLogStatus.Failed,
      });
      messageLogItemsRepository.findOne.mockResolvedValue(null);

      await expect(service.retry('log-1')).rejects.toThrow(BadRequestException);
      expect(newLoanReminderService.sendNewLoanMessage).not.toHaveBeenCalled();
    });

    it('re-sends a payment confirmation using the installmentId found via the message items', async () => {
      repository.findOneBy.mockResolvedValue({
        ...mockLog,
        type: MessageType.PaymentConfirmation,
        status: MessageLogStatus.Failed,
      });
      messageLogItemsRepository.findOne.mockResolvedValue({
        installmentId: 'inst-1',
        installment: { loanId: 'loan-1' },
      });
      paymentConfirmationService.sendPaymentConfirmation.mockResolvedValue({
        ...mockLog,
        id: 'log-2',
      });

      await service.retry('log-1');

      expect(
        paymentConfirmationService.sendPaymentConfirmation,
      ).toHaveBeenCalledWith('inst-1');
    });

    it('re-sends a paid-in-full message using the loan found via the message items', async () => {
      repository.findOneBy.mockResolvedValue({
        ...mockLog,
        type: MessageType.PaidInFull,
        status: MessageLogStatus.Failed,
      });
      messageLogItemsRepository.findOne.mockResolvedValue({
        installmentId: 'inst-1',
        installment: { loanId: 'loan-1' },
      });
      paymentConfirmationService.sendPaidInFull.mockResolvedValue({
        ...mockLog,
        id: 'log-2',
      });

      await service.retry('log-1');

      expect(paymentConfirmationService.sendPaidInFull).toHaveBeenCalledWith(
        'loan-1',
      );
    });
  });
});
