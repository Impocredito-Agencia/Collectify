import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { Configuration } from '../config/configuration';

import { BrevoErrorBody, mapBrevoError } from './brevoErrors';
import {
  BrevoAccountInfo,
  BrevoChannel,
  BrevoSendFailureReason,
  BrevoSendResult,
  BrevoStatus,
  SendEmailInput,
  SendSmsInput,
} from './brevoTypes';

const BREVO_API_BASE_URL = 'https://api.brevo.com/v3';
const REQUEST_TIMEOUT_MS = 15_000;

// Fixed on purpose: the panel can't send free-form text through Brevo.
// GSM-7 only and well under 160 characters, so a test SMS always costs
// exactly one credit.
export const TEST_EMAIL_SUBJECT = 'Prueba de envío de Collectify';
export const TEST_EMAIL_TEXT =
  'Este es un correo de prueba enviado desde el panel de Collectify. Si lo recibió, el envío de correos funciona correctamente.';
export const TEST_SMS_CONTENT =
  'Collectify: este es un SMS de prueba. Si lo recibio, el envio de SMS funciona correctamente.';

interface BrevoPlanItem {
  type?: unknown;
  credits?: unknown;
}

// Phase 36 — wraps Brevo's REST API v3 for the email and SMS channels, the
// same way WhatsAppService wraps Meta's. Never throws on a send: every
// skipped or failed send comes back as a BrevoSendResult. The safety
// switches (per-channel pause + test allowlist) are checked before
// credentials and before any network call. See
// docs/phases/PHASE_36_BREVO_EMAIL_SMS.md.
@Injectable()
export class BrevoService {
  private readonly logger = new Logger(BrevoService.name);

  constructor(
    private readonly configService: ConfigService<Configuration, true>,
  ) {}

  async sendEmail(input: SendEmailInput): Promise<BrevoSendResult> {
    const { apiKey, senderEmail, senderName, emailSendingPaused } =
      this.configService.get('brevo', { infer: true });
    const recipient = input.to.trim().toLowerCase();

    const skipped = this.checkCanSend({
      channel: BrevoChannel.Email,
      recipient,
      paused: emailSendingPaused,
      configured: Boolean(apiKey && senderEmail),
    });
    if (skipped) {
      return skipped;
    }

    const attachments = input.attachments ?? [];
    const invalidAttachment = attachments.find(
      (attachment) =>
        !attachment.name.trim() ||
        !/\.[a-z0-9]+$/i.test(attachment.name.trim()) ||
        Boolean(attachment.content) === Boolean(attachment.url),
    );
    if (invalidAttachment) {
      this.logger.error(
        `Invalid attachment "${invalidAttachment.name}" for email to ${recipient} — needs a file name with extension and either content or url.`,
      );
      return this.skippedResult(
        BrevoSendFailureReason.Rejected,
        `Invalid attachment "${invalidAttachment.name}": it needs a file name with its extension and either content or url, not both.`,
      );
    }

    return this.post(
      '/smtp/email',
      apiKey,
      {
        sender: senderName
          ? { email: senderEmail, name: senderName }
          : { email: senderEmail },
        to: [{ email: recipient }],
        subject: input.subject,
        htmlContent: input.htmlContent,
        textContent: input.textContent,
        ...(attachments.length > 0 && {
          attachment: attachments.map((attachment) =>
            attachment.content
              ? {
                  name: attachment.name.trim(),
                  content: attachment.content.toString('base64'),
                }
              : { name: attachment.name.trim(), url: attachment.url },
          ),
        }),
      },
      attachments.length > 0
        ? `email to ${recipient} (${attachments.length} attachment(s))`
        : `email to ${recipient}`,
    );
  }

  async sendSms(input: SendSmsInput): Promise<BrevoSendResult> {
    const { apiKey, smsSender, smsSendingPaused } = this.configService.get(
      'brevo',
      { infer: true },
    );

    const skipped = this.checkCanSend({
      channel: BrevoChannel.Sms,
      recipient: input.to,
      paused: smsSendingPaused,
      configured: Boolean(apiKey && smsSender),
    });
    if (skipped) {
      return skipped;
    }

    return this.post(
      '/transactionalSMS/send',
      apiKey,
      {
        sender: smsSender,
        // Brevo wants the country code without the leading "+".
        recipient: input.to.replace(/^\+/, ''),
        content: input.content,
        type: 'transactional',
      },
      `SMS to ${input.to}`,
    );
  }

  sendTestMessage(channel: BrevoChannel, to: string): Promise<BrevoSendResult> {
    if (channel === BrevoChannel.Sms) {
      return this.sendSms({ to, content: TEST_SMS_CONTENT });
    }
    return this.sendEmail({
      to,
      subject: TEST_EMAIL_SUBJECT,
      htmlContent: `<p>${TEST_EMAIL_TEXT}</p>`,
      textContent: TEST_EMAIL_TEXT,
    });
  }

