import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import {
  WhatsappConversationTicket,
  WhatsappTicketStatus,
  WhatsappTicketTriggerKind,
} from './entities/whatsappConversationTicket.entity';
import { WhatsappInboundGateway } from './webhook/whatsappInbound.gateway';
import { WhatsappConversationTicketService } from './whatsappConversationTicket.service';

describe('WhatsappConversationTicketService', () => {
  let service: WhatsappConversationTicketService;
  let repository: {
    findOneBy: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
    find: jest.Mock;
  };
  let gateway: { emitTicketUpdate: jest.Mock };

  beforeEach(async () => {
    repository = {
      findOneBy: jest.fn(),
      save: jest.fn(),
      create: jest.fn(),
      find: jest.fn(),
    };
    gateway = { emitTicketUpdate: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WhatsappConversationTicketService,
        {
          provide: getRepositoryToken(WhatsappConversationTicket),
          useValue: repository,
        },
        { provide: WhatsappInboundGateway, useValue: gateway },
      ],
    }).compile();

    service = module.get<WhatsappConversationTicketService>(
      WhatsappConversationTicketService,
    );
  });

  describe('openOrReopen', () => {
    it('creates a new Pending ticket when none exists for the client', async () => {
      repository.findOneBy.mockResolvedValue(null);
      repository.create.mockImplementation((data: unknown) => data);
      repository.save.mockImplementation((data: unknown) =>
        Promise.resolve(data),
      );

      const result = await service.openOrReopen(
        'client-1',
        WhatsappTicketTriggerKind.AdvisorRequested,
      );

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          clientId: 'client-1',
          status: WhatsappTicketStatus.Pending,
          triggerKind: WhatsappTicketTriggerKind.AdvisorRequested,
          resolvedAt: null,
        }),
      );
      expect(result).toMatchObject({
        clientId: 'client-1',
        status: WhatsappTicketStatus.Pending,
      });
      expect(gateway.emitTicketUpdate).toHaveBeenCalledWith(result);
    });

    it('bumps an already-Pending ticket back to the front of the queue', async () => {
      const existing = {
        clientId: 'client-1',
        status: WhatsappTicketStatus.Pending,
        triggerKind: WhatsappTicketTriggerKind.ReceiptImage,
        pendingSince: new Date(Date.now() - 60_000),
        resolvedAt: null,
      };
      repository.findOneBy.mockResolvedValue(existing);
      repository.save.mockImplementation((data: unknown) =>
        Promise.resolve(data),
      );

      const before = Date.now();
      const result = await service.openOrReopen(
        'client-1',
        WhatsappTicketTriggerKind.AdvisorRequested,
      );

      expect(repository.create).not.toHaveBeenCalled();
      expect(result.triggerKind).toBe(
        WhatsappTicketTriggerKind.AdvisorRequested,
      );
      expect(result.pendingSince.getTime()).toBeGreaterThanOrEqual(before);
    });

    it('reopens an already-Resolved ticket', async () => {
      const existing = {
        clientId: 'client-1',
        status: WhatsappTicketStatus.Resolved,
        triggerKind: WhatsappTicketTriggerKind.AdvisorRequested,
        pendingSince: new Date(Date.now() - 86_400_000),
        resolvedAt: new Date(Date.now() - 1000),
      };
      repository.findOneBy.mockResolvedValue(existing);
      repository.save.mockImplementation((data: unknown) =>
        Promise.resolve(data),
      );

      const result = await service.openOrReopen(
        'client-1',
        WhatsappTicketTriggerKind.ReceiptDocument,
      );

      expect(result.status).toBe(WhatsappTicketStatus.Pending);
      expect(result.resolvedAt).toBeNull();
    });
  });

  describe('resolve', () => {
    it('returns null when the client has no ticket at all', async () => {
      repository.findOneBy.mockResolvedValue(null);

      const result = await service.resolve('client-1');

      expect(result).toBeNull();
      expect(repository.save).not.toHaveBeenCalled();
      expect(gateway.emitTicketUpdate).not.toHaveBeenCalled();
    });

    it('marks an existing ticket Resolved', async () => {
      const existing = {
        clientId: 'client-1',
        status: WhatsappTicketStatus.Pending,
        triggerKind: WhatsappTicketTriggerKind.AdvisorRequested,
        pendingSince: new Date(Date.now() - 1000),
        resolvedAt: null,
      };
      repository.findOneBy.mockResolvedValue(existing);
      repository.save.mockImplementation((data: unknown) =>
        Promise.resolve(data),
      );

      const result = await service.resolve('client-1');

      expect(result?.status).toBe(WhatsappTicketStatus.Resolved);
      expect(result?.resolvedAt).not.toBeNull();
      expect(gateway.emitTicketUpdate).toHaveBeenCalledWith(result);
    });
  });

  describe('findAll', () => {
    it('returns every ticket ordered oldest-pending-first', async () => {
      repository.find.mockResolvedValue([]);

      const result = await service.findAll();

      expect(repository.find).toHaveBeenCalledWith({
        order: { pendingSince: 'ASC' },
      });
      expect(result).toEqual([]);
    });
  });
});
