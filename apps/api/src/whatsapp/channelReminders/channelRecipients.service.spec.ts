import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { Client } from '../../clients/entities/client.entity';
import {
  addDaysToDateString,
  todayDateString,
} from '../../loans/dueDateSchedule';
import { Installment } from '../../loans/entities/installment.entity';

import { ChannelRecipientsService } from './channelRecipients.service';

function client(overrides: Partial<Client>): Client {
  return {
    id: 'client-a',
    firstName: 'Juana',
    lastName: 'Pérez',
    documentNumber: '123',
    phoneNumber: '+573001111111',
    email: 'juana@example.com',
    emailRemindersEnabled: false,
    smsRemindersEnabled: false,
    ...overrides,
  } as Client;
}

describe('ChannelRecipientsService', () => {
  let service: ChannelRecipientsService;
  let clientsRepository: {
    find: jest.Mock;
    findBy: jest.Mock;
    findOneBy: jest.Mock;
    update: jest.Mock;
  };
  let queryBuilder: Record<string, jest.Mock>;

  beforeEach(async () => {
    queryBuilder = {};
    for (const method of [
      'innerJoin',
      'select',
      'addSelect',
      'where',
      'andWhere',
      'groupBy',
    ]) {
      queryBuilder[method] = jest.fn(() => queryBuilder);
    }
    queryBuilder.getRawMany = jest.fn().mockResolvedValue([]);
    clientsRepository = {
      find: jest.fn().mockResolvedValue([]),
      findBy: jest.fn().mockResolvedValue([]),
      findOneBy: jest.fn(),
      update: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChannelRecipientsService,
        { provide: getRepositoryToken(Client), useValue: clientsRepository },
        {
          provide: getRepositoryToken(Installment),
          useValue: { createQueryBuilder: () => queryBuilder },
        },
      ],
    }).compile();

    service = module.get(ChannelRecipientsService);
  });

  describe('list', () => {
    it('lists overdue clients by most days of mora, then clients with a channel on', async () => {
      const today = todayDateString();
      queryBuilder.getRawMany.mockResolvedValue([
        {
          clientId: 'client-a',
          oldestDueDate: addDaysToDateString(today, -5),
          overdueInstallments: '1',
        },
        {
          clientId: 'client-b',
          oldestDueDate: addDaysToDateString(today, -40),
          overdueInstallments: '3',
        },
      ]);
      clientsRepository.find.mockResolvedValue([
        client({ id: 'client-a', firstName: 'Ana' }),
        client({
          id: 'client-b',
          firstName: 'Beto',
          smsRemindersEnabled: true,
        }),
        client({
          id: 'client-c',
          firstName: 'Carla',
          emailRemindersEnabled: true,
        }),
      ]);

      const recipients = await service.list();

      expect(recipients.map((r) => [r.clientId, r.maxOverdueDays])).toEqual([
        ['client-b', 40],
        ['client-a', 5],
        ['client-c', null],
      ]);
      expect(recipients[0]).toMatchObject({
        fullName: 'Beto Pérez',
        overdueInstallments: 3,
        smsRemindersEnabled: true,
      });
    });

    it('still lists clients with a channel on when nobody is overdue', async () => {
      await service.list();

      const [{ where }] = clientsRepository.find.mock.calls[0] as [
        { where: unknown[] },
      ];
      expect(where).toEqual([
        { emailRemindersEnabled: true },
        { smsRemindersEnabled: true },
      ]);
    });
  });

  describe('updateOne', () => {
    it('turns a channel on and returns both flags', async () => {
      clientsRepository.findOneBy.mockResolvedValue(client({}));

      const result = await service.updateOne('client-a', {
        smsRemindersEnabled: true,
      });

      expect(clientsRepository.update).toHaveBeenCalledWith(
        { id: 'client-a' },
        { smsRemindersEnabled: true },
      );
      expect(result).toEqual({
        emailRemindersEnabled: false,
        smsRemindersEnabled: true,
      });
    });

    it('refuses email for a client with no email, but lets it be turned off', async () => {
      clientsRepository.findOneBy.mockResolvedValue(client({ email: null }));

      await expect(
        service.updateOne('client-a', { emailRemindersEnabled: true }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.updateOne('client-a', { emailRemindersEnabled: false }),
      ).resolves.toMatchObject({ emailRemindersEnabled: false });
    });

    it('throws NotFound for an unknown client', async () => {
      clientsRepository.findOneBy.mockResolvedValue(null);

      await expect(
        service.updateOne('missing', { smsRemindersEnabled: true }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateMany', () => {
    it('skips clients without an email when turning email on', async () => {
      clientsRepository.findBy.mockResolvedValue([
        client({ id: 'client-a' }),
        client({ id: 'client-b', firstName: 'Beto', email: '  ' }),
      ]);

      const result = await service.updateMany(['client-a', 'client-b'], {
        emailRemindersEnabled: true,
      });

      expect(result).toEqual({
        updatedClientIds: ['client-a'],
        skippedWithoutEmail: [{ clientId: 'client-b', fullName: 'Beto Pérez' }],
      });
      expect(clientsRepository.update).toHaveBeenCalledTimes(1);
    });

    it('turns SMS off for everyone given, email or not', async () => {
      clientsRepository.findBy.mockResolvedValue([
        client({ id: 'client-a', email: null }),
      ]);

      const result = await service.updateMany(['client-a'], {
        smsRemindersEnabled: false,
      });

      expect(result.updatedClientIds).toEqual(['client-a']);
      expect(result.skippedWithoutEmail).toEqual([]);
    });

    it('requires a channel to change', async () => {
      await expect(service.updateMany(['client-a'], {})).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
