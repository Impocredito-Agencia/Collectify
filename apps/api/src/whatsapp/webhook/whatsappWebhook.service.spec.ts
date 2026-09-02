import { createHmac } from 'crypto';

import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { Client } from '../../clients/entities/client.entity';
import {
  WhatsappInboundMessage,
  WhatsappInboundMessageType,
} from '../entities/whatsappInboundMessage.entity';
import { SelfServiceMenuService } from '../selfServiceMenu.service';
import { WhatsAppService } from '../whatsapp.service';

import { WhatsappInboundGateway } from './whatsappInbound.gateway';
import { WhatsappWebhookService } from './whatsappWebhook.service';

const APP_SECRET = 'test-app-secret';
const VERIFY_TOKEN = 'test-verify-token';

function signBody(body: Buffer): string {
  return `sha256=${createHmac('sha256', APP_SECRET).update(body).digest('hex')}`;
}

describe('WhatsappWebhookService', () => {
  let service: WhatsappWebhookService;
  let inboundMessagesRepository: {
    create: jest.Mock;
    save: jest.Mock;
    findAndCount: jest.Mock;
  };
  let clientsRepository: { findOneBy: jest.Mock };
  let configGet: jest.Mock;
  let whatsappInboundGateway: { emitInboundMessage: jest.Mock };
  let whatsAppService: { sendTextMessage: jest.Mock };
  let selfServiceMenuService: { handleInboundEvent: jest.Mock };

  beforeEach(async () => {
    inboundMessagesRepository = {
      create: jest.fn((data: Record<string, unknown>) => data),
      save: jest.fn((data: Record<string, unknown>) => Promise.resolve(data)),
      findAndCount: jest.fn(),
    };
    clientsRepository = { findOneBy: jest.fn() };
    configGet = jest.fn().mockReturnValue({
      webhookVerifyToken: VERIFY_TOKEN,
      appSecret: APP_SECRET,
    });
    whatsappInboundGateway = { emitInboundMessage: jest.fn() };
    whatsAppService = { sendTextMessage: jest.fn() };
    selfServiceMenuService = {
      handleInboundEvent: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WhatsappWebhookService,
        { provide: ConfigService, useValue: { get: configGet } },
        {
          provide: getRepositoryToken(WhatsappInboundMessage),
          useValue: inboundMessagesRepository,
        },
        { provide: getRepositoryToken(Client), useValue: clientsRepository },
        {
          provide: WhatsappInboundGateway,
          useValue: whatsappInboundGateway,
        },
        { provide: WhatsAppService, useValue: whatsAppService },
        { provide: SelfServiceMenuService, useValue: selfServiceMenuService },
      ],
    }).compile();

    service = module.get<WhatsappWebhookService>(WhatsappWebhookService);
  });

  describe('verifyHandshake', () => {
    it('returns the challenge when mode and token match', () => {
      expect(
        service.verifyHandshake('subscribe', VERIFY_TOKEN, 'challenge-123'),
      ).toBe('challenge-123');
    });

    it('throws ForbiddenException when the token does not match', () => {
      expect(() =>
        service.verifyHandshake('subscribe', 'wrong-token', 'challenge-123'),
      ).toThrow(ForbiddenException);
    });

    it('throws ForbiddenException when mode is not "subscribe"', () => {
      expect(() =>
        service.verifyHandshake('unsubscribe', VERIFY_TOKEN, 'challenge-123'),
      ).toThrow(ForbiddenException);
    });

    it('throws ForbiddenException when the verify token is not configured', () => {
      configGet.mockReturnValue({
        webhookVerifyToken: '',
        appSecret: APP_SECRET,
      });
      expect(() =>
        service.verifyHandshake('subscribe', '', 'challenge-123'),
      ).toThrow(ForbiddenException);
    });
  });

  describe('verifySignatureOrThrow', () => {
    it('does not throw for a valid signature', () => {
      const body = Buffer.from(JSON.stringify({ hello: 'world' }));
      expect(() =>
        service.verifySignatureOrThrow(body, signBody(body)),
      ).not.toThrow();
    });

    it('throws ForbiddenException for an invalid signature', () => {
      const body = Buffer.from(JSON.stringify({ hello: 'world' }));
      expect(() =>
        service.verifySignatureOrThrow(body, 'sha256=wrong'),
      ).toThrow(ForbiddenException);
    });

    it('throws ForbiddenException when the signature header is missing', () => {
      const body = Buffer.from(JSON.stringify({ hello: 'world' }));
      expect(() => service.verifySignatureOrThrow(body, undefined)).toThrow(
        ForbiddenException,
      );
    });

    it('throws ForbiddenException when the raw body is missing', () => {
      expect(() =>
        service.verifySignatureOrThrow(undefined, 'sha256=anything'),
      ).toThrow(ForbiddenException);
    });

    it('throws ForbiddenException when the app secret is not configured', () => {
      configGet.mockReturnValue({
        webhookVerifyToken: VERIFY_TOKEN,
        appSecret: '',
      });
      const body = Buffer.from(JSON.stringify({ hello: 'world' }));
      expect(() =>
        service.verifySignatureOrThrow(body, signBody(body)),
      ).toThrow(ForbiddenException);
    });
  });

  describe('handleIncomingPayload', () => {
    function buildPayload(from: string) {
      return {
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [
                    {
                      from,
                      timestamp: '1700000000',
                      type: 'text',
                      text: { body: 'hola' },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };
    }

    it('resolves and stamps the matching client when the phone number is known', async () => {
      clientsRepository.findOneBy.mockResolvedValue({ id: 'client-1' });

      await service.handleIncomingPayload(buildPayload('573001234567'));

      expect(clientsRepository.findOneBy).toHaveBeenCalledWith({
        phoneNumber: '+573001234567',
      });
      expect(inboundMessagesRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ clientId: 'client-1' }),
      );
      expect(whatsappInboundGateway.emitInboundMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          clientId: 'client-1',
          client: { id: 'client-1' },
        }),
      );
    });

    it('persists with clientId null when the phone number matches no client', async () => {
      clientsRepository.findOneBy.mockResolvedValue(null);

      await service.handleIncomingPayload(buildPayload('573009999999'));

      expect(inboundMessagesRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          clientId: null,
          type: WhatsappInboundMessageType.Text,
        }),
      );
    });

    it('dispatches to the self-service menu when the client is known', async () => {
      const client = { id: 'client-1' };
      clientsRepository.findOneBy.mockResolvedValue(client);

      await service.handleIncomingPayload(buildPayload('573001234567'));

      expect(selfServiceMenuService.handleInboundEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: WhatsappInboundMessageType.Text }),
        client,
      );
    });

    it('does not dispatch to the self-service menu for an unrecognized number', async () => {
      clientsRepository.findOneBy.mockResolvedValue(null);

      await service.handleIncomingPayload(buildPayload('573009999999'));

      expect(selfServiceMenuService.handleInboundEvent).not.toHaveBeenCalled();
    });

    it('still persists and acks when the self-service menu handler throws', async () => {
      clientsRepository.findOneBy.mockResolvedValue({ id: 'client-1' });
      selfServiceMenuService.handleInboundEvent.mockRejectedValue(
        new Error('WhatsApp API down'),
      );

      await expect(
        service.handleIncomingPayload(buildPayload('573001234567')),
      ).resolves.toBeUndefined();
      expect(inboundMessagesRepository.save).toHaveBeenCalled();
    });

    it('never throws for a malformed payload', async () => {
      await expect(
        service.handleIncomingPayload({ entry: 'not-an-array' }),
      ).resolves.toBeUndefined();
      expect(inboundMessagesRepository.save).not.toHaveBeenCalled();
      expect(whatsappInboundGateway.emitInboundMessage).not.toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it('returns a paginated result with default page/limit', async () => {
      inboundMessagesRepository.findAndCount.mockResolvedValue([[], 0]);

      const result = await service.findAll({});

      expect(inboundMessagesRepository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {},
          relations: { client: true },
          order: { receivedAt: 'DESC' },
          skip: 0,
          take: 20,
        }),
      );
      expect(result.meta).toEqual({
        page: 1,
        limit: 20,
        total: 0,
        totalPages: 0,
      });
    });

    it('filters by clientId and type', async () => {
      inboundMessagesRepository.findAndCount.mockResolvedValue([[], 0]);

      await service.findAll({
        clientId: 'client-1',
        type: WhatsappInboundMessageType.Button,
      });

      expect(inboundMessagesRepository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            clientId: 'client-1',
            type: WhatsappInboundMessageType.Button,
          },
        }),
      );
    });

    it("builds an OR search across the matched client's first/last name", async () => {
      inboundMessagesRepository.findAndCount.mockResolvedValue([[], 0]);

      await service.findAll({ search: 'Juana' });

      expect(inboundMessagesRepository.findAndCount).toHaveBeenCalledWith(
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
        }),
      );
    });

    it('paginates using the requested page and limit', async () => {
      inboundMessagesRepository.findAndCount.mockResolvedValue([[], 45]);

      const result = await service.findAll({ page: 3, limit: 10 });

      expect(inboundMessagesRepository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 }),
      );
      expect(result.meta).toEqual({
        page: 3,
        limit: 10,
        total: 45,
        totalPages: 5,
      });
    });
  });

  describe('sendManualReply', () => {
    it('normalizes the phone number and sends via WhatsAppService', async () => {
      whatsAppService.sendTextMessage.mockResolvedValue(true);

      const result = await service.sendManualReply('573001234567', 'Hola!');

      expect(whatsAppService.sendTextMessage).toHaveBeenCalledWith(
        '+573001234567',
        'Hola!',
      );
      expect(result).toBe(true);
    });

    it('leaves an already-normalized number unchanged', async () => {
      whatsAppService.sendTextMessage.mockResolvedValue(false);

      const result = await service.sendManualReply('+573001234567', 'Hola!');

      expect(whatsAppService.sendTextMessage).toHaveBeenCalledWith(
        '+573001234567',
        'Hola!',
      );
      expect(result).toBe(false);
    });
  });

  describe('sendTestMenu', () => {
    it("sends the numbered menu text to the client's stored phone number", async () => {
      clientsRepository.findOneBy.mockResolvedValue({
        id: 'client-1',
        phoneNumber: '+573001234567',
      });
      whatsAppService.sendTextMessage.mockResolvedValue(true);

      const result = await service.sendTestMenu('client-1');

      expect(clientsRepository.findOneBy).toHaveBeenCalledWith({
        id: 'client-1',
      });
      expect(whatsAppService.sendTextMessage).toHaveBeenCalledWith(
        '+573001234567',
        expect.stringContaining('1. Hablar con un humano'),
      );
      expect(result).toBe(true);
    });

    it('throws NotFoundException when the client does not exist', async () => {
      clientsRepository.findOneBy.mockResolvedValue(null);

      await expect(service.sendTestMenu('missing-client')).rejects.toThrow(
        NotFoundException,
      );
      expect(whatsAppService.sendTextMessage).not.toHaveBeenCalled();
    });
  });
});
