import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Client } from '../clients/entities/client.entity';
import { Installment } from '../loans/entities/installment.entity';
import { Payment } from '../loans/entities/payment.entity';

import {
  findPaymentHistoryForClient,
  findPendingInstallmentsBreakdown,
} from './breakdownQueries';
import { ConversationMenu } from './entities/whatsappConversationState.entity';
import { WhatsappInboundMessageType } from './entities/whatsappInboundMessage.entity';
import {
  ADVISOR_HANDOFF_MESSAGE,
  MAIN_MENU_BODY,
  MAIN_MENU_BUTTONS,
  MI_CUENTA_SUBMENU_BODY,
  MI_CUENTA_SUBMENU_BUTTONS,
  RECEIPT_RECEIVED_MESSAGE,
  RECEIPT_REQUEST_MESSAGE,
  VOLVER_AL_MENU_BUTTONS,
  VOLVER_FOLLOW_UP_BODY,
  renderBreakdownMessage,
  renderPaymentHistoryMessage,
} from './selfServiceMenuMessages';
import {
  SelfServiceMenuButtonId,
  TemplateButtonPayload,
} from './selfServiceMenuPayloads';
import { ParsedInboundEvent } from './webhook/extractInboundEvents';
import { WhatsappConversationStateService } from './whatsappConversationState.service';
import { WhatsAppService } from './whatsapp.service';

// Phase 34 — dispatches one already-persisted inbound WhatsApp event to the
// self-service menu, for a KNOWN client only. An unrecognized phone number
// is still logged by WhatsappWebhookService (Phase 22) but gets no
// automated reply here — every action below needs a clientId to look
// anything up, and Phase 22's own "what to do with an unprompted message
// from an unknown number" open question is still unresolved. See
// docs/phases/PHASE_34_INTERACTIVE_MENU.md.
@Injectable()
export class SelfServiceMenuService {
  private readonly logger = new Logger(SelfServiceMenuService.name);

  constructor(
    @InjectRepository(Installment)
    private readonly installmentsRepository: Repository<Installment>,
    @InjectRepository(Payment)
    private readonly paymentsRepository: Repository<Payment>,
    private readonly conversationStateService: WhatsappConversationStateService,
    private readonly whatsAppService: WhatsAppService,
  ) {}

  async handleInboundEvent(
    event: ParsedInboundEvent,
    client: Client,
  ): Promise<void> {
    if (
      event.type === WhatsappInboundMessageType.Button &&
      event.buttonPayload
    ) {
      await this.handleButtonPayload(event.buttonPayload, client);
      return;
    }

    if (event.type === WhatsappInboundMessageType.Text) {
      await this.handleFreeText(client);
      return;
    }

    // Other (image/document/etc.) — the only thing this menu reacts to is
    // a receipt arriving while the client was asked for one.
    await this.handlePossibleReceipt(client);
  }

  // Keyed by payload string rather than a switch/case: SelfServiceMenuButtonId
  // (our own ids) and TemplateButtonPayload (Meta's, still placeholders —
  // see selfServiceMenuPayloads.ts) are two different types, several of
  // them mapping to the same terminal action.
  private buttonActionFor(
    payload: string,
  ): ((client: Client) => Promise<void>) | undefined {
    const actions: Record<string, (client: Client) => Promise<void>> = {
      [SelfServiceMenuButtonId.MiCuenta]: (c) => this.sendMiCuentaSubmenu(c),
      [SelfServiceMenuButtonId.ReportarPago]: (c) => this.startReceiptFlow(c),
      [TemplateButtonPayload.YaPague]: (c) => this.startReceiptFlow(c),
      [SelfServiceMenuButtonId.HablarAsesor]: (c) => this.handOffToAdvisor(c),
      [TemplateButtonPayload.HablarConAsesor]: (c) => this.handOffToAdvisor(c),
      [SelfServiceMenuButtonId.EstadoCuenta]: (c) => this.sendBreakdown(c),
      [SelfServiceMenuButtonId.CuotasPendientes]: (c) => this.sendBreakdown(c),
      [TemplateButtonPayload.VerMisCuotas]: (c) => this.sendBreakdown(c),
      [SelfServiceMenuButtonId.HistorialPagos]: (c) =>
        this.sendPaymentHistory(c),
      [SelfServiceMenuButtonId.VolverAlMenu]: (c) => this.sendMainMenu(c),
    };
    return actions[payload];
  }

  private async handleButtonPayload(
    payload: string,
    client: Client,
  ): Promise<void> {
    const action = this.buttonActionFor(payload);
    if (!action) {
      // Covers the still-placeholder TemplateButtonPayload values (see
      // selfServiceMenuPayloads.ts) — logged, not silently dropped, so
      // it's visible once real templates start delivering taps.
      this.logger.warn(`Unrecognized WhatsApp button payload: ${payload}`);
      return;
    }
    await action(client);
  }

