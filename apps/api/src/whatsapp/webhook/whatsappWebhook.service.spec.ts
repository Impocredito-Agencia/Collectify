import { createHmac } from 'crypto';

import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { In } from 'typeorm';

import { Client } from '../../clients/entities/client.entity';
import { MessageLog, MessageLogStatus } from '../entities/messageLog.entity';
import {
  WhatsappTicketStatus,
  WhatsappTicketTriggerKind,
} from '../entities/whatsappConversationTicket.entity';
import { WhatsappConversationClosure } from '../entities/whatsappConversationClosure.entity';
import {
  WhatsappInboundMessage,
  WhatsappInboundMessageType,
} from '../entities/whatsappInboundMessage.entity';
import {
  WhatsappManualReply,
  WhatsappManualReplyStatus,
} from '../entities/whatsappManualReply.entity';
import { SelfServiceMenuService } from '../selfServiceMenu.service';
import { WhatsappConversationStateService } from '../whatsappConversationState.service';
import { WhatsappConversationTicketService } from '../whatsappConversationTicket.service';
import { WhatsAppService } from '../whatsapp.service';
import { WhatsappOutboundLogService } from '../whatsappOutboundLog.service';

import { WhatsappInboundGateway } from './whatsappInbound.gateway';
import { WhatsappMediaService } from './whatsappMedia.service';
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
    find: jest.Mock;
    findOne: jest.Mock;
    manager: { query: jest.Mock };
  };
  let clientsRepository: { findOne: jest.Mock };
  let configGet: jest.Mock;
  let whatsappInboundGateway: {
    emitInboundMessage: jest.Mock;
    emitManualReply: jest.Mock;
    emitConversationUpdate: jest.Mock;
  };
  let closuresRepository: { upsert: jest.Mock };
  let manualRepliesRepository: {
    create: jest.Mock;
    save: jest.Mock;
    find: jest.Mock;
    update: jest.Mock;
  };
  let messageLogsRepository: { find: jest.Mock; update: jest.Mock };
  let whatsAppService: {
    sendTextMessage: jest.Mock;
    sendTemplateMessage: jest.Mock;
  };
  let whatsappOutboundLogService: { log: jest.Mock };
  let selfServiceMenuService: { handleInboundEvent: jest.Mock };
  let conversationStateService: { getActive: jest.Mock; clear: jest.Mock };
  let conversationTicketService: {
    resolve: jest.Mock;
    findByClientId: jest.Mock;
  };
  let whatsappMediaService: {
    downloadAndStore: jest.Mock;
    fetchMediaBytes: jest.Mock;
  };

  beforeEach(async () => {
    inboundMessagesRepository = {
      create: jest.fn((data: Record<string, unknown>) => data),
      save: jest.fn((data: Record<string, unknown>) => Promise.resolve(data)),
      findAndCount: jest.fn(),
      find: jest.fn(),
      findOne: jest.fn(),
      manager: { query: jest.fn() },
    };
    clientsRepository = { findOne: jest.fn() };
    configGet = jest.fn().mockReturnValue({
      webhookVerifyToken: VERIFY_TOKEN,
      appSecret: APP_SECRET,
    });
    whatsappInboundGateway = {
      emitInboundMessage: jest.fn(),
      emitManualReply: jest.fn(),
      emitConversationUpdate: jest.fn(),
    };
    closuresRepository = { upsert: jest.fn().mockResolvedValue(undefined) };
    manualRepliesRepository = {
      create: jest.fn((data: Record<string, unknown>) => data),
      save: jest.fn((data: Record<string, unknown>) =>
        Promise.resolve({ id: 'reply-1', ...data }),
      ),
      find: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({ affected: 0 }),
    };
    messageLogsRepository = {
      find: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({ affected: 0 }),
    };
    whatsAppService = {
      sendTextMessage: jest.fn(),
      sendTemplateMessage: jest.fn(),
    };
    whatsappOutboundLogService = {
      log: jest.fn((params: Record<string, unknown>) =>
        Promise.resolve({ id: 'reply-1', ...params }),
      ),
    };
    selfServiceMenuService = {
      handleInboundEvent: jest.fn().mockResolvedValue(undefined),
    };
    conversationStateService = {
      getActive: jest.fn().mockResolvedValue(null),
      clear: jest.fn().mockResolvedValue(undefined),
    };
    conversationTicketService = {
      resolve: jest.fn().mockResolvedValue(null),
      findByClientId: jest.fn().mockResolvedValue(null),
    };
    // Defaults to "nothing to attach" — most tests below don't involve a
    // media message at all (mediaId stays null out of extractInboundEvents
    // for text/button/location/other, so this is never even called for
    // them).
    whatsappMediaService = {
      downloadAndStore: jest.fn().mockResolvedValue(null),
      fetchMediaBytes: jest.fn().mockResolvedValue(null),
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
          provide: getRepositoryToken(WhatsappManualReply),
          useValue: manualRepliesRepository,
        },
        {
          provide: getRepositoryToken(MessageLog),
          useValue: messageLogsRepository,
        },
        {
          provide: getRepositoryToken(WhatsappConversationClosure),
          useValue: closuresRepository,
        },
        {
          provide: WhatsappInboundGateway,
          useValue: whatsappInboundGateway,
        },
        { provide: WhatsAppService, useValue: whatsAppService },
        {
          provide: WhatsappOutboundLogService,
          useValue: whatsappOutboundLogService,
        },
        { provide: SelfServiceMenuService, useValue: selfServiceMenuService },
        {
          provide: WhatsappConversationStateService,
          useValue: conversationStateService,
        },
        {
          provide: WhatsappConversationTicketService,
          useValue: conversationTicketService,
        },
        { provide: WhatsappMediaService, useValue: whatsappMediaService },
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
      clientsRepository.findOne.mockResolvedValue({ id: 'client-1' });

      await service.handleIncomingPayload(buildPayload('573001234567'));

      expect(clientsRepository.findOne).toHaveBeenCalledWith({
        where: [
          { phoneNumber: '+573001234567' },
          { alternatePhoneNumber: '+573001234567' },
        ],
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
      clientsRepository.findOne.mockResolvedValue(null);

      await service.handleIncomingPayload(buildPayload('573009999999'));

      expect(inboundMessagesRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          clientId: null,
          type: WhatsappInboundMessageType.Text,
        }),
      );
    });

    it('dispatches to the self-service menu when the client is known', async () => {
      const client = { id: 'client-1', phoneNumber: '+573009999999' };
      clientsRepository.findOne.mockResolvedValue(client);

      await service.handleIncomingPayload(buildPayload('573001234567'));

      // Human report, 2026-09-19 — dispatched with phoneNumber overridden
      // to whichever number the message actually arrived on
      // ('+573001234567'), not the client's stored primary
      // ('+573009999999' here) — see persistEvent's own comment on why.
      expect(selfServiceMenuService.handleInboundEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: WhatsappInboundMessageType.Text }),
        { id: 'client-1', phoneNumber: '+573001234567' },
      );
    });

    // Human report, 2026-09-19 — a client matched via their
    // alternatePhoneNumber must get self-service replies back on that
    // SAME number, not their stored primary (a different physical
    // conversation) — see persistEvent's respondingClient comment.
    it('replies on the alternate number when the client texted in from it', async () => {
      clientsRepository.findOne.mockResolvedValue({
        id: 'client-1',
        phoneNumber: '+573001234567',
        alternatePhoneNumber: '+573009876543',
      });

      await service.handleIncomingPayload(buildPayload('573009876543'));

      expect(selfServiceMenuService.handleInboundEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: WhatsappInboundMessageType.Text }),
        {
          id: 'client-1',
          phoneNumber: '+573009876543',
          alternatePhoneNumber: '+573009876543',
        },
      );
    });

    it('does not dispatch to the self-service menu for an unrecognized number', async () => {
      clientsRepository.findOne.mockResolvedValue(null);

      await service.handleIncomingPayload(buildPayload('573009999999'));

      expect(selfServiceMenuService.handleInboundEvent).not.toHaveBeenCalled();
    });

    it('still persists and acks when the self-service menu handler throws', async () => {
      clientsRepository.findOne.mockResolvedValue({ id: 'client-1' });
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

    // Human report, 2026-09-11 — see WhatsappMediaService's own comment.
    function buildImagePayload(from: string) {
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
                      type: 'image',
                      image: { id: 'media-1', mime_type: 'image/jpeg' },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };
    }

    it('attaches the re-hosted media url before pushing the live update, for a media message', async () => {
      whatsappMediaService.downloadAndStore.mockResolvedValue(
        'https://res.cloudinary.com/demo/image/upload/media-1.jpg',
      );

      await service.handleIncomingPayload(buildImagePayload('573001234567'));

      expect(whatsappMediaService.downloadAndStore).toHaveBeenCalledWith(
        'media-1',
      );
      expect(inboundMessagesRepository.save).toHaveBeenLastCalledWith(
        expect.objectContaining({
          mediaUrl: 'https://res.cloudinary.com/demo/image/upload/media-1.jpg',
        }),
      );
      expect(whatsappInboundGateway.emitInboundMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          mediaUrl: 'https://res.cloudinary.com/demo/image/upload/media-1.jpg',
        }),
      );
    });

    it('never calls the media service for a non-media message', async () => {
      await service.handleIncomingPayload(buildPayload('573001234567'));

      expect(whatsappMediaService.downloadAndStore).not.toHaveBeenCalled();
    });

    it('still persists and acks (with no mediaUrl) when the download resolves to null', async () => {
      whatsappMediaService.downloadAndStore.mockResolvedValue(null);

      await expect(
        service.handleIncomingPayload(buildImagePayload('573001234567')),
      ).resolves.toBeUndefined();

      // Only the initial save — the second, mediaUrl-attaching save never
      // runs when there's nothing to attach.
      expect(inboundMessagesRepository.save).toHaveBeenCalledTimes(1);
      expect(whatsappInboundGateway.emitInboundMessage).toHaveBeenCalled();
    });

    it('still persists and acks when the media service throws unexpectedly', async () => {
      whatsappMediaService.downloadAndStore.mockRejectedValue(
        new Error('Cloudinary is down'),
      );

      await expect(
        service.handleIncomingPayload(buildImagePayload('573001234567')),
      ).resolves.toBeUndefined();
      expect(inboundMessagesRepository.save).toHaveBeenCalledTimes(1);
      expect(whatsappInboundGateway.emitInboundMessage).toHaveBeenCalled();
    });

    // Human report, 2026-09-14 — the client does not want audio/video
    // re-hosted to Cloudinary (unlike image/document above), just the raw
    // Meta media id kept for on-demand playback — see
    // WhatsappInboundMessage.metaMediaId's own comment.
    function buildAudioPayload(from: string) {
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
                      type: 'audio',
                      audio: { id: 'media-9', mime_type: 'audio/ogg' },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };
    }

    it('saves the raw Meta media id for an audio message, never calling the Cloudinary re-host', async () => {
      await service.handleIncomingPayload(buildAudioPayload('573001234567'));

      expect(whatsappMediaService.downloadAndStore).not.toHaveBeenCalled();
      expect(inboundMessagesRepository.save).toHaveBeenLastCalledWith(
        expect.objectContaining({ metaMediaId: 'media-9' }),
      );
    });

    // Added 2026-09-16 — extractStatusEvents.ts's own delivery-status
    // callbacks, previously ignored entirely by this same webhook payload.
    function buildStatusPayload(status: Record<string, unknown>) {
      return {
        entry: [{ changes: [{ value: { statuses: [status] } }] }],
      };
    }

    it('updates the matching message_logs row when the WAMID matches one', async () => {
      messageLogsRepository.update.mockResolvedValue({ affected: 1 });

      await service.handleIncomingPayload(
        buildStatusPayload({
          id: 'wamid.REMINDER',
          status: 'delivered',
          timestamp: '1700000000',
        }),
      );

      expect(messageLogsRepository.update).toHaveBeenCalledWith(
        { whatsappMessageId: 'wamid.REMINDER' },
        expect.objectContaining({
          deliveryStatus: 'delivered',
          deliveryStatusUpdatedAt: new Date(1700000000 * 1000),
          lastErrorCode: null,
          lastErrorTitle: null,
        }),
      );
      expect(manualRepliesRepository.update).not.toHaveBeenCalled();
    });

    it('falls back to whatsapp_manual_replies when no message_logs row matches', async () => {
      messageLogsRepository.update.mockResolvedValue({ affected: 0 });
      manualRepliesRepository.update.mockResolvedValue({ affected: 1 });

      await service.handleIncomingPayload(
        buildStatusPayload({
          id: 'wamid.MANUAL_REPLY',
          status: 'read',
          timestamp: '1700000000',
        }),
      );

      expect(manualRepliesRepository.update).toHaveBeenCalledWith(
        { whatsappMessageId: 'wamid.MANUAL_REPLY' },
        expect.objectContaining({ deliveryStatus: 'read' }),
      );
    });

    it('records the error code/title on a failed status', async () => {
      messageLogsRepository.update.mockResolvedValue({ affected: 1 });

      await service.handleIncomingPayload(
        buildStatusPayload({
          id: 'wamid.REMINDER',
          status: 'failed',
          timestamp: '1700000000',
          errors: [{ code: 131026, title: 'Message Undeliverable' }],
        }),
      );

      expect(messageLogsRepository.update).toHaveBeenCalledWith(
        { whatsappMessageId: 'wamid.REMINDER' },
        expect.objectContaining({
          deliveryStatus: 'failed',
          lastErrorCode: 131026,
          lastErrorTitle: 'Message Undeliverable',
        }),
      );
    });

    it('is a silent no-op when the WAMID matches neither table', async () => {
      messageLogsRepository.update.mockResolvedValue({ affected: 0 });
      manualRepliesRepository.update.mockResolvedValue({ affected: 0 });

      await expect(
        service.handleIncomingPayload(
          buildStatusPayload({
            id: 'wamid.UNKNOWN',
            status: 'sent',
            timestamp: '1700000000',
          }),
        ),
      ).resolves.toBeUndefined();
    });

    it('never throws when applying a status update fails unexpectedly', async () => {
      messageLogsRepository.update.mockRejectedValue(new Error('DB is down'));

      await expect(
        service.handleIncomingPayload(
          buildStatusPayload({
            id: 'wamid.REMINDER',
            status: 'sent',
            timestamp: '1700000000',
          }),
        ),
      ).resolves.toBeUndefined();
    });

    it('never throws for a malformed statuses payload', async () => {
      await expect(
        service.handleIncomingPayload({
          entry: [{ changes: [{ value: { statuses: 'not-an-array' } }] }],
        }),
      ).resolves.toBeUndefined();
      expect(messageLogsRepository.update).not.toHaveBeenCalled();
      expect(manualRepliesRepository.update).not.toHaveBeenCalled();
    });
  });

  describe('getInboundMedia', () => {
    it('returns the bytes/mimeType fetched fresh from Meta for a message with a metaMediaId', async () => {
      inboundMessagesRepository.findOne.mockResolvedValue({
        id: 'msg-1',
        metaMediaId: 'media-9',
      });
      whatsappMediaService.fetchMediaBytes.mockResolvedValue({
        bytes: Buffer.from('fake-audio-bytes'),
        mimeType: 'audio/ogg',
      });

      const result = await service.getInboundMedia('msg-1');

      expect(whatsappMediaService.fetchMediaBytes).toHaveBeenCalledWith(
        'media-9',
      );
      expect(result).toEqual({
        bytes: Buffer.from('fake-audio-bytes'),
        mimeType: 'audio/ogg',
      });
    });

    it('throws NotFoundException when the message does not exist', async () => {
      inboundMessagesRepository.findOne.mockResolvedValue(null);

      await expect(service.getInboundMedia('missing')).rejects.toThrow(
        NotFoundException,
      );
      expect(whatsappMediaService.fetchMediaBytes).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the message has no metaMediaId (e.g. an image/document/text message)', async () => {
      inboundMessagesRepository.findOne.mockResolvedValue({
        id: 'msg-1',
        metaMediaId: null,
      });

      await expect(service.getInboundMedia('msg-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(whatsappMediaService.fetchMediaBytes).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when Meta no longer has the file', async () => {
      inboundMessagesRepository.findOne.mockResolvedValue({
        id: 'msg-1',
        metaMediaId: 'media-9',
      });
      whatsappMediaService.fetchMediaBytes.mockResolvedValue(null);

      await expect(service.getInboundMedia('msg-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findAll', () => {
    it('returns a paginated result with default page/limit', async () => {
      inboundMessagesRepository.findAndCount.mockResolvedValue([[], 0]);

      const result = await service.findAll({});

      expect(inboundMessagesRepository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {},
          relations: { client: true, payment: { installment: { loan: true } } },
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

    it('filters by fromPhoneNumber for an unrecognized-number conversation', async () => {
      inboundMessagesRepository.findAndCount.mockResolvedValue([[], 0]);

      await service.findAll({ fromPhoneNumber: '573009999999' });

      expect(inboundMessagesRepository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { fromPhoneNumber: In(['+573009999999', '573009999999']) },
        }),
      );
    });

    // Human report, 2026-09-23 — once an admin replied to an unrecognized
    // number, the conversation's number came back "+"-prefixed (from the
    // manual reply) and the thread matched none of the raw inbound rows.
    it('still matches raw inbound rows when fromPhoneNumber is "+"-prefixed', async () => {
      inboundMessagesRepository.findAndCount.mockResolvedValue([[], 0]);

      await service.findAll({ fromPhoneNumber: '+573009999999' });

      expect(inboundMessagesRepository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { fromPhoneNumber: In(['+573009999999', '573009999999']) },
        }),
      );
    });

    it('ignores fromPhoneNumber when clientId is also set', async () => {
      inboundMessagesRepository.findAndCount.mockResolvedValue([[], 0]);

      await service.findAll({
        clientId: 'client-1',
        fromPhoneNumber: '573009999999',
      });

      expect(inboundMessagesRepository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ where: { clientId: 'client-1' } }),
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
      whatsAppService.sendTextMessage.mockResolvedValue({
        sent: true,
        whatsappMessageId: null,
      });
      clientsRepository.findOne.mockResolvedValue(null);

      const result = await service.sendManualReply(
        '573001234567',
        'Hola!',
        'user-1',
      );

      expect(whatsAppService.sendTextMessage).toHaveBeenCalledWith(
        '+573001234567',
        'Hola!',
      );
      expect(result).toBe(true);
    });

    it('leaves an already-normalized number unchanged', async () => {
      whatsAppService.sendTextMessage.mockResolvedValue({
        sent: false,
        whatsappMessageId: null,
      });
      clientsRepository.findOne.mockResolvedValue(null);

      const result = await service.sendManualReply(
        '+573001234567',
        'Hola!',
        'user-1',
      );

      expect(whatsAppService.sendTextMessage).toHaveBeenCalledWith(
        '+573001234567',
        'Hola!',
      );
      expect(result).toBe(false);
    });

    // Human report, 2026-09-19 — used to only send, never persist or push
    // live. See sendManualReply's own doc comment. Persistence/live-push
    // itself now lives in WhatsappOutboundLogService — this only verifies
    // sendManualReply derives and forwards the right params to it.
    it('logs the reply as sent by this admin', async () => {
      whatsAppService.sendTextMessage.mockResolvedValue({
        sent: true,
        whatsappMessageId: null,
      });
      clientsRepository.findOne.mockResolvedValue({ id: 'client-1' });

      await service.sendManualReply('573001234567', 'Hola!', 'user-1');

      expect(whatsappOutboundLogService.log).toHaveBeenCalledWith({
        clientId: 'client-1',
        phoneNumber: '+573001234567',
        messageContent: 'Hola!',
        sentByUserId: 'user-1',
        sent: true,
        whatsappMessageId: null,
      });
    });

    it('logs a failed send with no client, still by this admin', async () => {
      whatsAppService.sendTextMessage.mockResolvedValue({
        sent: false,
        whatsappMessageId: null,
      });
      clientsRepository.findOne.mockResolvedValue(null);

      await service.sendManualReply('573001234567', 'Hola!', 'user-1');

      expect(whatsappOutboundLogService.log).toHaveBeenCalledWith({
        clientId: null,
        phoneNumber: '+573001234567',
        messageContent: 'Hola!',
        sentByUserId: 'user-1',
        sent: false,
        whatsappMessageId: null,
      });
    });

    // Added 2026-09-16 — see WhatsAppService.SendMessageResult's own
    // comment: a manual reply's WAMID must reach whatsapp_manual_replies
    // so a later delivery-status webhook can be correlated back to it.
    it('threads the WAMID through to the logged reply when the send returns one', async () => {
      whatsAppService.sendTextMessage.mockResolvedValue({
        sent: true,
        whatsappMessageId: 'wamid.MANUAL_REPLY',
      });
      clientsRepository.findOne.mockResolvedValue({ id: 'client-1' });

      await service.sendManualReply('573001234567', 'Hola!', 'user-1');

      expect(whatsappOutboundLogService.log).toHaveBeenCalledWith(
        expect.objectContaining({ whatsappMessageId: 'wamid.MANUAL_REPLY' }),
      );
    });
  });

  describe('getManualReplies', () => {
    it('returns every reply, unscoped, when called with no filter', async () => {
      manualRepliesRepository.find.mockResolvedValue([{ id: 'reply-1' }]);

      const result = await service.getManualReplies();

      expect(result).toEqual([{ id: 'reply-1' }]);
      expect(manualRepliesRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: undefined,
          order: { sentAt: 'DESC' },
        }),
      );
    });

    it('scopes to one client by clientId', async () => {
      manualRepliesRepository.find.mockResolvedValue([]);

      await service.getManualReplies({ clientId: 'client-1' });

      expect(manualRepliesRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { clientId: 'client-1' } }),
      );
    });

    it('scopes to one unrecognized-number conversation by fromPhoneNumber, normalized', async () => {
      manualRepliesRepository.find.mockResolvedValue([]);

      await service.getManualReplies({ fromPhoneNumber: '573009999999' });

      expect(manualRepliesRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { phoneNumber: '+573009999999' } }),
      );
    });
  });

  describe('findConversations', () => {
    it('returns one summary per conversation, hydrated and reordered by receivedAt', async () => {
      inboundMessagesRepository.manager.query
        .mockResolvedValueOnce([
          { id: 'msg-2', source: 'inbound_message', message_count: '3' },
          { id: 'msg-1', source: 'inbound_message', message_count: '1' },
        ])
        .mockResolvedValueOnce([{ total: '2' }]);
      // Hydration order deliberately reversed from the raw-query order
      // above — findConversations must re-sort by the id list, not trust
      // In()'s own result order.
      inboundMessagesRepository.find.mockResolvedValue([
        {
          id: 'msg-1',
          clientId: 'client-1',
          fromPhoneNumber: '+573001111111',
          receivedAt: new Date('2026-09-10'),
        },
        {
          id: 'msg-2',
          clientId: null,
          fromPhoneNumber: '573002222222',
          receivedAt: new Date('2026-09-14'),
        },
      ]);

      const result = await service.findConversations({});

      expect(result.items).toEqual([
        expect.objectContaining({
          key: '+573002222222',
          clientId: null,
          fromPhoneNumber: '+573002222222',
          messageCount: 3,
          lastEvent: expect.objectContaining({
            direction: 'inbound',
          }) as unknown,
        }),
        expect.objectContaining({
          key: 'client-1',
          clientId: 'client-1',
          messageCount: 1,
        }),
      ]);
      expect(result.meta).toEqual({
        page: 1,
        limit: 20,
        total: 2,
        totalPages: 1,
      });
    });

    // Human report, 2026-09-16 — the whole point of unioning message_logs
    // in: a client who was only ever SENT a reminder, never replied, has
    // zero whatsapp_inbound_messages rows to anchor a partition on and
    // used to be invisible in this list entirely.
    it('includes a client who was only ever sent a reminder and never replied', async () => {
      inboundMessagesRepository.manager.query
        .mockResolvedValueOnce([
          { id: 'log-1', source: 'message_log', message_count: '1' },
        ])
        .mockResolvedValueOnce([{ total: '1' }]);
      inboundMessagesRepository.find.mockResolvedValue([]);
      messageLogsRepository.find.mockResolvedValue([
        {
          id: 'log-1',
          clientId: 'client-1',
          phoneNumber: '+573001111111',
          messageContent: 'Recuerda tu cuota vencida...',
          status: MessageLogStatus.Sent,
          sentAt: new Date('2026-09-10'),
        },
      ]);

      const result = await service.findConversations({});

      expect(messageLogsRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: expect.anything() as unknown },
        }),
      );
      expect(result.items).toEqual([
        expect.objectContaining({
          key: 'client-1',
          clientId: 'client-1',
          fromPhoneNumber: '+573001111111',
          messageCount: 1,
          lastEvent: {
            direction: 'outbound',
            source: 'message_log',
            id: 'log-1',
            occurredAt: new Date('2026-09-10').toISOString(),
            messageContent: 'Recuerda tu cuota vencida...',
            status: 'sent',
            client: null,
          },
        }),
      ]);
    });

    // Same idea, for a self-service/manual reply the bot or an admin sent
    // to a client who has otherwise gone quiet.
    it('includes a client who was only ever sent a manual/self-service reply and never replied', async () => {
      inboundMessagesRepository.manager.query
        .mockResolvedValueOnce([
          { id: 'reply-1', source: 'manual_reply', message_count: '1' },
        ])
        .mockResolvedValueOnce([{ total: '1' }]);
      inboundMessagesRepository.find.mockResolvedValue([]);
      manualRepliesRepository.find.mockResolvedValue([
        {
          id: 'reply-1',
          clientId: 'client-2',
          phoneNumber: '+573002222222',
          messageContent: 'Hola, bienvenido a IMPROCRÉDITO...',
          status: WhatsappManualReplyStatus.Failed,
          sentAt: new Date('2026-09-11'),
        },
      ]);

      const result = await service.findConversations({});

      expect(result.items).toEqual([
        expect.objectContaining({
          key: 'client-2',
          clientId: 'client-2',
          fromPhoneNumber: '+573002222222',
          lastEvent: expect.objectContaining({
            direction: 'outbound',
            source: 'manual_reply',
            status: 'failed',
          }) as unknown,
        }),
      ]);
    });

    // Human report, 2026-09-23 — closed_at only ever comes back non-null
    // while the closure is newer than the client's latest inbound message
    // (decided in SQL, see buildLatestPerConversationQuery); this just
    // checks it's passed through as an ISO string, or null.
    it("passes each conversation's closedAt through as an ISO string, or null", async () => {
      inboundMessagesRepository.manager.query
        .mockResolvedValueOnce([
          {
            id: 'msg-1',
            source: 'inbound_message',
            message_count: '2',
            closed_at: new Date('2026-09-20T10:00:00Z'),
          },
          {
            id: 'msg-2',
            source: 'inbound_message',
            message_count: '1',
            closed_at: null,
          },
        ])
        .mockResolvedValueOnce([{ total: '2' }]);
      inboundMessagesRepository.find.mockResolvedValue([
        { id: 'msg-1', clientId: 'client-1', fromPhoneNumber: '573001111111' },
        { id: 'msg-2', clientId: null, fromPhoneNumber: '573002222222' },
      ]);

      const result = await service.findConversations({});

      expect(result.items.map((item) => item.closedAt)).toEqual([
        '2026-09-20T10:00:00.000Z',
        null,
      ]);
    });

    it('only treats a closure as current while no inbound message is newer than it', async () => {
      inboundMessagesRepository.manager.query
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ total: '0' }]);

      await service.findConversations({});

      const [sql] = inboundMessagesRepository.manager.query.mock.calls[0] as [
        string,
      ];
      expect(sql).toContain('LEFT JOIN whatsapp_conversation_closures cl');
      expect(sql).toContain('latest.last_inbound_at <= cl.closed_at');
      expect(sql).toContain("FILTER (WHERE source = 'inbound_message')");
    });

    it('passes a null search parameter, not undefined, so Postgres can short-circuit the filter', async () => {
      inboundMessagesRepository.manager.query
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ total: '0' }]);
      inboundMessagesRepository.find.mockResolvedValue([]);

      await service.findConversations({});

      expect(inboundMessagesRepository.manager.query).toHaveBeenCalledWith(
        expect.any(String),
        [null, 20, 0],
      );
    });

    it('wraps the search term in wildcards when provided', async () => {
      inboundMessagesRepository.manager.query
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ total: '0' }]);
      inboundMessagesRepository.find.mockResolvedValue([]);

      await service.findConversations({ search: 'Juana', page: 2, limit: 10 });

      expect(inboundMessagesRepository.manager.query).toHaveBeenCalledWith(
        expect.any(String),
        ['%Juana%', 10, 10],
      );
      expect(inboundMessagesRepository.manager.query).toHaveBeenCalledWith(
        expect.any(String),
        ['%Juana%'],
      );
    });

    // Human report, 2026-09-14 — the "Esperando asesor" queue's exact-set
    // lookup: unpaginated, one query instead of two (no separate count
    // needed — the result set IS the full set), scoped by client_id alone
    // (no unrecognized-number conversation can ever have a ticket).
    it('bypasses search/pagination and returns every requested client, unpaginated', async () => {
      inboundMessagesRepository.manager.query.mockResolvedValueOnce([
        { id: 'msg-1', source: 'inbound_message', message_count: '2' },
      ]);
      inboundMessagesRepository.find.mockResolvedValue([
        {
          id: 'msg-1',
          clientId: 'client-1',
          fromPhoneNumber: '+573001111111',
          receivedAt: new Date('2026-09-10'),
        },
      ]);

      const result = await service.findConversations({
        clientIds: ['client-1', 'client-2'],
        search: 'ignored',
        page: 5,
      });

      expect(inboundMessagesRepository.manager.query).toHaveBeenCalledTimes(1);
      expect(inboundMessagesRepository.manager.query).toHaveBeenCalledWith(
        expect.any(String),
        [['client-1', 'client-2']],
      );
      expect(result.items).toEqual([
        expect.objectContaining({ key: 'client-1', messageCount: 2 }),
      ]);
      expect(result.meta).toEqual({
        page: 1,
        limit: 1,
        total: 1,
        totalPages: 1,
      });
    });
  });

  describe('getDeliveryHealth', () => {
    it('returns the not-blocked default when the client has no outbound history', async () => {
      messageLogsRepository.find.mockResolvedValue([]);
      manualRepliesRepository.find.mockResolvedValue([]);

      const result = await service.getDeliveryHealth('client-1');

      expect(messageLogsRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { clientId: 'client-1' },
          order: { sentAt: 'DESC' },
          take: 5,
        }),
      );
      expect(result).toEqual({
        lastDeliveryStatus: null,
        lastErrorCode: null,
        lastErrorTitle: null,
        possiblyBlocked: false,
      });
    });

    it('merges message_logs and whatsapp_manual_replies by sentAt and flags a likely block', async () => {
      messageLogsRepository.find.mockResolvedValue([
        {
          deliveryStatus: 'failed',
          lastErrorCode: 131026,
          lastErrorTitle: 'Message Undeliverable',
          sentAt: new Date('2026-09-16T10:00:00Z'),
        },
      ]);
      manualRepliesRepository.find.mockResolvedValue([
        {
          deliveryStatus: 'delivered',
          lastErrorCode: null,
          lastErrorTitle: null,
          sentAt: new Date('2026-09-15T10:00:00Z'),
        },
      ]);

      const result = await service.getDeliveryHealth('client-1');

      expect(result).toEqual({
        lastDeliveryStatus: 'failed',
        lastErrorCode: 131026,
        lastErrorTitle: 'Message Undeliverable',
        possiblyBlocked: true,
      });
    });
  });

  describe('getConversationState', () => {
    it('returns null when there is no active conversation state', async () => {
      conversationStateService.getActive.mockResolvedValue(null);

      const result = await service.getConversationState('573001234567');

      expect(conversationStateService.getActive).toHaveBeenCalledWith(
        '+573001234567',
      );
      expect(result).toBeNull();
    });

    it("returns the active state's currentMenu", async () => {
      conversationStateService.getActive.mockResolvedValue({
        currentMenu: 'handed_off_to_human',
      });

      const result = await service.getConversationState('+573001234567');

      expect(result).toBe('handed_off_to_human');
    });
  });

  describe('sendFollowUpTemplate', () => {
    it("sends seguimiento_solicitud with the matched client's full name", async () => {
      whatsAppService.sendTemplateMessage.mockResolvedValue({
        sent: true,
        whatsappMessageId: 'wamid.FOLLOW_UP',
      });
      clientsRepository.findOne.mockResolvedValue({
        id: 'client-1',
        firstName: 'Jhon Alex',
        lastName: 'Castaño',
      });

      const result = await service.sendFollowUpTemplate(
        '573001234567',
        'user-1',
      );

      expect(clientsRepository.findOne).toHaveBeenCalledWith({
        where: [
          { phoneNumber: '+573001234567' },
          { alternatePhoneNumber: '+573001234567' },
        ],
      });
      expect(whatsAppService.sendTemplateMessage).toHaveBeenCalledWith(
        '+573001234567',
        'seguimiento_solicitud',
        'es',
        ['Jhon Alex Castaño'],
      );
      expect(whatsAppService.sendTextMessage).not.toHaveBeenCalled();
      expect(whatsappOutboundLogService.log).toHaveBeenCalledWith({
        clientId: 'client-1',
        phoneNumber: '+573001234567',
        messageContent:
          'Cordial saludo, Jhon Alex Castaño.\n\n' +
          'Seguimos atentos a su solicitud con IMPROCRÉDITO. Por favor, respóndanos a este mensaje para que un asesor pueda continuar ayudándole. 🤝',
        sentByUserId: 'user-1',
        sent: true,
        whatsappMessageId: 'wamid.FOLLOW_UP',
      });
      expect(result).toBe(true);
    });

    it('greets an unrecognized number as Señor(a) and still logs it', async () => {
      whatsAppService.sendTemplateMessage.mockResolvedValue({
        sent: true,
        whatsappMessageId: null,
      });
      clientsRepository.findOne.mockResolvedValue(null);

      await service.sendFollowUpTemplate('+573001234567', 'user-1');

      expect(whatsAppService.sendTemplateMessage).toHaveBeenCalledWith(
        '+573001234567',
        'seguimiento_solicitud',
        'es',
        ['Señor(a)'],
      );
      expect(whatsappOutboundLogService.log).toHaveBeenCalledWith(
        expect.objectContaining({ clientId: null, sentByUserId: 'user-1' }),
      );
    });

    it('logs a failed send and returns false', async () => {
      whatsAppService.sendTemplateMessage.mockResolvedValue({
        sent: false,
        whatsappMessageId: null,
      });
      clientsRepository.findOne.mockResolvedValue(null);

      const result = await service.sendFollowUpTemplate(
        '+573001234567',
        'user-1',
      );

      expect(whatsappOutboundLogService.log).toHaveBeenCalledWith(
        expect.objectContaining({ sent: false }),
      );
      expect(result).toBe(false);
    });
  });

  describe('closeConversation', () => {
    // Human report, 2026-09-23 — the closing message only goes out while
    // the client is still waiting on an advisor they asked for.
    const awaitingAdvisor = () => {
      clientsRepository.findOne.mockResolvedValue({ id: 'client-1' });
      conversationTicketService.findByClientId.mockResolvedValue({
        clientId: 'client-1',
        status: WhatsappTicketStatus.Pending,
        triggerKind: WhatsappTicketTriggerKind.AdvisorRequested,
      });
    };

    it('sends the closing message and clears the conversation state', async () => {
      awaitingAdvisor();
      whatsAppService.sendTextMessage.mockResolvedValue({
        sent: true,
        whatsappMessageId: null,
      });

      const result = await service.closeConversation('573001234567');

      expect(whatsAppService.sendTextMessage).toHaveBeenCalledWith(
        '+573001234567',
        expect.stringContaining('Gracias'),
      );
      expect(conversationStateService.clear).toHaveBeenCalledWith(
        '+573001234567',
      );
      expect(result).toBe(true);
    });

    it('still clears state even when the closing message fails to send', async () => {
      awaitingAdvisor();
      whatsAppService.sendTextMessage.mockResolvedValue({
        sent: false,
        whatsappMessageId: null,
      });

      const result = await service.closeConversation('+573001234567');

      expect(conversationStateService.clear).toHaveBeenCalledWith(
        '+573001234567',
      );
      expect(result).toBe(false);
    });

    // Human report, 2026-09-19 — this closing message used to leave no
    // trace in the conversation thread. sentByUserId is null: the admin
    // only triggered it, they didn't type this fixed message themselves.
    it('logs the closing message with no admin attribution', async () => {
      awaitingAdvisor();
      whatsAppService.sendTextMessage.mockResolvedValue({
        sent: true,
        whatsappMessageId: null,
      });

      await service.closeConversation('573001234567');

      expect(whatsappOutboundLogService.log).toHaveBeenCalledWith({
        clientId: 'client-1',
        phoneNumber: '+573001234567',
        messageContent: expect.stringContaining('Gracias') as unknown,
        sentByUserId: null,
        sent: true,
        whatsappMessageId: null,
      });
    });

    // Human report, 2026-09-13 — closing IS resolving: an admin explicitly
    // closing the conversation clears the client's pending ticket, if any.
    it('resolves the pending ticket for the matched client', async () => {
      whatsAppService.sendTextMessage.mockResolvedValue({
        sent: true,
        whatsappMessageId: null,
      });
      clientsRepository.findOne.mockResolvedValue({ id: 'client-1' });

      await service.closeConversation('573001234567');

      expect(conversationTicketService.resolve).toHaveBeenCalledWith(
        'client-1',
      );
    });

    it('still resolves the ticket even when the closing message fails to send', async () => {
      awaitingAdvisor();
      whatsAppService.sendTextMessage.mockResolvedValue({
        sent: false,
        whatsappMessageId: null,
      });

      await service.closeConversation('573001234567');

      expect(conversationTicketService.resolve).toHaveBeenCalledWith(
        'client-1',
      );
    });

    it('does not try to resolve a ticket when the phone number matches no client', async () => {
      whatsAppService.sendTextMessage.mockResolvedValue({
        sent: true,
        whatsappMessageId: null,
      });
      clientsRepository.findOne.mockResolvedValue(null);

      await service.closeConversation('573001234567');

      expect(conversationTicketService.resolve).not.toHaveBeenCalled();
    });

    // Human report, 2026-09-13 — resolving a ticket doesn't require the
    // client-facing message, e.g. once the 24h session window has already
    // closed and a real send would just fail outright.
    describe('when the client is not waiting on an advisor they asked for', () => {
      it('sends nothing for a client with no ticket at all', async () => {
        clientsRepository.findOne.mockResolvedValue({ id: 'client-1' });

        const result = await service.closeConversation('573001234567');

        expect(whatsAppService.sendTextMessage).not.toHaveBeenCalled();
        expect(whatsappOutboundLogService.log).not.toHaveBeenCalled();
        expect(result).toBe(false);
      });

      it('sends nothing for an unrecognized number', async () => {
        clientsRepository.findOne.mockResolvedValue(null);

        await service.closeConversation('573001234567');

        expect(whatsAppService.sendTextMessage).not.toHaveBeenCalled();
        expect(conversationTicketService.findByClientId).not.toHaveBeenCalled();
      });

      it('sends nothing once the advisor request was already resolved', async () => {
        clientsRepository.findOne.mockResolvedValue({ id: 'client-1' });
        conversationTicketService.findByClientId.mockResolvedValue({
          clientId: 'client-1',
          status: WhatsappTicketStatus.Resolved,
          triggerKind: WhatsappTicketTriggerKind.AdvisorRequested,
        });

        await service.closeConversation('573001234567');

        expect(whatsAppService.sendTextMessage).not.toHaveBeenCalled();
      });

      it.each([
        WhatsappTicketTriggerKind.ReceiptImage,
        WhatsappTicketTriggerKind.ReceiptDocument,
        WhatsappTicketTriggerKind.FreeText,
      ])('sends nothing for a pending %s ticket', async (triggerKind) => {
        clientsRepository.findOne.mockResolvedValue({ id: 'client-1' });
        conversationTicketService.findByClientId.mockResolvedValue({
          clientId: 'client-1',
          status: WhatsappTicketStatus.Pending,
          triggerKind,
        });

        await service.closeConversation('573001234567');

        expect(whatsAppService.sendTextMessage).not.toHaveBeenCalled();
      });

      it('still clears state, records the closure and resolves the ticket', async () => {
        clientsRepository.findOne.mockResolvedValue({ id: 'client-1' });

        await service.closeConversation('573001234567');

        expect(conversationStateService.clear).toHaveBeenCalledWith(
          '+573001234567',
        );
        expect(closuresRepository.upsert).toHaveBeenCalled();
        expect(conversationTicketService.resolve).toHaveBeenCalledWith(
          'client-1',
        );
      });
    });

    // Human report, 2026-09-23 — any conversation can be closed now, not
    // only one with a hand-off ticket; keyed like findConversations'
    // contact_key so the list can join it back onto the right row.
    it("records the closure under the matched client's id", async () => {
      clientsRepository.findOne.mockResolvedValue({ id: 'client-1' });

      await service.closeConversation('573001234567', false);

      expect(closuresRepository.upsert).toHaveBeenCalledWith(
        { contactKey: 'client-1', closedAt: expect.any(Date) as unknown },
        ['contactKey'],
      );
      expect(whatsappInboundGateway.emitConversationUpdate).toHaveBeenCalled();
    });

    it('records the closure under the normalized phone number for an unrecognized one', async () => {
      clientsRepository.findOne.mockResolvedValue(null);

      await service.closeConversation('573001234567', false);

      expect(closuresRepository.upsert).toHaveBeenCalledWith(
        {
          contactKey: '+573001234567',
          closedAt: expect.any(Date) as unknown,
        },
        ['contactKey'],
      );
    });

    describe('sendClosingMessage: false', () => {
      it('skips sending the closing message entirely, even for a client awaiting an advisor', async () => {
        awaitingAdvisor();
        const result = await service.closeConversation('573001234567', false);

        expect(whatsAppService.sendTextMessage).not.toHaveBeenCalled();
        expect(result).toBe(false);
      });

      it('still clears state and resolves the ticket', async () => {
        clientsRepository.findOne.mockResolvedValue({ id: 'client-1' });

        await service.closeConversation('573001234567', false);

        expect(conversationStateService.clear).toHaveBeenCalledWith(
          '+573001234567',
        );
        expect(conversationTicketService.resolve).toHaveBeenCalledWith(
          'client-1',
        );
      });

      it('does not log a phantom closing-message send', async () => {
        clientsRepository.findOne.mockResolvedValue({ id: 'client-1' });

        await service.closeConversation('573001234567', false);

        expect(whatsappOutboundLogService.log).not.toHaveBeenCalled();
      });
    });
  });
});
