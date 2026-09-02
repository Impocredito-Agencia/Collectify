// Phase 34 — button ids for the self-service menu's own Reply Buttons
// messages (main menu + "Mi cuenta" submenu). These are NOT Meta-defined:
// they're session-message buttons the backend builds and sends itself, so
// the ids are our own choice — see
// docs/phases/PHASE_34_INTERACTIVE_MENU.md.
export enum SelfServiceMenuButtonId {
  MiCuenta = 'menu_mi_cuenta',
  ReportarPago = 'menu_reportar_pago',
  HablarAsesor = 'menu_hablar_asesor',
  EstadoCuenta = 'menu_estado_cuenta',
  CuotasPendientes = 'menu_cuotas_pendientes',
  HistorialPagos = 'menu_historial_pagos',
  VolverAlMenu = 'menu_volver',
}

// TODO(Fase 34 — blocking): the real button.payload strings Meta assigned
// to Templates 4-8's Quick Reply buttons ("Ver mis cuotas" / "Ver
// desglose", "Ya pagué" / "Enviar comprobante", "Hablar con asesor") are
// still pending — see the "Open questions" section of
// docs/phases/PHASE_34_INTERACTIVE_MENU.md. Until the human provides the
// real values (via GET .../message_templates, see chat), these placeholder
// strings will never match a real inbound webhook event, so taps on a
// template's own buttons don't trigger anything yet — the self-service
// menu below (triggered by free text) is unaffected and works today.
// Swap the three values below once confirmed; nothing else needs to change.
export const TemplateButtonPayload = {
  VerMisCuotas: 'PENDING_VER_MIS_CUOTAS',
  YaPague: 'PENDING_YA_PAGUE',
  HablarConAsesor: 'PENDING_HABLAR_CON_ASESOR',
} as const;
