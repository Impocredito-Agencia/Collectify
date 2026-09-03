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

// Resolved 2026-09-03 — confirmed against Meta's actual template
// configuration (see docs/phases/PHASE_34_INTERACTIVE_MENU.md's "Bug fix,
// 2026-09-03" section). Meta's Quick Reply buttons have no separate
// payload field in the create-template UI — confirmed by screenshot — so
// the payload IS the literal button text, exactly as configured:
//
//   proxima_vencer_y_vencida, varias_cuota_vencida,
//   varias_cuota_proxima_vencer: "Más información" + "Ya pagué"
//   una_cuota_vencida, una_cuota_vencida_en_mora,
//   una_cuota_proxima_vencer: "Ya pagué" only
//   every new-loan/refinance/payment-confirmation template: no buttons
//
// No template carries a "Hablar con asesor" button — that option only
// exists in the self-service menu's own main menu
// (SelfServiceMenuButtonId.HablarAsesor above).
export const TemplateButtonPayload = {
  MasInformacion: 'Más información',
  YaPague: 'Ya pagué',
} as const;
