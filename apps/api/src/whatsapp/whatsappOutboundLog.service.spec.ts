import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import {
  SelfServiceReplyKind,
  WhatsappManualReply,
  WhatsappManualReplyStatus,
} from './entities/whatsappManualReply.entity';
import { WhatsappInboundGateway } from './webhook/whatsappInbound.gateway';
import { WhatsappOutboundLogService } from './whatsappOutboundLog.service';

describe('WhatsappOutboundLogService', () => {
  let service: WhatsappOutboundLogService;
  let manualRepliesRepository: { create: jest.Mock; save: jest.Mock };
  let whatsappInboundGateway: { emitManualReply: jest.Mock };

  beforeEach(async () => {
    manualRepliesRepository = {
      create: jest.fn((data: Record<string, unknown>) => data),
      save: jest.fn((data: Record<string, unknown>) =>
        Promise.resolve({ id: 'reply-1', ...data }),
      ),
    };
    whatsappInboundGateway = { emitManualReply: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WhatsappOutboundLogService,
        {
          provide: getRepositoryToken(WhatsappManualReply),
          useValue: manualRepliesRepository,
        },
        { provide: WhatsappInboundGateway, useValue: whatsappInboundGateway },
      ],
    }).compile();

    service = module.get<WhatsappOutboundLogService>(
      WhatsappOutboundLogService,
    );
  });

  it('persists a sent message and pushes it live via the gateway', async () => {
    const saved = await service.log({
      clientId: 'client-1',
      phoneNumber: '+573001234567',
      messageContent: 'Hola, aquí está tu recordatorio.',
      sentByUserId: null,
      sent: true,
    });

    expect(manualRepliesRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: 'client-1',
        phoneNumber: '+573001234567',
        messageContent: 'Hola, aquí está tu recordatorio.',
        sentByUserId: null,
        status: WhatsappManualReplyStatus.Sent,
      }),
    );
    expect(whatsappInboundGateway.emitManualReply).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'reply-1' }),
    );
    expect(saved.id).toBe('reply-1');
  });

  it('persists a failed send with status "failed", still pushed live', async () => {
    await service.log({
      clientId: null,
      phoneNumber: '+573001234567',
      messageContent: 'No debería haber llegado.',
      sentByUserId: null,
      sent: false,
    });

    expect(manualRepliesRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: WhatsappManualReplyStatus.Failed }),
    );
    expect(whatsappInboundGateway.emitManualReply).toHaveBeenCalled();
  });

  // An admin's typed reply sets sentByUserId; every other caller
  // (SelfServiceMenuService, WhatsappWebhookService.closeConversation)
  // passes null — see the entity's own doc comment on how the two are
  // told apart on the frontend.
  it('forwards a non-null sentByUserId for an admin-typed reply', async () => {
    await service.log({
      clientId: 'client-1',
      phoneNumber: '+573001234567',
      messageContent: 'Ya recibimos tu comprobante.',
      sentByUserId: 'user-1',
      sent: true,
    });

    expect(manualRepliesRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ sentByUserId: 'user-1' }),
    );
  });

  // Human report, 2026-09-13 — tags which self-service action produced
  // the reply, when it was one — see SelfServiceReplyKind's own comment.
  it('forwards selfServiceReplyKind when the caller passes one', async () => {
    await service.log({
      clientId: 'client-1',
      phoneNumber: '+573001234567',
      messageContent: 'Aquí tienes el menú principal.',
      sentByUserId: null,
      sent: true,
      selfServiceReplyKind: SelfServiceReplyKind.MainMenu,
    });

    expect(manualRepliesRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        selfServiceReplyKind: SelfServiceReplyKind.MainMenu,
      }),
    );
  });

  it('defaults selfServiceReplyKind to null when the caller omits it', async () => {
    await service.log({
      clientId: 'client-1',
      phoneNumber: '+573001234567',
      messageContent: 'Un admin escribió esto.',
      sentByUserId: 'user-1',
      sent: true,
    });

    expect(manualRepliesRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ selfServiceReplyKind: null }),
    );
  });
});
