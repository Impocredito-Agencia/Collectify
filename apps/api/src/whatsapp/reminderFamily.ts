import { MessageType } from './messageType.enum';

// Phase 33 — one cron job per FAMILY, not per exact template (confirmed
// with the human, 2026-09-01), since "vencida" now spans 4 templates and
// "próxima a vencer" spans 2, but the admin's existing pause/resume/
// reschedule mechanics (WhatsappCronService) shouldn't fragment into 6
// separate jobs over it. Values match the old MessageType strings
// ('overdue'/'upcoming_due') on purpose, for continuity with the
// already-shipped /whatsapp/cron/:type/* admin endpoints.
//
// NewLoan added 2026-09-06 (supersedes the "new_loan/refinance... sent
// synchronously, no cron job at all" decision from Phase 33/18) — see
// NEW_LOAN_FAMILY_TYPES and Loan.isNewLoan for what actually gets swept.
export enum ReminderFamily {
  Overdue = 'overdue',
  UpcomingDue = 'upcoming_due',
  NewLoan = 'new_loan',
  CreditReport = 'credit_report',
}

export const OVERDUE_FAMILY_TYPES: MessageType[] = [
  MessageType.SingleOverdueInstallment,
  MessageType.SingleOverdueInstallmentWithSurcharge,
  MessageType.MultipleOverdueInstallments,
  MessageType.UpcomingAndOverdueMixed,
  // Human report, 2026-09-23 — appended, never prepended: WhatsappCronService
  // reads this family's schedule off the FIRST entry.
  MessageType.SingleOverdueInstallmentWithSurchargeOver30Days,
  MessageType.MultipleOverdueInstallmentsOver30Days,
  MessageType.UpcomingAndOverdueMixedOver30Days,
];

export const UPCOMING_FAMILY_TYPES: MessageType[] = [
  MessageType.SingleUpcomingInstallment,
  MessageType.MultipleUpcomingInstallments,
  MessageType.UpcomingAndOverdueMixed,
  MessageType.UpcomingAndOverdueMixedOver30Days,
];

// Refinance shares this family's single schedule with ordinary new-loan
// sends (confirmed with the human, 2026-09-06) — matches
// NewLoanReminderService.sendNewLoanMessage, which already treats both as
// one code path branching on loan.refinancedFromLoan. Payment
// confirmation and "pagado en su totalidad" are deliberately NOT part of
// any family — they stay synchronous, sent at their triggering action
// regardless of time, per the same 2026-09-06 decision.
export const NEW_LOAN_FAMILY_TYPES: MessageType[] = [
  MessageType.NewLoanNewClient,
  MessageType.NewLoanNewClientInitialInstallment,
  MessageType.NewLoanExistingClient,
  MessageType.NewLoanExistingClientInitialInstallment,
  MessageType.RefinanceSingleLoan,
];

// Client request, 2026-10-30 — its own family rather than part of
// OVERDUE_FAMILY_TYPES: this has to run every day to catch the exact
// 30th/50th day of mora, while the overdue schedule is only some days of the
// week. It also stays out of the message-frequency throttle, which would
// otherwise skip a one-time notice for good.
export const CREDIT_REPORT_FAMILY_TYPES: MessageType[] = [
  MessageType.CreditReport30Days,
  MessageType.CreditReport50Days,
];