  async getAccountInfo(): Promise<BrevoAccountInfo> {
    const { apiKey } = this.configService.get('brevo', { infer: true });
    if (!apiKey) {
      return {
        available: false,
        failureReason: BrevoSendFailureReason.NotConfigured,
        errorMessage: 'BREVO_API_KEY is not configured.',
      };
    }

    try {
      const response = await fetch(`${BREVO_API_BASE_URL}/account`, {
        method: 'GET',
        headers: { 'api-key': apiKey, Accept: 'application/json' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        const { failureReason, errorMessage } = mapBrevoError(
          response.status,
          await this.readErrorBody(response),
        );
        this.logger.error(
          `Brevo account lookup failed with ${response.status}: ${errorMessage}`,
        );
        return { available: false, failureReason, errorMessage };
      }

      const data = (await response.json()) as { plan?: BrevoPlanItem[] };
      return { available: true, ...this.parsePlans(data.plan ?? []) };
    } catch (error) {
      this.logger.error('Brevo account lookup failed', error);
      return {
        available: false,
        failureReason: BrevoSendFailureReason.NetworkError,
        errorMessage: 'Could not reach Brevo.',
      };
    }
  }

  async getStatus(): Promise<BrevoStatus> {
    const config = this.configService.get('brevo', { infer: true });
    const apiKeyConfigured = Boolean(config.apiKey);

    return {
      apiKeyConfigured,
      email: {
        configured: apiKeyConfigured && Boolean(config.senderEmail),
        sendingPaused: config.emailSendingPaused,
        sender: config.senderEmail || null,
      },
      sms: {
        configured: apiKeyConfigured && Boolean(config.smsSender),
        sendingPaused: config.smsSendingPaused,
        sender: config.smsSender || null,
      },
      testRecipientsCount: config.testRecipients.length,
      account: await this.getAccountInfo(),
    };
  }

  // Returns the skip result when the send must not go out, or null when it
  // may proceed.
  private checkCanSend(params: {
    channel: BrevoChannel;
    recipient: string;
    paused: boolean;
    configured: boolean;
  }): BrevoSendResult | null {
    const { testRecipients } = this.configService.get('brevo', {
      infer: true,
    });
    const variable =
      params.channel === BrevoChannel.Sms
        ? 'BREVO_SMS_SENDING_PAUSED'
        : 'BREVO_EMAIL_SENDING_PAUSED';

    if (params.paused && !testRecipients.includes(params.recipient)) {
      this.logger.warn(
        `Brevo ${params.channel} sending is paused (${variable}) — skipping send to ${params.recipient}.`,
      );
      return this.skippedResult(
        BrevoSendFailureReason.Paused,
        `${variable} is on and this recipient is not in BREVO_TEST_RECIPIENTS.`,
      );
    }

    if (!params.configured) {
      this.logger.warn(
        `Brevo ${params.channel} is not configured — skipping send to ${params.recipient}. ` +
          'See docs/ENVIRONMENT_VARIABLES.md.',
      );
      return this.skippedResult(
        BrevoSendFailureReason.NotConfigured,
        params.channel === BrevoChannel.Sms
          ? 'BREVO_API_KEY or BREVO_SMS_SENDER is not configured.'
          : 'BREVO_API_KEY or BREVO_SENDER_EMAIL is not configured.',
      );
    }

    return null;
  }

  private async post(
    path: string,
    apiKey: string,
    body: Record<string, unknown>,
    description: string,
  ): Promise<BrevoSendResult> {
    try {
      const response = await fetch(`${BREVO_API_BASE_URL}${path}`, {
        method: 'POST',
        headers: {
          'api-key': apiKey,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!response.ok) {
        const { failureReason, errorMessage } = mapBrevoError(
          response.status,
          await this.readErrorBody(response),
        );
        this.logger.error(
          `Brevo responded with ${response.status} for ${description}: ${errorMessage}`,
        );
        return this.skippedResult(failureReason, errorMessage);
      }

      const data = (await response.json()) as { messageId?: unknown };
      const providerMessageId =
        typeof data.messageId === 'string' || typeof data.messageId === 'number'
          ? String(data.messageId)
          : null;
      return {
        sent: true,
        providerMessageId,
        failureReason: null,
        errorMessage: null,
      };
    } catch (error) {
      this.logger.error(`Failed to send Brevo ${description}`, error);
      return this.skippedResult(
        BrevoSendFailureReason.NetworkError,
        'Could not reach Brevo.',
      );
    }
  }

  private async readErrorBody(
    response: Response,
  ): Promise<BrevoErrorBody | null> {
    try {
      return (await response.json()) as BrevoErrorBody;
    } catch {
      return null;
    }
  }

  private parsePlans(
    plans: BrevoPlanItem[],
  ): Omit<Extract<BrevoAccountInfo, { available: true }>, 'available'> {
    const credits = (plan: BrevoPlanItem | undefined): number | null =>
      typeof plan?.credits === 'number' ? plan.credits : null;
    const smsPlan = plans.find((plan) => plan.type === 'sms');
    const mainPlan = plans.find(
      (plan) => typeof plan.type === 'string' && plan.type !== 'sms',
    );

    return {
      planType: typeof mainPlan?.type === 'string' ? mainPlan.type : null,
      emailCredits: credits(mainPlan),
      smsCredits: credits(smsPlan),
    };
  }

  private skippedResult(
    failureReason: BrevoSendFailureReason,
    errorMessage: string,
  ): BrevoSendResult {
    return {
      sent: false,
      providerMessageId: null,
      failureReason,
      errorMessage,
    };
  }
}
