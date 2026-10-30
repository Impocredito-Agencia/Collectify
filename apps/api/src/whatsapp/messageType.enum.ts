// Which WhatsApp Meta-approved template a MessageTemplate/MessageLog row
// renders — see docs/phases/PHASE_33_MESSAGE_TEMPLATES_V2.md. Each value is
// the literal Meta template name (not a separate internal label), by design
// (per that phase's Scope section) — MessageTemplate.metaTemplateName is
// still its own column since Meta names and this enum are technically
// allowed to drift, but in practice they're always kept identical.
//
// Supersedes the old 4-value catalog (new_loan, upcoming_due, overdue,
// account_summary) from docs/phases/PHASE_9_MESSAGE_TYPES.md.
// account_summary has no replacement — confirmed retired outright by the
// human (2026-09-01), see PHASE_33's "Resolved" section.
export enum MessageType {
  // New loan — cliente nuevo (primer préstamo)
  NewLoanNewClient = 'nuevo_pagar_cliente_nuevo',
  NewLoanNewClientInitialInstallment = 'nuevo_pagar_cuota_inicial_cliente_nuevo',
  // New loan — cliente existente
  NewLoanExistingClient = 'nuevo_pagar_cliente_existent',
  NewLoanExistingClientInitialInstallment = 'nuevo_pagar_cuota_inicial',
  // Refinanciamiento de un solo pagaré (fusión de varios reusa
  // NewLoanExistingClient — ver PHASE_33)
  RefinanceSingleLoan = 'refinanciamiento_un_solo_pagar',
  // Próxima a vencer
  SingleUpcomingInstallment = 'una_cuota_proxima_vencer',
  MultipleUpcomingInstallments = 'varias_cuota_proxima_vencer',
  // Vencida
  SingleOverdueInstallment = 'una_cuota_vencida',
  SingleOverdueInstallmentWithSurcharge = 'una_cuota_vencida_en_mora',
  MultipleOverdueInstallments = 'varias_cuota_vencida',
  UpcomingAndOverdueMixed = 'proxima_vencer_y_vencida',
  // Human report, 2026-09-23 — same three templates for a client whose
  // mora is MORE than 30 days (see SEVERE_MORA_THRESHOLD_DAYS in
  // reminderTemplateSelection.ts): they alone keep the "No afecte su
  // historial crediticio" warning, now removed from the base versions
  // above. Same parameters, in the same order, as each base template.
  // The single-installment one's Meta name really does end in "_2".
  SingleOverdueInstallmentWithSurchargeOver30Days = 'una_cuota_vencida_en_mora_30dias_2',
  MultipleOverdueInstallmentsOver30Days = 'varias_cuota_vencida_30dias',
  UpcomingAndOverdueMixedOver30Days = 'proxima_vencer_y_vencida_30dias',
  // Client request, 2026-10-30 — Datacrédito notices, sent only on the exact
  // day a pagaré reaches this many days of mora (see
  // creditReportTemplateSelection.ts).
  CreditReport30Days = 'reporte_30_dias',
  CreditReport50Days = 'reporte_50_dias',
  // Confirmación de pago
  PaymentConfirmation = 'confirmacion_pago',
  PaidInFull = 'pago_completo_paz_y_salvo',
}
