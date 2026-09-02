import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { Configuration } from '../config/configuration';

const META_GRAPH_API_VERSION = 'v21.0';

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
    const { phoneNumberId, accessToken } = this.configService.get('whatsapp', {
      infer: true,
    });

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
  ): Promise<boolean> {
    const { phoneNumberId, accessToken } = this.configService.get('whatsapp', {
      infer: true,
    });

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
        return false;
      }

      return true;
    } catch (error) {
      this.logger.error(
        `Failed to send WhatsApp template message to ${phoneNumber} (template ${templateName})`,
        error,
      );
      return false;
    }
  }
}
