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
