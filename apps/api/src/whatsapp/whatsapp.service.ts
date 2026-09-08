import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { Configuration } from '../config/configuration';

export interface WhatsAppInteractiveButton {
  id: string;
  title: string;
}

export interface SendTemplateMessageResult {
  sent: boolean;
  // Meta's WAMID for this send, null when not sent (or on the rare case
  // the API accepted the send but omitted it). See sendTemplateMessage.
  whatsappMessageId: string | null;
}

const META_GRAPH_API_VERSION = 'v21.0';
const MAX_INTERACTIVE_BUTTONS = 3;

@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);

  constructor(
    private readonly configService: ConfigService<Configuration, true>,
  ) {}

  // Returns whether the message was actually sent. Never throws — a failed
  // or skipped send is a business outcome (logged in MessageLog), not an
  // application error.
  async sendTextMessage(
    phoneNumber: string,
    message: string,
  ): Promise<boolean> {
    const {
      phoneNumberId,
      accessToken,
      sendingPaused,
      testRecipients = [],
    } = this.configService.get('whatsapp', { infer: true });

    if (sendingPaused && !testRecipients.includes(phoneNumber)) {
      this.logger.warn(
        `WhatsApp sending is paused (WHATSAPP_SENDING_PAUSED) — skipping send to ${phoneNumber}.`,
      );
      return false;
    }

    if (!phoneNumberId || !accessToken) {
      this.logger.warn(
        `WhatsApp credentials are not configured — skipping send to ${phoneNumber}. ` +
          'See docs/ENVIRONMENT_VARIABLES.md.',
      );
      return false;
    }

    try {
      const response = await fetch(
        `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${phoneNumberId}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: phoneNumber,
            type: 'text',
            text: { body: message },
          }),
        },
      );

      if (!response.ok) {
        const errorBody = await response.text();
        this.logger.error(
          `WhatsApp API responded with ${response.status} for ${phoneNumber}: ${errorBody}`,
        );
        return false;
      }

      return true;
    } catch (error) {
      this.logger.error(
        `Failed to send WhatsApp message to ${phoneNumber}`,
        error,
      );
      return false;
    }
  }

  // Added Phase 33 — the real Meta Template Messages call. Required for any
  // business-initiated send outside an open 24h session window, which is
  // every cron-triggered reminder and every synchronous send this system
  // makes (sendTextMessage above only works inside an open window, e.g. a
  // manual reply to a client who just messaged in). bodyParameters must be
  // in the exact {{1}}, {{2}}... order the template was approved with — see
  // docs/phases/PHASE_33_MESSAGE_TEMPLATES_V2.md for each template's order.
  // None of this catalog's templates need dynamic button components at
  // send time (every button — Quick Reply or the one static URL button —
  // was configured with a fixed value when the template was created in
  // Meta), so this only ever sends a single "body" component.
  async sendTemplateMessage(
    phoneNumber: string,
    templateName: string,
    languageCode: string,
    bodyParameters: string[],
  ): Promise<SendTemplateMessageResult> {
    const {
      phoneNumberId,
      accessToken,
      sendingPaused,
      testRecipients = [],
    } = this.configService.get('whatsapp', { infer: true });

    if (sendingPaused && !testRecipients.includes(phoneNumber)) {
      this.logger.warn(
        `WhatsApp sending is paused (WHATSAPP_SENDING_PAUSED) — skipping template send to ${phoneNumber} (template ${templateName}).`,
      );
      return { sent: false, whatsappMessageId: null };
    }

    if (!phoneNumberId || !accessToken) {
      this.logger.warn(
        `WhatsApp credentials are not configured — skipping send to ${phoneNumber}. ` +
          'See docs/ENVIRONMENT_VARIABLES.md.',
      );
      return { sent: false, whatsappMessageId: null };
    }

    try {
      const response = await fetch(
        `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${phoneNumberId}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: phoneNumber,
            type: 'template',
            template: {
              name: templateName,
              language: { code: languageCode },
              components: [
                {
                  type: 'body',
                  parameters: bodyParameters.map((text) => ({
                    type: 'text',
                    text,
                  })),
                },
              ],
            },
          }),
        },
      );

      if (!response.ok) {
        const errorBody = await response.text();
        this.logger.error(
          `WhatsApp API responded with ${response.status} for ${phoneNumber} (template ${templateName}): ${errorBody}`,
        );
        return { sent: false, whatsappMessageId: null };
      }

      // Bug fix, 2026-09-03: needed so a later "Más información" button
      // tap (which arrives with `context.id` set to this WAMID) can be
      // traced back to exactly which reminder — and which installments —
      // it was replying to, instead of falling back to the client's whole
      // account. See SelfServiceMenuService.sendBreakdownForContext.
      const data = (await response.json()) as {
        messages?: { id?: string }[];
      };
      const whatsappMessageId = data.messages?.[0]?.id ?? null;

      return { sent: true, whatsappMessageId };
    } catch (error) {
      this.logger.error(
        `Failed to send WhatsApp template message to ${phoneNumber} (template ${templateName})`,
        error,
      );
      return { sent: false, whatsappMessageId: null };
    }
  }

  // Added Phase 34 — the self-service menu's Reply Buttons (main menu,
  // "Mi cuenta" submenu, the "Volver al menú" follow-up). A session
  // message like sendTextMessage (only reaches the client inside an
  // already-open 24h window, no Meta approval needed), but WhatsApp
  // requires a distinct `type: "interactive"` request shape to attach
  // tappable buttons — see docs/phases/PHASE_34_INTERACTIVE_MENU.md.
  async sendInteractiveButtonsMessage(
    phoneNumber: string,
    bodyText: string,
    buttons: WhatsAppInteractiveButton[],
  ): Promise<boolean> {
    const {
      phoneNumberId,
      accessToken,
      sendingPaused,
      testRecipients = [],
    } = this.configService.get('whatsapp', { infer: true });

    if (sendingPaused && !testRecipients.includes(phoneNumber)) {
      this.logger.warn(
        `WhatsApp sending is paused (WHATSAPP_SENDING_PAUSED) — skipping interactive send to ${phoneNumber}.`,
      );
      return false;
    }

    if (!phoneNumberId || !accessToken) {
      this.logger.warn(
        `WhatsApp credentials are not configured — skipping send to ${phoneNumber}. ` +
          'See docs/ENVIRONMENT_VARIABLES.md.',
      );
      return false;
    }

    if (buttons.length === 0 || buttons.length > MAX_INTERACTIVE_BUTTONS) {
      this.logger.error(
        `Interactive message to ${phoneNumber} must have between 1 and ${MAX_INTERACTIVE_BUTTONS} buttons, got ${buttons.length}`,
      );
      return false;
    }

    try {
      const response = await fetch(
        `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${phoneNumberId}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: phoneNumber,
            type: 'interactive',
            interactive: {
              type: 'button',
              body: { text: bodyText },
              action: {
                buttons: buttons.map((button) => ({
                  type: 'reply',
                  reply: { id: button.id, title: button.title },
                })),
              },
            },
          }),
        },
      );

      if (!response.ok) {
        const errorBody = await response.text();
        this.logger.error(
          `WhatsApp API responded with ${response.status} for ${phoneNumber} (interactive buttons): ${errorBody}`,
        );
        return false;
      }

      return true;
    } catch (error) {
      this.logger.error(
        `Failed to send WhatsApp interactive buttons message to ${phoneNumber}`,
        error,
      );
      return false;
    }
  }
}
