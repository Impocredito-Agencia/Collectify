import { Client } from '../clients/entities/client.entity';

// Human report, 2026-09-19 — a client can have a second contact number
// (Client.alternatePhoneNumber, Phase 21 KYC field, already normalized
// the same way as phoneNumber — see CreateClientDto). Every
// business-initiated WhatsApp send (reminders, confirmations, new-loan
// notices) now goes to every number on file for that client, not just
// the primary one. Deduped in case the same number was somehow entered
// in both fields. Reactive sends (self-service menu replies, an admin's
// manual reply) are NOT fanned out this way — those reply on whichever
// number the client actually messaged in from, see
// WhatsappWebhookService.persistEvent's own comment.
export function getRecipientPhoneNumbers(
  client: Pick<Client, 'phoneNumber' | 'alternatePhoneNumber'>,
): string[] {
  return [...new Set([client.phoneNumber, client.alternatePhoneNumber])].filter(
    (phoneNumber): phoneNumber is string => Boolean(phoneNumber),
  );
}

// Human report, 2026-09-23 — drops every number the admin turned
// collection reminders off for on this client's profile
// (Client.mutedPhoneNumbers): the client's own primary/alternate numbers,
// or a loan's third-party contact. Applied only to the overdue/upcoming-
// due reminders (groupInstallmentsByRecipient, retries included) — the
// new-loan notice and payment confirmations deliberately still reach a
// muted number (confirmed with the human the same day). An empty result
// means "send nothing".
export function excludeMutedPhoneNumbers(
  phoneNumbers: string[],
  client: Pick<Client, 'mutedPhoneNumbers'>,
): string[] {
  const muted = new Set(client.mutedPhoneNumbers ?? []);
  return phoneNumbers.filter((phoneNumber) => !muted.has(phoneNumber));
}
