import { MessageChannel } from '../messageChannel.enum';
import { normalizeIncomingPhoneNumber } from '../webhook/normalizeIncomingPhoneNumber';
import { WhatsappDeliveryStatus } from '../whatsappDeliveryStatus.enum';

// Phase 36, stage 4 — one Brevo webhook event, translated into what it
// means for Collectify. See https://developers.brevo.com/docs/transactional-webhooks.
export interface BrevoDeliveryEvent {
  channel: MessageChannel.Email | MessageChannel.Sms;
  // Email `message-id` / SMS `messageId`, as Brevo sent it.
  providerMessageId: string;
  // The address/number the event is about (E.164 for SMS), when present.
  recipient: string | null;
  // Brevo's own event name (email `event`, SMS `msg_status`).
  event: string;
  // What this event says about delivery; null = it says nothing (an
  // engagement-free event after delivery, or a transient failure).
  deliveryStatus: WhatsappDeliveryStatus | null;
  // A definitive failure: stop using this email / number for email/SMS
  // reminders until the admin re-enables it (confirmed with the human).
  blocksContact: boolean;
  // Brevo's event plus its reason, for last_error_title / the client's
  // "not contactable" reason. Null for a plain success.
  reason: string | null;
  occurredAt: Date;
}

interface EventRule {
  status: WhatsappDeliveryStatus | null;
  blocksContact: boolean;
  // Worth recording as the reason even without a status change.
  isProblem: boolean;
}

const EMAIL_RULES: Record<string, EventRule> = {
  request: {
    status: WhatsappDeliveryStatus.Sent,
    blocksContact: false,
    isProblem: false,
  },
  delivered: {
    status: WhatsappDeliveryStatus.Delivered,
    blocksContact: false,
    isProblem: false,
  },
  opened: {
    status: WhatsappDeliveryStatus.Read,
    blocksContact: false,
    isProblem: false,
  },
  unique_opened: {
    status: WhatsappDeliveryStatus.Read,
    blocksContact: false,
    isProblem: false,
  },
  proxy_open: {
    status: WhatsappDeliveryStatus.Read,
    blocksContact: false,
    isProblem: false,
  },
  unique_proxy_open: {
    status: WhatsappDeliveryStatus.Read,
    blocksContact: false,
    isProblem: false,
  },
  click: {
    status: WhatsappDeliveryStatus.Read,
    blocksContact: false,
    isProblem: false,
  },
  // Definitive — confirmed with the human: stop emailing this address.
  hard_bounce: {
    status: WhatsappDeliveryStatus.Failed,
    blocksContact: true,
    isProblem: true,
  },
  invalid_email: {
    status: WhatsappDeliveryStatus.Failed,
    blocksContact: true,
    isProblem: true,
  },
  blocked: {
    status: WhatsappDeliveryStatus.Failed,
    blocksContact: true,
    isProblem: true,
  },
  // After delivery: the message did arrive, but the client doesn't want
  // these emails.
  spam: { status: null, blocksContact: true, isProblem: true },
  unsubscribed: { status: null, blocksContact: true, isProblem: true },
  // This one send failed on Brevo's side; nothing says the address is bad.
  error: {
    status: WhatsappDeliveryStatus.Failed,
    blocksContact: false,
    isProblem: true,
  },
  // Transient — Brevo keeps trying.
  soft_bounce: { status: null, blocksContact: false, isProblem: true },
  deferred: { status: null, blocksContact: false, isProblem: true },
};

const SMS_RULES: Record<string, EventRule> = {
  sent: {
    status: WhatsappDeliveryStatus.Sent,
    blocksContact: false,
    isProblem: false,
  },
  accepted: {
    status: WhatsappDeliveryStatus.Sent,
    blocksContact: false,
    isProblem: false,
  },
  delivered: {
    status: WhatsappDeliveryStatus.Delivered,
    blocksContact: false,
    isProblem: false,
  },
  // Definitive — confirmed with the human: no more SMS to this number.
  hard_bounce: {
    status: WhatsappDeliveryStatus.Failed,
    blocksContact: true,
    isProblem: true,
  },
  bl: {
    status: WhatsappDeliveryStatus.Failed,
    blocksContact: true,
    isProblem: true,
  },
  unsubscribed: { status: null, blocksContact: true, isProblem: true },
  // Rejected by Brevo (content, credits…), not necessarily a bad number.
  rej: {
    status: WhatsappDeliveryStatus.Failed,
    blocksContact: false,
    isProblem: true,
  },
  soft_bounce: { status: null, blocksContact: false, isProblem: true },
};

