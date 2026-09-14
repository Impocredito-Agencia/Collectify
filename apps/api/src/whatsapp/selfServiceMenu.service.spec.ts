import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { Client } from '../clients/entities/client.entity';
import { Installment } from '../loans/entities/installment.entity';
import { LoanInstallmentConcept } from '../loans/entities/loanInstallmentConcept.entity';
import { Payment } from '../loans/entities/payment.entity';

import { isWithinBusinessHours } from './businessHours';
import { ConversationMenu } from './entities/whatsappConversationState.entity';
import { WhatsappTicketTriggerKind } from './entities/whatsappConversationTicket.entity';
import { MessageLog } from './entities/messageLog.entity';
import { MessageLogItem } from './entities/messageLogItem.entity';
import { WhatsappInboundMessageType } from './entities/whatsappInboundMessage.entity';
import { SelfServiceReplyKind } from './entities/whatsappManualReply.entity';
import { SelfServiceMenuService } from './selfServiceMenu.service';
import {
  SelfServiceMenuButtonId,
  TemplateButtonPayload,
} from './selfServiceMenuPayloads';
import { ParsedInboundEvent } from './webhook/extractInboundEvents';
import { WhatsappConversationStateService } from './whatsappConversationState.service';
import { WhatsappConversationTicketService } from './whatsappConversationTicket.service';
import { WhatsAppService } from './whatsapp.service';
import { WhatsappOutboundLogService } from './whatsappOutboundLog.service';

// Human report, 2026-09-13 — handOffToAdvisor/handlePossibleReceipt now
// pick their message body based on isWithinBusinessHours(), which reads
// the real system clock by default. Auto-mocked so every test below runs
// deterministically regardless of when it's actually executed.
jest.mock('./businessHours');

const mockIsWithinBusinessHours = isWithinBusinessHours as jest.Mock;

