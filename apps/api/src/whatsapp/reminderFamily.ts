import { MessageType } from './messageType.enum';

// Phase 33 — one cron job per FAMILY, not per exact template (confirmed
// with the human, 2026-09-01), since "vencida" now spans 4 templates and
// "próxima a vencer" spans 2, but the admin's existing pause/resume/
// reschedule mechanics (WhatsappCronService) shouldn't fragment into 6
// separate jobs over it. Values match the old MessageType strings
// ('overdue'/'upcoming_due') on purpose, for continuity with the
// already-shipped /whatsapp/cron/:type/* admin endpoints.
//
// A NewLoan family briefly existed here (2026-09-06) with its own cron
// job, superseded the same day (confirmed with the human) — see
// NewLoanReminderService's own comment for why: a historical/backfilled
// loan slipping through with isNewLoan left true would only get caught,
// and wrongly message the client, whenever the sweep next ran. New-loan
// and refinance messages are sent synchronously again, at their
// triggering action (LoansService.create()/refinance()), same as payment
// confirmation below — no family/schedule for them at all.
export enum ReminderFamily {
  Overdue = 'overdue',
  UpcomingDue = 'upcoming_due',
}

export const OVERDUE_FAMILY_TYPES: MessageType[] = [
  MessageType.SingleOverdueInstallment,
  MessageType.SingleOverdueInstallmentWithSurcharge,
  MessageType.MultipleOverdueInstallments,
  MessageType.UpcomingAndOverdueMixed,
];

export const UPCOMING_FAMILY_TYPES: MessageType[] = [
  MessageType.SingleUpcomingInstallment,
  MessageType.MultipleUpcomingInstallments,
  MessageType.UpcomingAndOverdueMixed,
];
