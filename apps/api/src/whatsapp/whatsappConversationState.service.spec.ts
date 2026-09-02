import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import {
  ConversationMenu,
  WhatsappConversationState,
} from './entities/whatsappConversationState.entity';
import { WhatsappConversationStateService } from './whatsappConversationState.service';

describe('WhatsappConversationStateService', () => {
  let service: WhatsappConversationStateService;
  let repository: {
    findOneBy: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
    delete: jest.Mock;
  };

  beforeEach(async () => {
    repository = {
      findOneBy: jest.fn(),
      save: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WhatsappConversationStateService,
        {
          provide: getRepositoryToken(WhatsappConversationState),
          useValue: repository,
        },
      ],
    }).compile();

    service = module.get<WhatsappConversationStateService>(
      WhatsappConversationStateService,
    );
  });

  describe('getActive', () => {
    it('returns null when no row exists for the phone number', async () => {
      repository.findOneBy.mockResolvedValue(null);

      const result = await service.getActive('+573001234567');

      expect(result).toBeNull();
    });

    it('returns null when the row has expired', async () => {
      repository.findOneBy.mockResolvedValue({
        phoneNumber: '+573001234567',
        currentMenu: ConversationMenu.Main,
        expiresAt: new Date(Date.now() - 1000),
      });

      const result = await service.getActive('+573001234567');

      expect(result).toBeNull();
    });

    it('returns the row when it has not expired', async () => {
      const state = {
        phoneNumber: '+573001234567',
        currentMenu: ConversationMenu.MiCuentaSubmenu,
        expiresAt: new Date(Date.now() + 1000),
      };
      repository.findOneBy.mockResolvedValue(state);

      const result = await service.getActive('+573001234567');

      expect(result).toBe(state);
    });
  });

  describe('upsert', () => {
    it('creates a new row when none exists for the phone number', async () => {
      repository.findOneBy.mockResolvedValue(null);
      repository.create.mockImplementation((data: unknown) => data);
      repository.save.mockImplementation((data: unknown) =>
        Promise.resolve(data),
      );

      const result = await service.upsert(
        '+573001234567',
        'client-1',
        ConversationMenu.Main,
      );

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          phoneNumber: '+573001234567',
          clientId: 'client-1',
          currentMenu: ConversationMenu.Main,
        }),
      );
      expect(result).toMatchObject({
        phoneNumber: '+573001234567',
        clientId: 'client-1',
        currentMenu: ConversationMenu.Main,
      });
    });

    it('updates and refreshes expiresAt on an existing row', async () => {
      const existing = {
        phoneNumber: '+573001234567',
        clientId: null,
        currentMenu: ConversationMenu.Main,
        expiresAt: new Date(Date.now() - 1000),
      };
      repository.findOneBy.mockResolvedValue(existing);
      repository.save.mockImplementation((data: unknown) =>
        Promise.resolve(data),
      );

      const before = Date.now();
      const result = await service.upsert(
        '+573001234567',
        'client-1',
        ConversationMenu.MiCuentaSubmenu,
      );

      expect(repository.create).not.toHaveBeenCalled();
      expect(result.clientId).toBe('client-1');
      expect(result.currentMenu).toBe(ConversationMenu.MiCuentaSubmenu);
      expect(result.expiresAt.getTime()).toBeGreaterThan(before);
    });
  });

  describe('clear', () => {
    it('deletes the row for the phone number', async () => {
      await service.clear('+573001234567');

      expect(repository.delete).toHaveBeenCalledWith({
        phoneNumber: '+573001234567',
      });
    });
  });
});
