import { WhatsappInboundMessageType } from '../entities/whatsappInboundMessage.entity';

export interface ParsedInboundEvent {
  fromPhoneNumber: string;
  type: WhatsappInboundMessageType;
  buttonPayload: string | null;
  bodyText: string | null;
  // Set for a quick-reply button tap on a template message — Meta's
  // `context.id`, the WAMID of the message this one is replying to. Lets a
  // "Más información" tap be traced back to the exact reminder it came
  // from, see SelfServiceMenuService.sendBreakdownForContext. Bug fix,
  // 2026-09-03.
  contextMessageId: string | null;
  receivedAt: Date;
  rawPayload: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

// Meta's timestamp is epoch seconds as a string. Falls back to "now" for
// anything malformed rather than dropping the event over a bad clock value.
function parseReceivedAt(value: unknown): Date {
  const seconds = typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(seconds) ? new Date(seconds * 1000) : new Date();
}

// A quick-reply tap on a template message carries `context: { id, from }`
// pointing at the message it's replying to; a session-message button and
// plain text never do. Same nesting for every message type, so pulled out
// once rather than repeated per branch below.
function parseContextMessageId(
  message: Record<string, unknown>,
): string | null {
  return isRecord(message.context) ? asString(message.context.id) : null;
}

// Maps one Meta "message" object to our normalized shape. Handles the two
// distinct payload shapes a button tap can arrive as (type "button" from a
// template's quick-reply, type "interactive"/"button_reply" from a session
// message) plus plain text — see docs/phases/PHASE_22_WHATSAPP_WEBHOOK.md's
// domain research. Anything else becomes type "other" rather than dropped.
function parseMessage(message: Record<string, unknown>): {
  type: WhatsappInboundMessageType;
  buttonPayload: string | null;
  bodyText: string | null;
} {
  const messageType = asString(message.type);

  if (messageType === 'button' && isRecord(message.button)) {
    return {
      type: WhatsappInboundMessageType.Button,
      buttonPayload: asString(message.button.payload),
      bodyText: asString(message.button.text),
    };
  }

  if (
    messageType === 'interactive' &&
    isRecord(message.interactive) &&
    asString(message.interactive.type) === 'button_reply' &&
    isRecord(message.interactive.button_reply)
  ) {
    return {
      type: WhatsappInboundMessageType.Button,
      buttonPayload: asString(message.interactive.button_reply.id),
      bodyText: asString(message.interactive.button_reply.title),
    };
  }

  if (messageType === 'text' && isRecord(message.text)) {
    return {
      type: WhatsappInboundMessageType.Text,
      buttonPayload: null,
      bodyText: asString(message.text.body),
    };
  }

  return {
    type: WhatsappInboundMessageType.Other,
    buttonPayload: null,
    bodyText: null,
  };
}

// Defensively walks Meta's nested entry[].changes[].value.messages[]
// envelope. Never throws — an unexpected/malformed shape yields an empty
// array rather than an error, so a webhook payload we can't fully parse
// still gets acknowledged instead of crashing the request (the caller is
// still responsible for persisting what it *can* extract — see
// WhatsappWebhookService).
export function extractInboundEvents(payload: unknown): ParsedInboundEvent[] {
  if (!isRecord(payload)) {
    return [];
  }

  const events: ParsedInboundEvent[] = [];

  for (const entry of asArray(payload.entry)) {
    if (!isRecord(entry)) continue;

    for (const change of asArray(entry.changes)) {
      if (!isRecord(change) || !isRecord(change.value)) continue;

      for (const message of asArray(change.value.messages)) {
        if (!isRecord(message)) continue;

        const fromPhoneNumber = asString(message.from);
        if (!fromPhoneNumber) continue;

        const { type, buttonPayload, bodyText } = parseMessage(message);

        events.push({
          fromPhoneNumber,
          type,
          buttonPayload,
          bodyText,
          contextMessageId: parseContextMessageId(message),
          receivedAt: parseReceivedAt(message.timestamp),
          rawPayload: payload,
        });
      }
    }
  }

  return events;
}
