import { PaymentHistoryEntry } from './breakdownQueries';
import {
  AccountSummaryInstallmentForMessage,
  formatCurrency,
  formatDateEs,
  renderAccountSummaryMessage,
} from './messageRenderer';
import { SelfServiceMenuButtonId } from './selfServiceMenuPayloads';

export interface InteractiveButton {
  id: string;
  title: string;
}

// ── Main menu ────────────────────────────────────────────────────────────

export const MAIN_MENU_BODY =
  'Hola, bienvenido a IMPROCRÉDITO. Selecciona una opción:';

export const MAIN_MENU_BUTTONS: InteractiveButton[] = [
  { id: SelfServiceMenuButtonId.MiCuenta, title: 'Mi cuenta' },
  { id: SelfServiceMenuButtonId.ReportarPago, title: 'Reportar un pago' },
  { id: SelfServiceMenuButtonId.HablarAsesor, title: 'Hablar con asesor' },
];

// ── "Mi cuenta" submenu ──────────────────────────────────────────────────

export const MI_CUENTA_SUBMENU_BODY = 'Selecciona qué deseas consultar:';

export const MI_CUENTA_SUBMENU_BUTTONS: InteractiveButton[] = [
  { id: SelfServiceMenuButtonId.EstadoCuenta, title: 'Estado de cuenta' },
  { id: SelfServiceMenuButtonId.CuotasPendientes, title: 'Cuotas pendientes' },
  { id: SelfServiceMenuButtonId.HistorialPagos, title: 'Historial de pagos' },
];

// ── "Volver al menú" follow-up ───────────────────────────────────────────
// WhatsApp interactive messages cap the body at 1024 characters, too tight
// for a breakdown/history list that can run long — so "attach one button"
// (per the phase doc) is sent as a short SECOND message with just that one
// button, right after the plain-text breakdown/history, rather than as one
// combined interactive message. Technical judgment call, documented here.

export const VOLVER_FOLLOW_UP_BODY = '¿Deseas hacer algo más?';

export const VOLVER_AL_MENU_BUTTONS: InteractiveButton[] = [
  { id: SelfServiceMenuButtonId.VolverAlMenu, title: 'Volver al menú' },
];

// ── Receipt flow ("Ya pagué" / "Reportar un pago") ──────────────────────

export const RECEIPT_REQUEST_MESSAGE =
  'Perfecto, envíanos la foto o el PDF de tu comprobante de pago.';

export const RECEIPT_RECEIVED_MESSAGE =
  'Recibimos tu comprobante, un asesor lo revisará en breve.';

// ── Human handoff ("Hablar con asesor") ──────────────────────────────────

export const ADVISOR_HANDOFF_MESSAGE = 'En un momento un asesor te contactará.';

// ── Breakdown ("Ver mis cuotas" / "Estado de cuenta" / "Cuotas pendientes")
// Reuses the same renderer the old (Phase 9, retired by Phase 33)
// account_summary message type used — see breakdownQueries.ts.

const BREAKDOWN_TEMPLATE = [
  'Hola {{clientFullName}}, este es el desglose de tus cuotas:',
  '{{installmentsList}}',
  'Total pendiente: {{grandTotal}}',
].join('\n');

export function renderBreakdownMessage(
  clientFullName: string,
  installments: AccountSummaryInstallmentForMessage[],
): string {
  if (installments.length === 0) {
    return `Hola ${clientFullName}, no tienes cuotas pendientes en este momento. 🎉`;
  }

  return renderAccountSummaryMessage(
    BREAKDOWN_TEMPLATE,
    clientFullName,
    installments,
  );
}

// ── Payment history ("Historial de pagos") ───────────────────────────────

function renderPaymentHistoryLine(payment: PaymentHistoryEntry): string {
  return (
    `• Cuota No. ${payment.installmentNumber} del pagaré #${payment.promissoryNoteNumber}: ` +
    `$${formatCurrency(payment.amountPaid)}, pagada el ${formatDateEs(payment.paidAt)}.`
  );
}

export function renderPaymentHistoryMessage(
  clientFullName: string,
  payments: PaymentHistoryEntry[],
): string {
  if (payments.length === 0) {
    return `Hola ${clientFullName}, todavía no registramos pagos en tu cuenta.`;
  }

  const lines = payments.map(renderPaymentHistoryLine).join('\n');
  return `Hola ${clientFullName}, este es tu historial de pagos reciente:\n${lines}`;
}
