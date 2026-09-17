import { WhatsappDeliveryStatus } from './whatsappDeliveryStatus.enum';

// Meta never confirms "this client blocked you" — the closest signal it
// exposes is a `failed` delivery status carrying one of these error codes
// (131026 "Message Undeliverable" being the most common in practice) on a
// message sent to a number that can't otherwise be explained (invalid
// number, account restriction, etc.). Treated as evidence, not a verdict —
// see WhatsappDeliveryHealth's own comment.
const KNOWN_UNDELIVERABLE_ERROR_CODES = new Set([131026, 131047, 470]);

// A run of this many consecutive failed sends, with no delivered/read in
// between, is treated as supporting evidence even without a matching error
// code — some failure modes (e.g. a expired/invalid token at send time)
// don't carry one at all.
const CONSECUTIVE_FAILURE_THRESHOLD = 3;

export interface OutboundDeliveryEvent {
  deliveryStatus: WhatsappDeliveryStatus | null;
  errorCode: number | null;
  errorTitle: string | null;
}

// Human report, 2026-09-16 — "¿cómo sabemos si un cliente nos bloqueó?".
// Computed on read from a client's own recent outbound sends, same
// convention as ClientsService.hasMoraBlock — never stored, so it's always
// derived from whatever the webhook has actually reported so far.
// `possiblyBlocked` is deliberately named "possibly": WhatsApp itself never
// confirms a block, so this is surfaced to the admin alongside the raw
// evidence (lastErrorCode/lastErrorTitle) rather than as a bare boolean
// they'd have no way to double-check.
export interface WhatsappDeliveryHealth {
  lastDeliveryStatus: WhatsappDeliveryStatus | null;
  lastErrorCode: number | null;
  lastErrorTitle: string | null;
  possiblyBlocked: boolean;
}

// eventsNewestFirst must already be sorted newest-first (typically the
// client's last 5 outbound sends across message_logs + whatsapp_manual_replies).
export function computeDeliveryHealth(
  eventsNewestFirst: OutboundDeliveryEvent[],
): WhatsappDeliveryHealth {
  const [mostRecent] = eventsNewestFirst;
  if (!mostRecent) {
    return {
      lastDeliveryStatus: null,
      lastErrorCode: null,
      lastErrorTitle: null,
      possiblyBlocked: false,
    };
  }

  let consecutiveFailures = 0;
  for (const event of eventsNewestFirst) {
    if (event.deliveryStatus !== WhatsappDeliveryStatus.Failed) break;
    consecutiveFailures += 1;
  }

  const mostRecentFailureHasKnownCode =
    mostRecent.deliveryStatus === WhatsappDeliveryStatus.Failed &&
    mostRecent.errorCode !== null &&
    KNOWN_UNDELIVERABLE_ERROR_CODES.has(mostRecent.errorCode);

  const possiblyBlocked =
    mostRecentFailureHasKnownCode ||
    consecutiveFailures >= CONSECUTIVE_FAILURE_THRESHOLD;

  return {
    lastDeliveryStatus: mostRecent.deliveryStatus,
    lastErrorCode: mostRecent.errorCode,
    lastErrorTitle: mostRecent.errorTitle,
    possiblyBlocked,
  };
}
