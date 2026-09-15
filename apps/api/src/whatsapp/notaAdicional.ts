import { formatCurrency } from './messageRenderer';

// The "nota adicional" mechanism — see
// docs/phases/PHASE_33_MESSAGE_TEMPLATES_V2.md. Fills the shared closing
// {{n}} parameter on every reminder/confirmation template (4 through 10)
// with exactly one of three fixed strings, since Meta templates can't show
// or hide a line conditionally.
//
// This module only composes the STRING once the caller already knows which
// of the three cases applies and, if relevant, the dollar amount — it does
// NOT decide which case applies. Deciding whether a given client currently
// has a saldo pendiente (incomplete/partial payment) or a saldo a favor
// (unclaimed credit, per ClientCreditBalanceService) is separate domain
// logic — see saldoPendiente.ts and OverdueReminderService/
// UpcomingDueReminderService's resolveNotaAdicional for the reminder
// family, and PaymentConfirmationService for the confirmation family.
// Callers that don't have that detection wired up (or that deliberately
// suppress it, e.g. a loan's alternate contact) should pass
// NotaAdicionalState.Normal.
export enum NotaAdicionalState {
  Normal = 'normal',
  SaldoPendiente = 'saldo_pendiente',
  SaldoAFavor = 'saldo_a_favor',
}

export interface NotaAdicionalInput {
  state: NotaAdicionalState;
  // Required (and only meaningful) for SaldoPendiente/SaldoAFavor.
  amount?: number;
}

function requireAmount(input: NotaAdicionalInput): number {
  if (input.amount === undefined) {
    throw new Error(`NotaAdicionalState.${input.state} requires an amount`);
  }
  return input.amount;
}

// For Templates 4, 5, 6 (both variants), 7, 8 — this parameter is the LAST
// one in the body. Human report, 2026-09-19: the plan when this was
// designed (see docs/phases/PHASE_33_MESSAGE_TEMPLATES_V2.md) was for
// this parameter to fully replace the old fixed "Quedamos atentos a
// cualquier consulta." closing line — but the templates actually
// submitted to and approved by Meta kept that line as static body text
// after this parameter's slot. Every case here used to end with the same
// phrase, so the normal case printed it twice back to back, and the two
// balance cases printed it as a redundant echo right after the balance
// sentence. Meta's approved body text can't be edited from here (would
// need re-submission/re-approval), so the fix is on this side: the normal
// case now says something that doesn't repeat the template's own closing,
// and the balance cases stop appending it a second time.
export function composeReminderNotaAdicional(
  input: NotaAdicionalInput,
): string {
  switch (input.state) {
    case NotaAdicionalState.Normal:
      return 'Gracias por su atención.';
    case NotaAdicionalState.SaldoPendiente:
      return `Cuenta con un saldo pendiente de $${formatCurrency(requireAmount(input))} por un abono incompleto.`;
    case NotaAdicionalState.SaldoAFavor:
      return `Cuenta con un saldo a favor de $${formatCurrency(requireAmount(input))}.`;
  }
}

// For Templates 9 and 10 — the fixed closing line ("Que tenga un feliz
// día. 🤝") doesn't overlap with this parameter, so it stays in its
// original spot and only carries the data. SaldoPendiente doesn't apply
// here (a payment confirmation/paz y salvo is only sent once an
// installment/loan is fully settled — there's never an incomplete abono to
// report at that moment). Normal case fixed 2026-09-19 alongside
// composeReminderNotaAdicional's identical issue — same "Gracias por su
// atención." text, for consistency between the two families of templates.
export function composeConfirmationNotaAdicional(
  input: Omit<NotaAdicionalInput, 'state'> & {
    state: NotaAdicionalState.Normal | NotaAdicionalState.SaldoAFavor;
  },
): string {
  switch (input.state) {
    case NotaAdicionalState.Normal:
      return 'Gracias por su atención.';
    case NotaAdicionalState.SaldoAFavor:
      return `Cuenta con un saldo a favor de $${formatCurrency(requireAmount(input))}.`;
  }
}
