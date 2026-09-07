import { apiClient } from '@/lib/apiClient';

// Matches apps/api/src/whatsapp/messageType.enum.ts exactly — 13 real,
// Meta-approved templates as of Phase 33 (superseded the old 4-value
// catalog: new_loan/upcoming_due/overdue/account_summary, none of which
// are valid values anymore — account_summary was retired outright, the
// other three split into more specific variants). See
// docs/phases/PHASE_33_MESSAGE_TEMPLATES_V2.md and docs/DATABASE.md.
export enum MessageType {
  NewLoanNewClient = 'nuevo_pagar_cliente_nuevo',
  NewLoanNewClientInitialInstallment = 'nuevo_pagar_cuota_inicial_cliente_nuevo',
  NewLoanExistingClient = 'nuevo_pagar_cliente_existent',
  NewLoanExistingClientInitialInstallment = 'nuevo_pagar_cuota_inicial',
  RefinanceSingleLoan = 'refinanciamiento_un_solo_pagar',
  SingleUpcomingInstallment = 'una_cuota_proxima_vencer',
  MultipleUpcomingInstallments = 'varias_cuota_proxima_vencer',
  SingleOverdueInstallment = 'una_cuota_vencida',
  SingleOverdueInstallmentWithSurcharge = 'una_cuota_vencida_en_mora',
  MultipleOverdueInstallments = 'varias_cuota_vencida',
  UpcomingAndOverdueMixed = 'proxima_vencer_y_vencida',
  PaymentConfirmation = 'confirmacion_pago',
  PaidInFull = 'pago_completo_paz_y_salvo',
}

// Display order + Spanish labels for the 13 message types — shared across
// this page, MessageLogsPage, and ClientDetailPage/LoanDetailPage so the
// wording is consistent everywhere a type shows up. Short labels; the
// full literal name (matching docs/DATABASE.md's seeded `name` column) is
// what `template.name` renders on the templates grid itself.
export const MESSAGE_TYPE_ORDER: MessageType[] = [
  MessageType.NewLoanNewClient,
  MessageType.NewLoanNewClientInitialInstallment,
  MessageType.NewLoanExistingClient,
  MessageType.NewLoanExistingClientInitialInstallment,
  MessageType.RefinanceSingleLoan,
  MessageType.SingleUpcomingInstallment,
  MessageType.MultipleUpcomingInstallments,
  MessageType.SingleOverdueInstallment,
  MessageType.SingleOverdueInstallmentWithSurcharge,
  MessageType.MultipleOverdueInstallments,
  MessageType.UpcomingAndOverdueMixed,
  MessageType.PaymentConfirmation,
  MessageType.PaidInFull,
];

export const MESSAGE_TYPE_LABELS: Record<MessageType, string> = {
  [MessageType.NewLoanNewClient]: 'Nuevo pagaré — cliente nuevo',
  [MessageType.NewLoanNewClientInitialInstallment]:
    'Nuevo pagaré con cuota inicial — cliente nuevo',
  [MessageType.NewLoanExistingClient]: 'Nuevo pagaré — cliente existente',
  [MessageType.NewLoanExistingClientInitialInstallment]:
    'Nuevo pagaré con cuota inicial',
  [MessageType.RefinanceSingleLoan]: 'Refinanciamiento',
  [MessageType.SingleUpcomingInstallment]: 'Una cuota próxima a vencer',
  [MessageType.MultipleUpcomingInstallments]: 'Varias cuotas próximas a vencer',
  [MessageType.SingleOverdueInstallment]: 'Una cuota vencida',
  [MessageType.SingleOverdueInstallmentWithSurcharge]:
    'Una cuota vencida con recargos',
  [MessageType.MultipleOverdueInstallments]: 'Varias cuotas vencidas',
  [MessageType.UpcomingAndOverdueMixed]: 'Próximas a vencer y vencidas',
  [MessageType.PaymentConfirmation]: 'Confirmación de pago',
  [MessageType.PaidInFull]: 'Pago completo — paz y salvo',
};

