// Human-readable Spanish translations for AuditLog.action/entityType — both
// are free text server-side (set by whichever endpoint's @Audit() decorator
// fired, see apps/api/src/auditLog/auditLog.interceptor.ts), not real
// enums, so admins were seeing raw values like "client.create" and
// "client" · <uuid> in the Auditoría screen with no way to tell what
// actually happened. Used by AuditLogsPage.tsx's table (the drawer that
// used to also consume this, AuditLogDrawer.tsx, was removed 2026-09-05 —
// its raw-JSON payload view wasn't useful to a non-technical user; see
// this file's own git history / the page's comment for the reasoning).
//
// Extend this list whenever a new @Audit('x.y', 'z') call is added to the
// backend (grep `@Audit(` under apps/api/src) — an action/entityType
// missing here just falls back to showing the raw value instead of
// breaking, so nothing needs to ship in lockstep.
export const ACTION_LABELS: Record<string, string> = {
  'client.create': 'Creó un cliente',
  'client.update': 'Editó un cliente',
  'client.deactivate': 'Desactivó un cliente',
  'client.reactivate': 'Reactivó un cliente',
  'client.addReference': 'Agregó una referencia',
  'client.updateReference': 'Editó una referencia',
  'client.removeReference': 'Eliminó una referencia',
  // Phase 27 — added when the frequency whitelist shipped, but never added
  // here (see Phase 32's audit log fix — this file fell out of sync with
  // new @Audit() calls added by later phases, which is exactly the
  // "raw unreadable code" the client reported: e.g. "client.
  // setMessageFrequency" shown verbatim instead of translated).
  'client.setMessageFrequency':
    'Configuró la frecuencia de mensajes de un cliente',
  'client.clearMessageFrequency':
    'Quitó la frecuencia personalizada de un cliente',
  'client.setMutedPhoneNumbers':
    'Cambió qué números de un cliente reciben recordatorios de cobro',
  'loan.create': 'Creó un préstamo',
  'loan.update': 'Editó un préstamo',
  'loan.payoff': 'Liquidó un préstamo',
  'loan.refinance': 'Refinanció un préstamo',
  // Phase 30 — same gap as above: added when loan deletion shipped, never
  // added here.
  'loan.delete': 'Eliminó un préstamo',
  // Human report, 2026-09-22 — moves every pending installment of a loan
  // to the same day of the month (LoansController's bulk endpoint).
  'loan.alignInstallmentDueDay': 'Cambió el día de cobro de un préstamo',
  'loan.adjustPendingInstallments':
    'Ajustó el valor de las cuotas pendientes de un préstamo',
  'payment.register': 'Registró un pago',
  // Phase 28 — same gap: added when bulk payments shipped.
  'payment.registerBulk': 'Registró un pago sobre varias cuotas',
  // Human report, 2026-09-22 — moves a single pending installment's due
  // date (InstallmentsController's PATCH /installments/:id/due-date).
  'installment.updateDueDate': 'Cambió la fecha de cobro de una cuota',
  // Human report, 2026-09-09 — payment correction feature.
  'payment.void': 'Anuló un pago',
  // Human report, 2026-09-23 — applies a client's saldo a favor to one of
  // their pending installments (ClientCreditBanner's "Aplicar"). Added to
  // the backend on 2026-09-14 but never here, so Auditoría showed the raw
  // "payment.applyCredit".
  'payment.applyCredit': 'Aplicó saldo a favor a una cuota',
  // Human report, 2026-09-10 — docs/DATABASE.md's 2026-09-03 coverage
  // sweep had already flagged "cron pause/resume/reschedule" (the
  // Plantillas tab's per-family Pausar/Reanudar/Guardar horario menu) as
  // missing @Audit() entirely; this closes that specific gap.
  'whatsappCron.pause': 'Pausó un recordatorio automático',
  'whatsappCron.resume': 'Reanudó un recordatorio automático',
  'whatsappCron.reschedule': 'Cambió el horario de un recordatorio automático',
  // Human report, 2026-09-13 — same coverage sweep as 'whatsappCron.pause'
  // above, closes the "close-conversation" item off that same list.
  'whatsappTicket.resolve': 'Cerró una conversación de WhatsApp',
  // Human report, 2026-09-15 — closes the last 4 items off the same
  // 2026-09-03 coverage sweep (docs/DATABASE.md's "audit_logs" section):
  // reply, the two manual-send endpoints, and message_logs.retry.
  'whatsapp.reply': 'Respondió manualmente a un cliente por WhatsApp',
  'whatsapp.followUp': 'Envió la plantilla de seguimiento por WhatsApp',
  'whatsapp.sendReminder': 'Envió manualmente un recordatorio de mora',
  'whatsapp.sendUpcomingDue':
    'Envió manualmente un recordatorio de cuota próxima',
  'messageLog.retry': 'Reintentó un mensaje fallido',
  'user.create': 'Creó un usuario',
  'user.deactivate': 'Desactivó un usuario',
  'user.reactivate': 'Reactivó un usuario',
  // Phase 20 — same gap: added when the module-permissions matrix shipped.
  'user.updatePermissions': 'Actualizó los permisos de un usuario',
  // Phase 20 follow-up — same gap: added when permanent user deletion
  // shipped, caught by the client after seeing the raw "user.delete" in
  // the Auditoría screen.
  'user.delete': 'Eliminó un usuario',
  'usuryRate.create': 'Creó una tasa de usura',
  // Phase 8 — same gap: the Excel import endpoint has always had this
  // decorator, but this map was only ever backfilled for actions added
  // from Phase 11 onward. Kept even after the 2026-09-06 split below —
  // existing historical rows logged before the split still carry this
  // exact action string and must keep translating.
  'clientLoanImport.execute': 'Importó clientes y préstamos desde Excel',
  // 2026-09-06 — the combined clients+loans importer above was split into
  // two endpoints (ClientsImportController and LoanImportController, see
  // apps/api/src/clientsImport and apps/api/src/loanImport), each with its
  // own @Audit() call using the new action/entityType names. Same sync gap
  // as everywhere else in this file: the rename shipped without updating
  // this map, so Auditoría showed raw "clientsImport.execute" instead of a
  // translated label — caught by the client from a live screenshot.
  'clientsImport.execute': 'Importó clientes desde Excel',
  // Removed, 2026-09-09 — the loan-only Excel importer (apps/api/src/
  // loanImport) was deleted outright: it never had a way to trigger it
  // from this app (no button/dialog ever existed for it, unlike
  // ImportClientsDialog.tsx above), and the client confirmed it was never
  // going to be used. Label kept, same precedent as clientLoanImport.
  // execute above, purely so any historical row logged before the removal
  // still translates instead of showing the raw action string.
  'loanImport.execute': 'Importó préstamos desde Excel',
  // Style cleanup, 2026-09-04 — same sync gap yet again: the
  // interestConceptType @Audit() calls were only added 2026-09-03 (see
  // DATABASE.md), and this map was never backfilled, so the client saw raw
  // "interestConceptType.create" etc. in Auditoría.
  'interestConceptType.create': 'Creó un tipo de cargo',
  'interestConceptType.update': 'Editó un tipo de cargo',
  'interestConceptType.deactivate': 'Desactivó un tipo de cargo',
  'interestConceptType.activate': 'Reactivó un tipo de cargo',
  'interestConceptType.delete': 'Eliminó un tipo de cargo',
};