type RawEvent = Record<string, unknown>;

function asEvents(payload: unknown): RawEvent[] {
  const items = Array.isArray(payload) ? payload : [payload];
  return items.filter(
    (item): item is RawEvent => typeof item === 'object' && item !== null,
  );
}

function text(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  if (typeof value === 'number' && Number.isFinite(value) && value !== 0) {
    return String(value);
  }
  return null;
}

// ts_event is Unix seconds (UTC), ts_epoch milliseconds; `date` is in
// Brevo's own timezone (CET/CEST), so it's the last resort.
function occurredAt(raw: RawEvent): Date {
  if (typeof raw.ts_event === 'number') {
    return new Date(raw.ts_event * 1000);
  }
  if (typeof raw.ts_epoch === 'number') {
    return new Date(raw.ts_epoch);
  }
  return new Date();
}

function reasonFor(event: string, detail: string | null): string {
  return detail ? `${event}: ${detail}` : event;
}

export function extractEmailEvents(payload: unknown): BrevoDeliveryEvent[] {
  return asEvents(payload).flatMap((raw) => {
    const event = text(raw.event);
    const providerMessageId = text(raw['message-id']);
    const rule = event ? EMAIL_RULES[event] : undefined;
    if (!event || !providerMessageId || !rule) {
      return [];
    }
    return [
      {
        channel: MessageChannel.Email,
        providerMessageId,
        recipient: text(raw.email)?.toLowerCase() ?? null,
        event,
        deliveryStatus: rule.status,
        blocksContact: rule.blocksContact,
        reason: rule.isProblem ? reasonFor(event, text(raw.reason)) : null,
        occurredAt: occurredAt(raw),
      },
    ];
  });
}

export function extractSmsEvents(payload: unknown): BrevoDeliveryEvent[] {
  return asEvents(payload).flatMap((raw) => {
    const event = text(raw.msg_status);
    const providerMessageId = text(raw.messageId);
    const rule = event ? SMS_RULES[event] : undefined;
    if (!event || !providerMessageId || !rule) {
      return [];
    }
    const to = text(raw.to);
    const detail = [text(raw.bounce_type), text(raw.error_code)]
      .filter(Boolean)
      .join(', ');
    return [
      {
        channel: MessageChannel.Sms,
        providerMessageId,
        recipient: to ? normalizeIncomingPhoneNumber(to) : null,
        event,
        deliveryStatus: rule.status,
        blocksContact: rule.blocksContact,
        reason: rule.isProblem ? reasonFor(event, detail || null) : null,
        occurredAt: occurredAt(raw),
      },
    ];
  });
}

const STATUS_RANK: Record<WhatsappDeliveryStatus, number> = {
  [WhatsappDeliveryStatus.Sent]: 1,
  [WhatsappDeliveryStatus.Failed]: 2,
  [WhatsappDeliveryStatus.Delivered]: 3,
  [WhatsappDeliveryStatus.Read]: 4,
};

// Brevo may deliver events late, out of order or more than once: a status
// only ever moves forward (sent → failed/delivered → read), so a late
// "sent" can't undo "delivered", and a repeated event changes nothing.
export function nextDeliveryStatus(
  current: WhatsappDeliveryStatus | null,
  incoming: WhatsappDeliveryStatus,
): WhatsappDeliveryStatus | null {
  if (current === null || STATUS_RANK[incoming] > STATUS_RANK[current]) {
    return incoming;
  }
  return null;
}

// Brevo's email message-id comes as "<id@relay>"; compare it with and
// without the angle brackets.
export function providerMessageIdCandidates(
  channel: MessageChannel,
  providerMessageId: string,
): string[] {
  if (channel !== MessageChannel.Email) {
    return [providerMessageId];
  }
  const bare = providerMessageId.replace(/^<|>$/g, '');
  return [...new Set([providerMessageId, bare, `<${bare}>`])];
}