// message_logs.type is append-only history (docs/DATABASE.md) and its enum
// was deliberately widened to old ∪ new by the Phase 33 migration, not
// rewritten — a log row from before Phase 33 can legitimately still carry
// one of the old 4 values forever. MESSAGE_TYPE_LABELS only covers the
// current 13, so a bare index lookup on a log's `type` renders blank for
// those older rows. This map + messageTypeLabel() below is only for
// rendering a MessageLog's type (MessageLogsPage, ClientDetailPage) — a
// MessageTemplate's `type` always comes back as one of the current 13
// from GET /message-templates, so those call sites keep using
// MESSAGE_TYPE_LABELS directly.
const LEGACY_MESSAGE_TYPE_LABELS: Record<string, string> = {
  new_loan: 'Primera vez (anterior)',
  upcoming_due: 'Aviso (anterior)',
  overdue: 'Recordatorio de mora (anterior)',
  account_summary: 'Estado de cuenta (anterior)',
};

export function messageTypeLabel(type: string): string {
  return (
    MESSAGE_TYPE_LABELS[type as MessageType] ??
    LEGACY_MESSAGE_TYPE_LABELS[type] ??
    type
  );
}

// Groupings by trigger mechanism (Phase 33 — see docs/phases/PHASE_33_MESSAGE_TEMPLATES_V2.md
// "Technical decisions"): NEW_LOAN_FAMILY_TYPES + the union of
// apps/api/src/whatsapp/reminderFamily.ts's OVERDUE_FAMILY_TYPES /
// UPCOMING_FAMILY_TYPES. Used to explain each template's trigger on the
// grid, and to narrow a client's message-log history down to "the new-loan
// message for this loan" without a server-side multi-type filter (the API
// only accepts one `type` at a time) — see LoanDetailPage.tsx. New-loan
// messages are sent synchronously (LoansService), not on any cron
// schedule — unlike its name, this is just a MessageType grouping, no
// longer a ReminderFamily on the backend (reverted 2026-09-06).
export const NEW_LOAN_FAMILY_TYPES: MessageType[] = [
  MessageType.NewLoanNewClient,
  MessageType.NewLoanNewClientInitialInstallment,
  MessageType.NewLoanExistingClient,
  MessageType.NewLoanExistingClientInitialInstallment,
  MessageType.RefinanceSingleLoan,
];

export const REMINDER_FAMILY_TYPES: MessageType[] = [
  MessageType.SingleUpcomingInstallment,
  MessageType.MultipleUpcomingInstallments,
  MessageType.SingleOverdueInstallment,
  MessageType.SingleOverdueInstallmentWithSurcharge,
  MessageType.MultipleOverdueInstallments,
  MessageType.UpcomingAndOverdueMixed,
];

// Split out of REMINDER_FAMILY_TYPES (2026-09-06) — mirrors
// apps/api/src/whatsapp/reminderFamily.ts's OVERDUE_FAMILY_TYPES /
// UPCOMING_FAMILY_TYPES exactly, so MessageTemplatesPage can list which
// templates share each individual family's schedule (not just the
// combined union above). UpcomingAndOverdueMixed intentionally appears in
// both, same as on the backend.
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

// Templates are read-only content, editable only via a migration —
// unchanged since Phase 9's refactor, still true under the 13-type
// catalog. See docs/DATABASE.md "Changed after Phase 9".
export interface MessageTemplate {
  id: string;
  name: string;
  type: MessageType;
  content: string;
  // Phase 33 — the real Meta template this row sends via the Template
  // Messages API. metaTemplateName is currently always equal to `type`
  // (both are the literal Meta template name), kept as a separate field
  // to match the backend entity rather than assumed.
  metaTemplateName: string;
  metaLanguageCode: string;
  // Phase 18 — admin-editable cron schedule, now only meaningful for the
  // 6 REMINDER_FAMILY_TYPES rows; the "schedule owner" row per family
  // (SingleOverdueInstallment / SingleUpcomingInstallment) is the one
  // PATCH /whatsapp/cron/:family/schedule actually updates — see
  // MessageTemplatesPage.tsx's FamilyCronControl. Null falls back to a
  // per-family code default on the server (see WhatsappCronService).
  cronExpression: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

// MessageAudience/getAudience/updateAudience (Phase 18) removed in
// Phase 27 — the overdue/upcoming_due audience concept no longer exists.
// See docs/phases/PHASE_27_MESSAGE_FREQUENCY.md.

export const messageTemplatesApi = {
  // GET /message-templates is the only read endpoint left on the template
  // itself — read-only, one row per MessageType. Admin-only server-side
  // (whole controller).
  getAll: async (): Promise<MessageTemplate[]> => {
    const { data } =
      await apiClient.get<MessageTemplate[]>('/message-templates');
    return data;
  },
};
