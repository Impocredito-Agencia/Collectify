import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Client } from '../clients/entities/client.entity';
import { Installment } from '../loans/entities/installment.entity';
import { LoanInstallmentConcept } from '../loans/entities/loanInstallmentConcept.entity';
import { Payment } from '../loans/entities/payment.entity';

import {
  findInstallmentsBreakdownByIds,
  findPaymentHistoryForClient,
  findPendingInstallmentsBreakdown,
} from './breakdownQueries';
import { ConversationMenu } from './entities/whatsappConversationState.entity';
import { MessageLog } from './entities/messageLog.entity';
import { MessageLogItem } from './entities/messageLogItem.entity';
import { WhatsappInboundMessageType } from './entities/whatsappInboundMessage.entity';
import { AccountSummaryInstallmentForMessage } from './messageRenderer';
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
    // Bug fix, 2026-09-08 — see breakdownQueries.ts's own comment.
    @InjectRepository(LoanInstallmentConcept)
    private readonly loanInstallmentConceptsRepository: Repository<LoanInstallmentConcept>,
    @InjectRepository(MessageLog)
    private readonly messageLogsRepository: Repository<MessageLog>,
    @InjectRepository(MessageLogItem)
    private readonly messageLogItemsRepository: Repository<MessageLogItem>,
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
      await this.handleButtonPayload(event.buttonPayload, client, event);
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
  // (our own ids) and TemplateButtonPayload (Meta's real button text —
  // see selfServiceMenuPayloads.ts) are two different types, several of
  // them mapping to the same terminal action. No template carries a
  // "Hablar con asesor" button — only the self-service menu's own main
  // menu does (SelfServiceMenuButtonId.HablarAsesor).
  private buttonActionFor(
    payload: string,
  ):
    ((client: Client, event: ParsedInboundEvent) => Promise<void>) | undefined {
    const actions: Record<
      string,
      (client: Client, event: ParsedInboundEvent) => Promise<void>
    > = {
      [SelfServiceMenuButtonId.MiCuenta]: (c) => this.sendMiCuentaSubmenu(c),
      [SelfServiceMenuButtonId.ReportarPago]: (c) => this.startReceiptFlow(c),
      [TemplateButtonPayload.YaPague]: (c) => this.startReceiptFlow(c),
      [SelfServiceMenuButtonId.HablarAsesor]: (c) => this.handOffToAdvisor(c),
      [SelfServiceMenuButtonId.EstadoCuenta]: (c) => this.sendBreakdown(c),
      [SelfServiceMenuButtonId.CuotasPendientes]: (c) => this.sendBreakdown(c),
      // Bug fix, 2026-09-03 (human report): "Más información" replies with
      // just the pagaré/installment(s) the tapped reminder was about,
      // traced via event.contextMessageId — not the client's whole
      // account (that's what EstadoCuenta/CuotasPendientes above are for).
      [TemplateButtonPayload.MasInformacion]: (c, e) =>
        this.sendBreakdownForContext(c, e.contextMessageId),
      [SelfServiceMenuButtonId.HistorialPagos]: (c) =>
        this.sendPaymentHistory(c),
      [SelfServiceMenuButtonId.VolverAlMenu]: (c) => this.sendMainMenu(c),
    };

    // Bug fix, 2026-09-19 (human report) — "Más información" worked on
    // two of the three templates that carry it but silently did nothing
    // on the third. Each template's Quick Reply button text is typed by
    // hand, per template, in Meta's own Business Manager console — a
    // one-off casing/whitespace slip on just that one template's button
    // fell outside this dictionary's exact-match lookup while its
    // correctly-typed siblings kept matching fine. Matched
    // case-insensitively and trimmed so a config-side typo like that
    // can't silently swallow a button tap again.
    const normalizedPayload = payload.trim().toLowerCase();
    const match = Object.entries(actions).find(
      ([key]) => key.trim().toLowerCase() === normalizedPayload,
    );
    return match?.[1];
  }

  private async handleButtonPayload(
    payload: string,
    client: Client,
    event: ParsedInboundEvent,
  ): Promise<void> {
    const action = this.buttonActionFor(payload);
    if (!action) {
      // Shouldn't happen for a real template/menu button anymore now that
      // TemplateButtonPayload holds Meta's confirmed real values — logged
      // rather than silently dropped in case Meta's config ever drifts
      // from this file.
      this.logger.warn(`Unrecognized WhatsApp button payload: ${payload}`);
      return;
    }
    await action(client, event);
  }

  private async handleFreeText(client: Client): Promise<void> {
    const state = await this.conversationStateService.getActive(
      client.phoneNumber,
    );

    if (!state) {
      await this.sendMainMenu(client);
      return;
    }

    // Bug fix (2026-09-02): AwaitingReceipt/HandedOffToHuman mean a human
    // needs to take this over — the bot must stay completely silent on
    // further free text (previously it kept re-sending the receipt prompt,
    // or — for HandedOffToHuman, back when handOffToAdvisor cleared state
    // instead of setting it — re-triggered the main menu). It stays silent
    // until an admin explicitly closes the conversation from the panel
    // (WhatsappWebhookService.closeConversation), which clears this state.
    if (
      state.currentMenu === ConversationMenu.AwaitingReceipt ||
      state.currentMenu === ConversationMenu.HandedOffToHuman
    ) {
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
    // Hands off to a human for review — see the ConversationMenu doc
    // comment. No further automated replies fire for this number until an
    // admin closes the conversation.
    await this.conversationStateService.upsert(
      client.phoneNumber,
      client.id,
      ConversationMenu.HandedOffToHuman,
    );
  }

  private async resendCurrentMenu(
    client: Client,
    menu: ConversationMenu,
  ): Promise<void> {
    switch (menu) {
      case ConversationMenu.MiCuentaSubmenu:
        await this.sendMiCuentaSubmenu(client);
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
    // Hands off to a human — see the ConversationMenu doc comment. No
    // further automated replies fire for this number until an admin closes
    // the conversation.
    await this.conversationStateService.upsert(
      client.phoneNumber,
      client.id,
      ConversationMenu.HandedOffToHuman,
    );
  }

  private async sendBreakdown(client: Client): Promise<void> {
    const installments = await findPendingInstallmentsBreakdown(
      this.installmentsRepository,
      this.paymentsRepository,
      this.loanInstallmentConceptsRepository,
      client.id,
    );
    const clientFullName = `${client.firstName} ${client.lastName}`;

    await this.whatsAppService.sendTextMessage(
      client.phoneNumber,
      renderBreakdownMessage(clientFullName, installments),
    );
    await this.sendVolverAlMenuFollowUp(client);
  }

  // Bug fix, 2026-09-03 (human report): "Más información" on a reminder
  // should only answer about the pagaré/installment(s) that reminder was
  // actually about — not the client's whole account (sendBreakdown above).
  // Falls back to the full account breakdown when the tap can't be traced
  // back to a specific reminder (no context id on the webhook event, or no
  // matching MessageLog — e.g. a very old message, or credentials weren't
  // configured for it so it was never actually a real send), rather than
  // replying with nothing.
  private async sendBreakdownForContext(
    client: Client,
    contextMessageId: string | null,
  ): Promise<void> {
    const scoped = contextMessageId
      ? await this.findScopedBreakdown(client.id, contextMessageId)
      : null;

    if (!scoped) {
      await this.sendBreakdown(client);
      return;
    }

    const clientFullName = `${client.firstName} ${client.lastName}`;
    // Human report, 2026-09-19 — always show the actual breakdown here,
    // never the "estás al día" shortcut: the client tapped "Más
    // información" on a specific reminder (which may have been entirely
    // about upcoming, not-yet-overdue cuotas — e.g.
    // varias_cuota_proxima_vencer), so they already know these cuotas
    // exist. See renderBreakdownMessage's own doc comment.
    await this.whatsAppService.sendTextMessage(
      client.phoneNumber,
      renderBreakdownMessage(clientFullName, scoped, {
        alwaysShowBreakdown: true,
      }),
    );
    await this.sendVolverAlMenuFollowUp(client);
  }

  private async findScopedBreakdown(
    clientId: string,
    contextMessageId: string,
  ): Promise<AccountSummaryInstallmentForMessage[] | null> {
    const messageLog = await this.messageLogsRepository.findOne({
      where: { whatsappMessageId: contextMessageId, clientId },
    });
    if (!messageLog) {
      return null;
    }

    const items = await this.messageLogItemsRepository.find({
      where: { messageLogId: messageLog.id },
    });
    if (items.length === 0) {
      return null;
    }

    return findInstallmentsBreakdownByIds(
      this.installmentsRepository,
      this.paymentsRepository,
      this.loanInstallmentConceptsRepository,
      items.map((item) => item.installmentId),
    );
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
