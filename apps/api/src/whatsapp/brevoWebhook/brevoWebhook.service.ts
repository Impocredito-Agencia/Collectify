import { createHash, timingSafeEqual } from 'crypto';

import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { Client } from '../../clients/entities/client.entity';
import { Configuration } from '../../config/configuration';
import { MessageLog } from '../entities/messageLog.entity';
import { MessageChannel } from '../messageChannel.enum';
import { WhatsappDeliveryStatus } from '../whatsappDeliveryStatus.enum';

import {
  BrevoDeliveryEvent,
  extractEmailEvents,
  extractSmsEvents,
  nextDeliveryStatus,
  providerMessageIdCandidates,
} from './brevoWebhookEvents';

function sha256(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

// Equal-length digests, so the comparison takes the same time whatever
// was presented.
function matchesSecret(presented: string, secret: string): boolean {
  return timingSafeEqual(sha256(presented), sha256(secret));
}

// Bearer token (a webhook created through Brevo's API with `auth`), or the
// password of Basic auth embedded in the webhook URL (Brevo's dashboard).
function presentedSecret(authorization: string | undefined): string | null {
  if (!authorization) {
    return null;
  }
  const [scheme, value] = authorization.trim().split(/\s+/, 2);
  if (!value) {
    return null;
  }
  if (scheme.toLowerCase() === 'bearer') {
    return value;
  }
  if (scheme.toLowerCase() === 'basic') {
    const decoded = Buffer.from(value, 'base64').toString('utf8');
    const separator = decoded.indexOf(':');
    return separator >= 0 ? decoded.slice(separator + 1) : null;
  }
  return null;
}

const SETTLED = new Set([
  WhatsappDeliveryStatus.Delivered,
  WhatsappDeliveryStatus.Read,
]);

// Phase 36, stage 4 — Brevo's delivery webhooks (email and SMS). Updates
// the delivery status of the matching message_logs row, and marks the
// client's email / phone number as not contactable after a definitive
// failure (confirmed with the human) so the email/SMS reminders stop using
// it. Never throws on a bad event: one malformed or unknown event is
// logged and skipped, the rest of the batch still applies. See
// docs/phases/PHASE_36_BREVO_EMAIL_SMS.md.
@Injectable()
export class BrevoWebhookService {
  private readonly logger = new Logger(BrevoWebhookService.name);

  constructor(
    @InjectRepository(MessageLog)
    private readonly messageLogsRepository: Repository<MessageLog>,
    @InjectRepository(Client)
    private readonly clientsRepository: Repository<Client>,
    private readonly configService: ConfigService<Configuration, true>,
  ) {}

  // Brevo doesn't sign its webhooks — the shared secret is the only proof
  // a call came from Brevo. Every call is rejected while it's not set.
  assertAuthorized(authorization: string | undefined): void {
    const { webhookSecret } = this.configService.get('brevo', { infer: true });
    if (!webhookSecret) {
      this.logger.warn(
        'Brevo webhook call rejected: BREVO_WEBHOOK_SECRET is not configured.',
      );
      throw new UnauthorizedException('Webhook is not configured');
    }
    const presented = presentedSecret(authorization);
    if (!presented || !matchesSecret(presented, webhookSecret)) {
      throw new UnauthorizedException('Invalid webhook credentials');
    }
  }

  async handle(
    channel: MessageChannel.Email | MessageChannel.Sms,
    payload: unknown,
  ): Promise<{ processed: number }> {
    const events =
      channel === MessageChannel.Email
        ? extractEmailEvents(payload)
        : extractSmsEvents(payload);
    let processed = 0;
    for (const event of events) {
      try {
        await this.apply(event);
        processed += 1;
      } catch (error) {
        this.logger.error(
          `Failed to apply Brevo ${event.channel} event ${event.event} for ${event.providerMessageId}`,
          error,
        );
      }
    }
    return { processed };
  }

  private async apply(event: BrevoDeliveryEvent): Promise<void> {
    // An unknown id is normal — a test send, or another app on the same
    // Brevo account — and only skips the status update.
    const log = await this.messageLogsRepository.findOne({
      where: {
        channel: event.channel,
        providerMessageId: In(
          providerMessageIdCandidates(event.channel, event.providerMessageId),
        ),
      },
    });

    if (log) {
      await this.updateDeliveryStatus(log, event);
    }
    if (event.blocksContact) {
      await this.blockContact(event, log);
    }
  }

  private async updateDeliveryStatus(
    log: MessageLog,
    event: BrevoDeliveryEvent,
  ): Promise<void> {
    const next = event.deliveryStatus
      ? nextDeliveryStatus(log.deliveryStatus, event.deliveryStatus)
      : null;
    const update: Partial<MessageLog> = {};
    if (next) {
      update.deliveryStatus = next;
      update.deliveryStatusUpdatedAt = event.occurredAt;
      if (next === WhatsappDeliveryStatus.Failed) {
        update.lastErrorTitle = event.reason;
      }
    } else if (
      // A transient problem (soft bounce, deferral) on a message that
      // hasn't arrived yet: keep the reason, the status stays as it is.
      !event.deliveryStatus &&
      !event.blocksContact &&
      event.reason &&
      !(log.deliveryStatus && SETTLED.has(log.deliveryStatus))
    ) {
      update.lastErrorTitle = event.reason;
    }
    if (Object.keys(update).length > 0) {
      await this.messageLogsRepository.update({ id: log.id }, update);
    }
  }

  private async blockContact(
    event: BrevoDeliveryEvent,
    log: MessageLog | null,
  ): Promise<void> {
    if (event.channel === MessageChannel.Email) {
      await this.blockEmail(event, log);
    } else {
      await this.blockSmsNumber(event, log);
    }
  }

  private async blockEmail(
    event: BrevoDeliveryEvent,
    log: MessageLog | null,
  ): Promise<void> {
    const address = (log?.email ?? event.recipient)?.trim().toLowerCase();
    if (!address) {
      return;
    }
    // Only the client whose CURRENT email is the failed one: if the admin
    // already changed it, the new address isn't affected.
    const query = this.clientsRepository
      .createQueryBuilder('client')
      .where('LOWER(TRIM(client.email)) = :address', { address })
      .andWhere('client.email_undeliverable_at IS NULL');
    if (log) {
      query.andWhere('client.id = :clientId', { clientId: log.clientId });
    }
    const clients = await query.getMany();
    for (const client of clients) {
      await this.clientsRepository.update(
        { id: client.id },
        {
          emailUndeliverableAt: event.occurredAt,
          emailUndeliverableReason: event.reason,
        },
      );
      this.logger.warn(
        `Email of client ${client.id} marked as not contactable (${event.reason})`,
      );
    }
  }

  private async blockSmsNumber(
    event: BrevoDeliveryEvent,
    log: MessageLog | null,
  ): Promise<void> {
    const phone = log?.phoneNumber ?? event.recipient;
    if (!phone) {
      return;
    }
    // With the message log, the number is blocked for that client — it may
    // be a third-party contact of one of their loans. Without it, for any
    // client whose own number it is.
    const clients = log
      ? await this.clientsRepository.findBy({ id: log.clientId })
      : await this.clientsRepository.find({
          where: [{ phoneNumber: phone }, { alternatePhoneNumber: phone }],
        });
    for (const client of clients) {
      if (client.smsUndeliverablePhoneNumbers.includes(phone)) {
        continue;
      }
      await this.clientsRepository.update(
        { id: client.id },
        {
          smsUndeliverablePhoneNumbers: [
            ...client.smsUndeliverablePhoneNumbers,
            phone,
          ],
        },
      );
      this.logger.warn(
        `SMS to ${phone} (client ${client.id}) stopped (${event.reason})`,
      );
    }
  }
}
