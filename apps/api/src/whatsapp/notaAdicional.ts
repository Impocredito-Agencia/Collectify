import { formatCurrency } from './messageRenderer';

// The "nota adicional" mechanism — see
// docs/phases/PHASE_33_MESSAGE_TEMPLATES_V2.md. Fills the shared closing
// {{n}} parameter on every reminder/confirmation template (4 through 10)
// with exactly one of three fixed strings, since Meta templates can't show
// or hide a line conditionally.
//
// This module only composes the STRING once the caller already knows which
// of the three cases applies and, if relevant, the dollar amount — it does
// NOT decide which case applies. Whether a given client currently has a
// saldo pendiente (incomplete/partial payment) or a saldo a favor
// (overpayment) is a separate piece of domain logic this phase hasn't
// built yet — see the phase doc's Open questions. Callers that don't have
// that detection wired up yet should pass NotaAdicionalState.Normal.
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
// one in the body and replaces the old fixed "Quedamos atentos..." closing
// line, so the normal case doesn't repeat it.
export function composeReminderNotaAdicional(
  input: NotaAdicionalInput,
): string {
  switch (input.state) {
    case NotaAdicionalState.Normal:
      return 'Quedamos atentos a cualquier consulta.';
    case NotaAdicionalState.SaldoPendiente:
      return (
        `Cuenta con un saldo pendiente de $${formatCurrency(requireAmount(input))} ` +
        'por un abono incompleto. Quedamos atentos a cualquier consulta.'
      );
    case NotaAdicionalState.SaldoAFavor:
      return (
        `Cuenta con un saldo a favor de $${formatCurrency(requireAmount(input))}. ` +
        'Quedamos atentos a cualquier consulta.'
      );
  }
}

// For Templates 9 and 10 — the fixed closing line ("Que tenga un feliz
// día. 🤝") doesn't overlap with this parameter, so it stays in its
// original spot and only carries the data. SaldoPendiente doesn't apply
// here (a payment confirmation/paz y salvo is only sent once an
// installment/loan is fully settled — there's never an incomplete abono to
// report at that moment).
export function composeConfirmationNotaAdicional(
  input: Omit<NotaAdicionalInput, 'state'> & {
    state: NotaAdicionalState.Normal | NotaAdicionalState.SaldoAFavor;
  },
): string {
  switch (input.state) {
    case NotaAdicionalState.Normal:
      return 'Quedamos atentos a cualquier consulta.';
    case NotaAdicionalState.SaldoAFavor:
      return `Cuenta con un saldo a favor de $${formatCurrency(requireAmount(input))}.`;
  }
}