  private async handleFreeText(client: Client): Promise<void> {
    const state = await this.conversationStateService.getActive(
      client.phoneNumber,
    );

    if (!state) {
      await this.sendMainMenu(client);
      return;
    }

    // Per docs/phases/PHASE_34_INTERACTIVE_MENU.md's "Resolved"
    // (2026-09-01): a stray message while a menu is active re-sends that
    // same menu rather than falling back to the main menu.
    await this.resendCurrentMenu(client, state.currentMenu);
  }

  private async handlePossibleReceipt(client: Client): Promise<void> {
    const state = await this.conversationStateService.getActive(
      client.phoneNumber,
    );

    if (state?.currentMenu !== ConversationMenu.AwaitingReceipt) {
      return;
    }

    await this.whatsAppService.sendTextMessage(
      client.phoneNumber,
      RECEIPT_RECEIVED_MESSAGE,
    );
    await this.conversationStateService.clear(client.phoneNumber);
  }

  private async resendCurrentMenu(
    client: Client,
    menu: ConversationMenu,
  ): Promise<void> {
    switch (menu) {
      case ConversationMenu.MiCuentaSubmenu:
        await this.sendMiCuentaSubmenu(client);
        return;
      case ConversationMenu.AwaitingReceipt:
        await this.whatsAppService.sendTextMessage(
          client.phoneNumber,
          RECEIPT_REQUEST_MESSAGE,
        );
        return;
      case ConversationMenu.Main:
      default:
        await this.sendMainMenu(client);
    }
  }

  private async sendMainMenu(client: Client): Promise<void> {
    await this.whatsAppService.sendInteractiveButtonsMessage(
      client.phoneNumber,
      MAIN_MENU_BODY,
      MAIN_MENU_BUTTONS,
    );
    await this.conversationStateService.upsert(
      client.phoneNumber,
      client.id,
      ConversationMenu.Main,
    );
  }

  private async sendMiCuentaSubmenu(client: Client): Promise<void> {
    await this.whatsAppService.sendInteractiveButtonsMessage(
      client.phoneNumber,
      MI_CUENTA_SUBMENU_BODY,
      MI_CUENTA_SUBMENU_BUTTONS,
    );
    await this.conversationStateService.upsert(
      client.phoneNumber,
      client.id,
      ConversationMenu.MiCuentaSubmenu,
    );
  }

  private async startReceiptFlow(client: Client): Promise<void> {
    await this.whatsAppService.sendTextMessage(
      client.phoneNumber,
      RECEIPT_REQUEST_MESSAGE,
    );
    await this.conversationStateService.upsert(
      client.phoneNumber,
      client.id,
      ConversationMenu.AwaitingReceipt,
    );
  }

  // TODO(docs/phases/PHASE_34_INTERACTIVE_MENU.md open question): admin
  // notification for "Hablar con asesor" is, for now, "visible in the
  // existing inbound inbox, no separate channel" — the inbound event that
  // triggered this is already pushed live via WhatsappInboundGateway
  // (Phase 22). Revisit if the human wants a dedicated alert instead.
  private async handOffToAdvisor(client: Client): Promise<void> {
    await this.whatsAppService.sendTextMessage(
      client.phoneNumber,
      ADVISOR_HANDOFF_MESSAGE,
    );
    await this.conversationStateService.clear(client.phoneNumber);
  }

  private async sendBreakdown(client: Client): Promise<void> {
    const installments = await findPendingInstallmentsBreakdown(
      this.installmentsRepository,
      client.id,
    );
    const clientFullName = `${client.firstName} ${client.lastName}`;

    await this.whatsAppService.sendTextMessage(
      client.phoneNumber,
      renderBreakdownMessage(clientFullName, installments),
    );
    await this.sendVolverAlMenuFollowUp(client);
  }

  private async sendPaymentHistory(client: Client): Promise<void> {
    const payments = await findPaymentHistoryForClient(
      this.paymentsRepository,
      client.id,
    );
    const clientFullName = `${client.firstName} ${client.lastName}`;

    await this.whatsAppService.sendTextMessage(
      client.phoneNumber,
      renderPaymentHistoryMessage(clientFullName, payments),
    );
    await this.sendVolverAlMenuFollowUp(client);
  }

  private async sendVolverAlMenuFollowUp(client: Client): Promise<void> {
    await this.whatsAppService.sendInteractiveButtonsMessage(
      client.phoneNumber,
      VOLVER_FOLLOW_UP_BODY,
      VOLVER_AL_MENU_BUTTONS,
    );
    // A breakdown/history view isn't itself a "screen" with its own
    // currentMenu — clearing state here means a stray text after it falls
    // through to the main menu (handleFreeText's "no state" branch), and a
    // "Volver al menú" tap routes through the button-payload handler
    // directly to sendMainMenu regardless. Same net behavior either way,
    // clearing is simpler than inventing a value for it.
    await this.conversationStateService.clear(client.phoneNumber);
  }
}
