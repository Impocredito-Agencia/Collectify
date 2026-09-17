import { WhatsappDeliveryStatus } from '../whatsappDeliveryStatus.enum';

// Meta's per-message delivery-status webhook callback
// (change.value.statuses[]) — sent/delivered/read/failed for a message
// this app previously sent, keyed by WAMID (`id`). Never parsed anywhere
// in this codebase before 2026-09-16 — see docs/DATABASE.md. errorCode/
// errorTitle are only present on a `failed` status; code 131026 ("Message
// Undeliverable") is the closest signal Meta exposes to "this number
// blocked the business", but never a hard verdict on its own — see
// whatsappDeliveryHealth.ts.
export interface ParsedStatusEvent {
  whatsappMessageId: string;
  status: WhatsappDeliveryStatus;
  timestamp: Date;
  errorCode: number | null;
  errorTitle: string | null;
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

// Meta's timestamp is epoch seconds as a string, same as a message's own
// `timestamp` — see extractInboundEvents.ts's parseReceivedAt. Falls back
// to "now" for anything malformed rather than dropping the event.
function parseTimestamp(value: unknown): Date {
  const seconds = typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(seconds) ? new Date(seconds * 1000) : new Date();
}

function parseStatus(value: unknown): WhatsappDeliveryStatus | null {
  switch (value) {
    case 'sent':
      return WhatsappDeliveryStatus.Sent;
    case 'delivered':
      return WhatsappDeliveryStatus.Delivered;
    case 'read':
      return WhatsappDeliveryStatus.Read;
    case 'failed':
      return WhatsappDeliveryStatus.Failed;
    default:
      return null;
  }
}

function parseError(status: Record<string, unknown>): {
  errorCode: number | null;
  errorTitle: string | null;
} {
  const [firstError] = asArray(status.errors);
  if (!isRecord(firstError)) {
    return { errorCode: null, errorTitle: null };
  }
  return {
    errorCode: typeof firstError.code === 'number' ? firstError.code : null,
    errorTitle: asString(firstError.title),
  };
}

// Defensively walks Meta's nested entry[].changes[].value.statuses[]
// envelope — same shape/robustness contract as extractInboundEvents:
// never throws, an unexpected/malformed shape yields an empty array rather
// than an error.
export function extractStatusEvents(payload: unknown): ParsedStatusEvent[] {
  if (!isRecord(payload)) {
    return [];
  }

  const events: ParsedStatusEvent[] = [];

  for (const entry of asArray(payload.entry)) {
    if (!isRecord(entry)) continue;

    for (const change of asArray(entry.changes)) {
      if (!isRecord(change) || !isRecord(change.value)) continue;

      for (const status of asArray(change.value.statuses)) {
        if (!isRecord(status)) continue;

        const whatsappMessageId = asString(status.id);
        const parsedStatus = parseStatus(status.status);
        if (!whatsappMessageId || !parsedStatus) continue;

        events.push({
          whatsappMessageId,
          status: parsedStatus,
          timestamp: parseTimestamp(status.timestamp),
          ...parseError(status),
        });
      }
    }
  }

  return events;
}
