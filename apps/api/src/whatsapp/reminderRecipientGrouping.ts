import { Client } from '../clients/entities/client.entity';

import {
  excludeMutedPhoneNumbers,
  getRecipientPhoneNumbers,
} from './clientRecipientPhoneNumbers';
import {
  OverdueInstallmentResult,
  UpcomingInstallmentResult,
} from './reminderInstallmentQueries';

// Human report, 2026-09-19 — a loan can carry its own alternateContactPhoneNumber
// (a rare, per-loan exception — see Loan.alternateContactPhoneNumber), which
// means a client's consolidated overdue/upcoming-due reminder can no longer
// always be exactly one message to exactly the client: if one of several
// loans has this override, that loan's installments must go to the contact
// instead, in their own message, scoped to just that loan — while the
// client's remaining loans still get their own normal, client-addressed
// message. Shared by OverdueReminderService and UpcomingDueReminderService,
// which are otherwise near-identical (see reminderInstallmentQueries.ts's
// own note on that duplication).
export interface ReminderRecipientGroup {
  // Every number this specific group's message should go out to — the
  // client's own known numbers (see getRecipientPhoneNumbers) for the
  // "normal" group, or exactly one contact's number for a contact group
  // (a contact is a single phone number, never fanned out).
  recipientPhoneNumbers: string[];
  overdue: OverdueInstallmentResult[];
  upcoming: UpcomingInstallmentResult[];
}

export function groupInstallmentsByRecipient(
  overdue: OverdueInstallmentResult[],
  upcoming: UpcomingInstallmentResult[],
  client: Client,
): ReminderRecipientGroup[] {
  const groups: ReminderRecipientGroup[] = [];

  const clientOverdue = overdue.filter((i) => !i.alternateContactPhoneNumber);
  const clientUpcoming = upcoming.filter((i) => !i.alternateContactPhoneNumber);
  if (clientOverdue.length > 0 || clientUpcoming.length > 0) {
    groups.push({
      recipientPhoneNumbers: getRecipientPhoneNumbers(client),
      overdue: clientOverdue,
      upcoming: clientUpcoming,
    });
  }

  const contactPhoneNumbers = new Set(
    [...overdue, ...upcoming]
      .map((i) => i.alternateContactPhoneNumber)
      .filter((phoneNumber): phoneNumber is string => Boolean(phoneNumber)),
  );
  for (const contactPhoneNumber of contactPhoneNumbers) {
    groups.push({
      recipientPhoneNumbers: [contactPhoneNumber],
      overdue: overdue.filter(
        (i) => i.alternateContactPhoneNumber === contactPhoneNumber,
      ),
      upcoming: upcoming.filter(
        (i) => i.alternateContactPhoneNumber === contactPhoneNumber,
      ),
    });
  }

  // Human report, 2026-09-23 — muted numbers (Client.mutedPhoneNumbers)
  // never receive a reminder; a group left with no one to send to is
  // dropped entirely rather than sent to nobody. Another group can still
  // go out — muting the client's own numbers doesn't silence a loan's
  // third-party contact, or vice versa.
  return groups
    .map((group) => ({
      ...group,
      recipientPhoneNumbers: excludeMutedPhoneNumbers(
        group.recipientPhoneNumbers,
        client,
      ),
    }))
    .filter((group) => group.recipientPhoneNumbers.length > 0);
}

// Human report, 2026-09-19 — a manual retry (MessageLogsService.dispatchRetry)
// passes targetPhoneNumbers: [original.phoneNumber] to resend to exactly
// the one number/group that originally failed, never re-running every
// group again (which could re-send to a recipient who already got their
// message fine). Narrows the freshly-recomputed groups down to the single
// one that phone number belongs to, and narrows ITS recipientPhoneNumbers
// down to just that one number too — the client group can hold two
// numbers, and a retry must never resend to the other one.
export function restrictToTargetPhoneNumber(
  groups: ReminderRecipientGroup[],
  targetPhoneNumber: string,
): ReminderRecipientGroup[] {
  return groups
    .filter((group) => group.recipientPhoneNumbers.includes(targetPhoneNumber))
    .map((group) => ({ ...group, recipientPhoneNumbers: [targetPhoneNumber] }));
}