// Mirrors the entityType values @Audit()-decorated endpoints actually use
// today. AuditLogsPage's filter dropdown intentionally doesn't offer every
// one of these (e.g. "usuryRate" has no filter option — see
// ENTITY_TYPE_FILTER_OPTIONS there), but every value that CAN show up in a
// row still needs a display label here.
export const ENTITY_TYPE_LABELS: Record<string, string> = {
  client: 'Cliente',
  loan: 'Préstamo',
  // Human report, 2026-09-22 — see 'installment.updateDueDate' above.
  installment: 'Cuota',
  payment: 'Pago',
  // Human report, 2026-09-10 — see 'whatsappCron.pause' above.
  whatsappCron: 'Recordatorio automático',
  // Human report, 2026-09-13 — see 'whatsappTicket.resolve' above.
  whatsappTicket: 'Conversación de WhatsApp',
  // Human report, 2026-09-15 — see 'whatsapp.reply'/'messageLog.retry'
  // above. whatsapp.sendReminder/sendUpcomingDue reuse entityType 'client'
  // (already labeled above), not a new value.
  whatsappReply: 'Respuesta de WhatsApp',
  messageLogRetry: 'Reintento de mensaje',
  user: 'Usuario',
  usuryRate: 'Tasa de usura',
  // Phase 32 — same sync gap as ACTION_LABELS above. Kept for historical
  // rows logged before the 2026-09-06 split below.
  clientLoanImport: 'Importación de clientes',
  // 2026-09-06 — same sync gap as ACTION_LABELS above, for the same
  // clients/loans importer split.
  clientsImport: 'Importación de clientes',
  // Removed, 2026-09-09 — see 'loanImport.execute' above; kept for the
  // same historical-row reason.
  loanImport: 'Importación de préstamos',
  // Style cleanup, 2026-09-04 — same sync gap as ACTION_LABELS above.
  interestConceptType: 'Tipo de cargo',
};

export function formatAuditAction(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

export function formatAuditEntityType(entityType: string): string {
  return ENTITY_TYPE_LABELS[entityType] ?? entityType;
}
