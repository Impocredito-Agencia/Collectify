import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { ClientMessageFrequency } from '../clients/entities/clientMessageFrequency.entity';

import { MessageLog } from './entities/messageLog.entity';
import { MessageFrequencyThrottleService } from './messageFrequencyThrottle.service';
import { MessageType } from './messageType.enum';

describe('MessageFrequencyThrottleService', () => {
  let service: MessageFrequencyThrottleService;
  let clientMessageFrequenciesRepository: { findBy: jest.Mock };
  let messageLogsRepository: { createQueryBuilder: jest.Mock };
  let getRawMany: jest.Mock;

  function daysAgo(days: number): Date {
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  }

  beforeEach(async () => {
    clientMessageFrequenciesRepository = { findBy: jest.fn() };
    getRawMany = jest.fn().mockResolvedValue([]);
    const queryBuilder = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      getRawMany,
    };
    messageLogsRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MessageFrequencyThrottleService,
        {
          provide: getRepositoryToken(ClientMessageFrequency),
          useValue: clientMessageFrequenciesRepository,
        },
        {
          provide: getRepositoryToken(MessageLog),
          useValue: messageLogsRepository,
        },
      ],
    }).compile();

    service = module.get<MessageFrequencyThrottleService>(
      MessageFrequencyThrottleService,
    );
  });

  describe('filterOutThrottledClients', () => {
    // Mandatory per docs/phases/PHASE_27_MESSAGE_FREQUENCY.md's "Tests" section.
    it('messages a qualifying client with no frequency override on every run', async () => {
      clientMessageFrequenciesRepository.findBy.mockResolvedValue([]);

      const result = await service.filterOutThrottledClients(
        ['client-1'],
        [MessageType.SingleOverdueInstallment],
      );

      expect(result).toEqual(['client-1']);
      // No whitelist entries at all — the message_logs query never needs
      // to run.
      expect(messageLogsRepository.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('skips a whitelisted client inside their throttle window, includes them once it elapses', async () => {
      clientMessageFrequenciesRepository.findBy.mockResolvedValue([
        { clientId: 'client-1', minimumDaysBetweenMessages: 7 },
      ]);

      getRawMany.mockResolvedValueOnce([
        { clientId: 'client-1', lastSentAt: daysAgo(3) },
      ]);
      let result = await service.filterOutThrottledClients(
        ['client-1'],
        [MessageType.SingleOverdueInstallment],
      );
      expect(result).toEqual([]);

      getRawMany.mockResolvedValueOnce([
        { clientId: 'client-1', lastSentAt: daysAgo(8) },
      ]);
      result = await service.filterOutThrottledClients(
        ['client-1'],
        [MessageType.SingleOverdueInstallment],
      );
      expect(result).toEqual(['client-1']);
    });

    it('never blocks anyone when the whitelist is empty or nonexistent', async () => {
      clientMessageFrequenciesRepository.findBy.mockResolvedValue([]);

      const result = await service.filterOutThrottledClients(
        ['client-1', 'client-2', 'client-3'],
        [MessageType.SingleUpcomingInstallment],
      );

      expect(result).toEqual(['client-1', 'client-2', 'client-3']);
    });

    it('does not throttle a whitelisted client who has never been messaged before', async () => {
      clientMessageFrequenciesRepository.findBy.mockResolvedValue([
        { clientId: 'client-1', minimumDaysBetweenMessages: 7 },
      ]);
      getRawMany.mockResolvedValue([]);

      const result = await service.filterOutThrottledClients(
        ['client-1'],
        [MessageType.SingleOverdueInstallment],
      );

      expect(result).toEqual(['client-1']);
    });

    it('leaves non-whitelisted clients untouched alongside a throttled one', async () => {
      clientMessageFrequenciesRepository.findBy.mockResolvedValue([
        { clientId: 'client-1', minimumDaysBetweenMessages: 7 },
      ]);
      getRawMany.mockResolvedValue([
        { clientId: 'client-1', lastSentAt: daysAgo(1) },
      ]);

      const result = await service.filterOutThrottledClients(
        ['client-1', 'client-2'],
        [MessageType.SingleOverdueInstallment],
      );

      expect(result).toEqual(['client-2']);
    });

    it('returns an empty list unchanged without querying anything', async () => {
      const result = await service.filterOutThrottledClients(
        [],
        [MessageType.SingleOverdueInstallment],
      );

      expect(result).toEqual([]);
      expect(clientMessageFrequenciesRepository.findBy).not.toHaveBeenCalled();
    });
  });
});