describe('SelfServiceMenuService', () => {
  let service: SelfServiceMenuService;
  let installmentsRepository: { find: jest.Mock };
  let paymentsRepository: { find: jest.Mock };
  let loanInstallmentConceptsRepository: { find: jest.Mock };
  let messageLogsRepository: { findOne: jest.Mock };
  let messageLogItemsRepository: { find: jest.Mock };
  let conversationStateService: {
    getActive: jest.Mock;
    upsert: jest.Mock;
    clear: jest.Mock;
  };
  let whatsAppService: {
    sendTextMessage: jest.Mock;
    sendInteractiveButtonsMessage: jest.Mock;
  };
  let whatsappOutboundLogService: { log: jest.Mock };
  let conversationTicketService: { openOrReopen: jest.Mock };

  const client: Client = {
    id: 'client-1',
    firstName: 'Juan',
    lastName: 'Pérez',
    phoneNumber: '+573001234567',
  } as Client;

  function textEvent(bodyText: string): ParsedInboundEvent {
    return {
      fromPhoneNumber: client.phoneNumber,
      type: WhatsappInboundMessageType.Text,
      buttonPayload: null,
      bodyText,
      contextMessageId: null,
      mediaId: null,
      receivedAt: new Date(),
      rawPayload: {},
    };
  }

  function buttonEvent(
    buttonPayload: string,
    contextMessageId: string | null = null,
  ): ParsedInboundEvent {
    return {
      fromPhoneNumber: client.phoneNumber,
      type: WhatsappInboundMessageType.Button,
      buttonPayload,
      bodyText: null,
      contextMessageId,
      mediaId: null,
      receivedAt: new Date(),
      rawPayload: {},
    };
  }

  function otherEvent(
    type: WhatsappInboundMessageType = WhatsappInboundMessageType.Other,
  ): ParsedInboundEvent {
    return {
      fromPhoneNumber: client.phoneNumber,
      type,
      buttonPayload: null,
      bodyText: null,
      contextMessageId: null,
      mediaId: null,
      receivedAt: new Date(),
      rawPayload: {},
    };
  }

  beforeEach(async () => {
    // Default to "within business hours" so every pre-existing test's
    // message-content assertions (e.g. expect.stringContaining('asesor'))
    // keep matching the normal-hours copy without having to touch them —
    // only the new tests below explicitly flip this to test the other copy.
    mockIsWithinBusinessHours.mockReturnValue(true);
    installmentsRepository = { find: jest.fn().mockResolvedValue([]) };
    paymentsRepository = { find: jest.fn().mockResolvedValue([]) };
    // Bug fix, 2026-09-08 — see breakdownQueries.ts's own comment.
    loanInstallmentConceptsRepository = {
      find: jest.fn().mockResolvedValue([]),
    };
    messageLogsRepository = { findOne: jest.fn().mockResolvedValue(null) };
    messageLogItemsRepository = { find: jest.fn().mockResolvedValue([]) };
    conversationStateService = {
      getActive: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue(undefined),
      clear: jest.fn().mockResolvedValue(undefined),
    };
    whatsAppService = {
      sendTextMessage: jest.fn().mockResolvedValue(true),
      sendInteractiveButtonsMessage: jest.fn().mockResolvedValue(true),
    };
    whatsappOutboundLogService = {
      log: jest.fn().mockResolvedValue(undefined),
    };
    conversationTicketService = {
      openOrReopen: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SelfServiceMenuService,
        {
          provide: getRepositoryToken(Installment),
          useValue: installmentsRepository,
        },
        { provide: getRepositoryToken(Payment), useValue: paymentsRepository },
        {
          provide: getRepositoryToken(LoanInstallmentConcept),
          useValue: loanInstallmentConceptsRepository,
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
          provide: WhatsappConversationStateService,
          useValue: conversationStateService,
        },
        {
          provide: WhatsappConversationTicketService,
          useValue: conversationTicketService,
        },
        { provide: WhatsAppService, useValue: whatsAppService },
        {
          provide: WhatsappOutboundLogService,
          useValue: whatsappOutboundLogService,
        },
      ],
    }).compile();

    service = module.get<SelfServiceMenuService>(SelfServiceMenuService);
  });

  describe('free text', () => {
    it('sends the main menu and creates state when there is no active conversation', async () => {
      await service.handleInboundEvent(textEvent('hola'), client);

      expect(
        whatsAppService.sendInteractiveButtonsMessage,
      ).toHaveBeenCalledWith(
        client.phoneNumber,
        expect.any(String),
        expect.arrayContaining([
          expect.objectContaining({ id: SelfServiceMenuButtonId.MiCuenta }),
        ]),
      );
      expect(conversationStateService.upsert).toHaveBeenCalledWith(
        client.phoneNumber,
        client.id,
        ConversationMenu.Main,
      );
      // Human report, 2026-09-14 — this is the client's very first message
      // (no active state yet), before they've ever seen a menu — doesn't
      // count as "ignoring the menu" yet, see FreeText's own comment.
      expect(conversationTicketService.openOrReopen).not.toHaveBeenCalled();
    });

    // Human report, 2026-09-19 — every automated reply this menu sends
    // must be logged (see WhatsappOutboundLogService), with no admin
    // attribution since the bot composed and sent it. Covers both the
    // interactive-buttons path (this one) and the plain-text path (the
    // "Más información"/breakdown test further below) rather than
    // asserting it on all nine call sites individually.
    it('logs the main menu send with no admin attribution', async () => {
      await service.handleInboundEvent(textEvent('hola'), client);

      expect(whatsappOutboundLogService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          clientId: client.id,
          phoneNumber: client.phoneNumber,
          sentByUserId: null,
          sent: true,
          selfServiceReplyKind: SelfServiceReplyKind.MainMenu,
        }),
      );
    });

    it('re-sends the submenu when free text arrives while on the submenu', async () => {
      conversationStateService.getActive.mockResolvedValue({
        currentMenu: ConversationMenu.MiCuentaSubmenu,
      });

      await service.handleInboundEvent(textEvent('qué'), client);

      expect(
        whatsAppService.sendInteractiveButtonsMessage,
      ).toHaveBeenCalledWith(
        client.phoneNumber,
        expect.any(String),
        expect.arrayContaining([
          expect.objectContaining({ id: SelfServiceMenuButtonId.EstadoCuenta }),
        ]),
      );
      expect(conversationStateService.upsert).toHaveBeenCalledWith(
        client.phoneNumber,
        client.id,
        ConversationMenu.MiCuentaSubmenu,
      );
      // Human report, 2026-09-14 — the client already got a menu (this
      // state wouldn't exist otherwise) and is still typing free text
      // instead of tapping a button.
      expect(conversationTicketService.openOrReopen).toHaveBeenCalledWith(
        client.id,
        WhatsappTicketTriggerKind.FreeText,
      );
    });

    it('stays silent when free text arrives while awaiting a receipt', async () => {
      conversationStateService.getActive.mockResolvedValue({
        currentMenu: ConversationMenu.AwaitingReceipt,
      });

      await service.handleInboundEvent(textEvent('ya casi'), client);

      expect(whatsAppService.sendTextMessage).not.toHaveBeenCalled();
      expect(
        whatsAppService.sendInteractiveButtonsMessage,
      ).not.toHaveBeenCalled();
      expect(conversationStateService.upsert).not.toHaveBeenCalled();
      expect(conversationTicketService.openOrReopen).not.toHaveBeenCalled();
    });

    it('stays silent when free text arrives after being handed off to a human', async () => {
      conversationStateService.getActive.mockResolvedValue({
        currentMenu: ConversationMenu.HandedOffToHuman,
      });

      await service.handleInboundEvent(textEvent('hola?'), client);

      expect(whatsAppService.sendTextMessage).not.toHaveBeenCalled();
      expect(
        whatsAppService.sendInteractiveButtonsMessage,
      ).not.toHaveBeenCalled();
      expect(conversationStateService.upsert).not.toHaveBeenCalled();
      expect(conversationTicketService.openOrReopen).not.toHaveBeenCalled();
    });
  });

  describe('button payloads', () => {
    it('sends the submenu and advances state on Mi cuenta', async () => {
      await service.handleInboundEvent(
        buttonEvent(SelfServiceMenuButtonId.MiCuenta),
        client,
      );

      expect(conversationStateService.upsert).toHaveBeenCalledWith(
        client.phoneNumber,
        client.id,
        ConversationMenu.MiCuentaSubmenu,
      );
    });

    it('resets to the main menu on Volver al menú from the submenu', async () => {
      await service.handleInboundEvent(
        buttonEvent(SelfServiceMenuButtonId.VolverAlMenu),
        client,
      );

      expect(conversationStateService.upsert).toHaveBeenCalledWith(
        client.phoneNumber,
        client.id,
        ConversationMenu.Main,
      );
    });

    it.each([
      SelfServiceMenuButtonId.ReportarPago,
      TemplateButtonPayload.YaPague,
    ])('starts the receipt flow on %s', async (payload) => {
      await service.handleInboundEvent(buttonEvent(payload), client);

      expect(whatsAppService.sendTextMessage).toHaveBeenCalledWith(
        client.phoneNumber,
        expect.stringContaining('comprobante'),
      );
      expect(conversationStateService.upsert).toHaveBeenCalledWith(
        client.phoneNumber,
        client.id,
        ConversationMenu.AwaitingReceipt,
      );
    });

    it('hands off to an advisor on Hablar con asesor, with no Volver al menú', async () => {
      // No template carries a "Hablar con asesor" button (confirmed
      // 2026-09-03) — only the self-service menu's own main menu does.
      await service.handleInboundEvent(
        buttonEvent(SelfServiceMenuButtonId.HablarAsesor),
        client,
      );

      expect(whatsAppService.sendTextMessage).toHaveBeenCalledWith(
        client.phoneNumber,
        expect.stringContaining('asesor'),
      );
      expect(
        whatsAppService.sendInteractiveButtonsMessage,
      ).not.toHaveBeenCalled();
      expect(conversationStateService.upsert).toHaveBeenCalledWith(
        client.phoneNumber,
        client.id,
        ConversationMenu.HandedOffToHuman,
      );
      expect(conversationTicketService.openOrReopen).toHaveBeenCalledWith(
        client.id,
        WhatsappTicketTriggerKind.AdvisorRequested,
      );
    });

    // Human report, 2026-09-13 — see businessHours.ts.
    it('sends the out-of-hours copy on Hablar con asesor outside business hours', async () => {
      mockIsWithinBusinessHours.mockReturnValue(false);

      await service.handleInboundEvent(
        buttonEvent(SelfServiceMenuButtonId.HablarAsesor),
        client,
      );

      expect(whatsAppService.sendTextMessage).toHaveBeenCalledWith(
        client.phoneNumber,
        expect.stringContaining('fuera de nuestro horario de atención'),
      );
      // Still hands off exactly the same as within business hours — only
      // the copy changes.
      expect(conversationStateService.upsert).toHaveBeenCalledWith(
        client.phoneNumber,
        client.id,
        ConversationMenu.HandedOffToHuman,
      );
    });

    it.each([
      SelfServiceMenuButtonId.EstadoCuenta,
      SelfServiceMenuButtonId.CuotasPendientes,
      TemplateButtonPayload.MasInformacion,
    ])(
      'sends the breakdown with a Volver al menú follow-up on %s',
      async (payload) => {
        installmentsRepository.find.mockResolvedValue([]);

        await service.handleInboundEvent(buttonEvent(payload), client);

        expect(installmentsRepository.find).toHaveBeenCalled();
        expect(whatsAppService.sendTextMessage).toHaveBeenCalledWith(
          client.phoneNumber,
          expect.stringContaining('Juan Pérez'),
        );
        expect(
          whatsAppService.sendInteractiveButtonsMessage,
        ).toHaveBeenCalledWith(
          client.phoneNumber,
          expect.any(String),
          expect.arrayContaining([
            expect.objectContaining({
              id: SelfServiceMenuButtonId.VolverAlMenu,
            }),
          ]),
        );
        expect(conversationStateService.clear).toHaveBeenCalledWith(
          client.phoneNumber,
        );
        // Human report, 2026-09-19 — covers the plain-text sendText path
        // (the interactive-buttons path is covered by the main-menu test
        // above).
        expect(whatsappOutboundLogService.log).toHaveBeenCalledWith(
          expect.objectContaining({
            clientId: client.id,
            messageContent: expect.stringContaining('Juan Pérez') as unknown,
            sentByUserId: null,
            sent: true,
            selfServiceReplyKind: SelfServiceReplyKind.Breakdown,
          }),
        );
      },
    );

    // Bug fix, 2026-09-19 (human report): "Más información" worked on two
    // of the three templates that carry it but not a third — traced to a
    // casing typo on just that one template's button text in Meta's
    // console. This exercises the exact failure mode: a payload that
    // differs from TemplateButtonPayload.MasInformacion only by case
    // must still resolve to the same action, not fall through to the
    // "Unrecognized" no-op.
    it('matches a button payload case-insensitively (Meta config typo on one template)', async () => {
      installmentsRepository.find.mockResolvedValue([]);

      await service.handleInboundEvent(buttonEvent('Más Información'), client);

      expect(whatsAppService.sendTextMessage).toHaveBeenCalledWith(
        client.phoneNumber,
        expect.stringContaining('Juan Pérez'),
      );
    });

    // Bug fix, 2026-09-03 (human report): "Más información" must answer
    // only about the pagaré/installment(s) the tapped reminder was
    // actually about, not the client's whole account.
    describe('Más información (scoped to the tapped reminder)', () => {
      it('replies with only the reminder-scoped installments when the context id correlates to a MessageLog', async () => {
        messageLogsRepository.findOne.mockResolvedValue({
          id: 'log-1',
          clientId: client.id,
        });
        messageLogItemsRepository.find.mockResolvedValue([
          { installmentId: 'installment-1' },
        ]);
        installmentsRepository.find.mockResolvedValue([
          {
            id: 'installment-1',
            installmentNumber: 3,
            amount: 300000,
            dueDate: '2020-01-01',
            status: 'pending',
            loan: { promissoryNoteNumber: '743' },
          },
        ]);

        await service.handleInboundEvent(
          buttonEvent(TemplateButtonPayload.MasInformacion, 'wamid.REMINDER'),
          client,
        );

        expect(messageLogsRepository.findOne).toHaveBeenCalledWith({
          where: { whatsappMessageId: 'wamid.REMINDER', clientId: client.id },
        });
        expect(messageLogItemsRepository.find).toHaveBeenCalledWith({
          where: { messageLogId: 'log-1' },
        });
        const [installmentsWhere] = installmentsRepository.find.mock
          .calls[0] as [{ where: { id: unknown } }];
        expect(installmentsWhere.where).not.toHaveProperty('status');
        expect(whatsAppService.sendTextMessage).toHaveBeenCalledWith(
          client.phoneNumber,
          expect.stringContaining('Pagaré #743'),
        );
      });

      it('falls back to the full account breakdown when no MessageLog matches the context id', async () => {
        messageLogsRepository.findOne.mockResolvedValue(null);
        installmentsRepository.find.mockResolvedValue([]);

        await service.handleInboundEvent(
          buttonEvent(TemplateButtonPayload.MasInformacion, 'wamid.UNKNOWN'),
          client,
        );

        expect(messageLogItemsRepository.find).not.toHaveBeenCalled();
        const [installmentsWhere] = installmentsRepository.find.mock
          .calls[0] as [{ where: { status: unknown } }];
        expect(installmentsWhere.where).toHaveProperty('status');
      });

      it('falls back to the full account breakdown when the correlated MessageLog has no items', async () => {
        messageLogsRepository.findOne.mockResolvedValue({
          id: 'log-1',
          clientId: client.id,
        });
        messageLogItemsRepository.find.mockResolvedValue([]);
        installmentsRepository.find.mockResolvedValue([]);

        await service.handleInboundEvent(
          buttonEvent(TemplateButtonPayload.MasInformacion, 'wamid.EMPTY'),
          client,
        );

        const [installmentsWhere] = installmentsRepository.find.mock
          .calls[0] as [{ where: { status: unknown } }];
        expect(installmentsWhere.where).toHaveProperty('status');
      });
    });

    it('sends the payment history with a Volver al menú follow-up on Historial de pagos', async () => {
      paymentsRepository.find.mockResolvedValue([]);

      await service.handleInboundEvent(
        buttonEvent(SelfServiceMenuButtonId.HistorialPagos),
        client,
      );

      expect(paymentsRepository.find).toHaveBeenCalled();
      expect(whatsAppService.sendTextMessage).toHaveBeenCalledWith(
        client.phoneNumber,
        expect.stringContaining('Juan Pérez'),
      );
      expect(whatsAppService.sendInteractiveButtonsMessage).toHaveBeenCalled();
    });

    it('logs and does nothing for an unrecognized payload', async () => {
      await service.handleInboundEvent(
        buttonEvent('some_unknown_payload'),
        client,
      );

      expect(whatsAppService.sendTextMessage).not.toHaveBeenCalled();
      expect(
        whatsAppService.sendInteractiveButtonsMessage,
      ).not.toHaveBeenCalled();
      expect(conversationStateService.upsert).not.toHaveBeenCalled();
      expect(conversationStateService.clear).not.toHaveBeenCalled();
    });
  });

  describe('other (media/document) events', () => {
    it('confirms and hands off to a human when a receipt arrives while awaiting one', async () => {
      conversationStateService.getActive.mockResolvedValue({
        currentMenu: ConversationMenu.AwaitingReceipt,
      });

      await service.handleInboundEvent(
        otherEvent(WhatsappInboundMessageType.Image),
        client,
      );

      expect(whatsAppService.sendTextMessage).toHaveBeenCalledWith(
        client.phoneNumber,
        expect.stringContaining('Recibimos tu comprobante'),
      );
      expect(conversationStateService.upsert).toHaveBeenCalledWith(
        client.phoneNumber,
        client.id,
        ConversationMenu.HandedOffToHuman,
      );
      expect(conversationTicketService.openOrReopen).toHaveBeenCalledWith(
        client.id,
        WhatsappTicketTriggerKind.ReceiptImage,
      );
    });

    // Human report, 2026-09-13 — see businessHours.ts.
    it('sends the out-of-hours copy when a receipt arrives outside business hours', async () => {
      mockIsWithinBusinessHours.mockReturnValue(false);
      conversationStateService.getActive.mockResolvedValue({
        currentMenu: ConversationMenu.AwaitingReceipt,
      });

      await service.handleInboundEvent(
        otherEvent(WhatsappInboundMessageType.Image),
        client,
      );

      expect(whatsAppService.sendTextMessage).toHaveBeenCalledWith(
        client.phoneNumber,
        expect.stringContaining('fuera de nuestro horario de atención'),
      );
      // Still hands off exactly the same as within business hours.
      expect(conversationStateService.upsert).toHaveBeenCalledWith(
        client.phoneNumber,
        client.id,
        ConversationMenu.HandedOffToHuman,
      );
    });

    it('does nothing when media arrives with no active receipt-flow state', async () => {
      await service.handleInboundEvent(otherEvent(), client);

      expect(whatsAppService.sendTextMessage).not.toHaveBeenCalled();
      expect(conversationTicketService.openOrReopen).not.toHaveBeenCalled();
    });

    it('does nothing when media arrives while on a different menu', async () => {
      conversationStateService.getActive.mockResolvedValue({
        currentMenu: ConversationMenu.Main,
      });

      await service.handleInboundEvent(otherEvent(), client);

      expect(whatsAppService.sendTextMessage).not.toHaveBeenCalled();
    });

    it('does nothing when media arrives after already being handed off to a human', async () => {
      conversationStateService.getActive.mockResolvedValue({
        currentMenu: ConversationMenu.HandedOffToHuman,
      });

      await service.handleInboundEvent(otherEvent(), client);

      expect(whatsAppService.sendTextMessage).not.toHaveBeenCalled();
      expect(conversationStateService.upsert).not.toHaveBeenCalled();
    });

    // Human report, 2026-09-13 — an image/document the client sends
    // WITHOUT going through "Reportar un pago" first still flags a ticket,
    // silently (no automated reply, no menu-state change).
    it.each([
      [
        WhatsappInboundMessageType.Image,
        WhatsappTicketTriggerKind.ReceiptImage,
      ],
      [
        WhatsappInboundMessageType.Document,
        WhatsappTicketTriggerKind.ReceiptDocument,
      ],
    ])(
      'silently opens a ticket for an unprompted %s with no active state',
      async (type, expectedTriggerKind) => {
        await service.handleInboundEvent(otherEvent(type), client);

        expect(whatsAppService.sendTextMessage).not.toHaveBeenCalled();
        expect(conversationStateService.upsert).not.toHaveBeenCalled();
        expect(conversationTicketService.openOrReopen).toHaveBeenCalledWith(
          client.id,
          expectedTriggerKind,
        );
      },
    );

    it('does not open a ticket for an unprompted media type outside image/document', async () => {
      await service.handleInboundEvent(
        otherEvent(WhatsappInboundMessageType.Audio),
        client,
      );

      expect(conversationTicketService.openOrReopen).not.toHaveBeenCalled();
    });
  });
});
