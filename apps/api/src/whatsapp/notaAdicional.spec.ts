import {
  composeConfirmationNotaAdicional,
  composeReminderNotaAdicional,
  NotaAdicionalState,
} from './notaAdicional';

describe('composeReminderNotaAdicional', () => {
  // Human report, 2026-09-19 — the template actually approved by Meta
  // keeps "Quedamos atentos a cualquier consulta." as fixed closing body
  // text after this parameter's slot, so this case used to print it a
  // second time right after it. See this function's own doc comment.
  it('returns a closing line that does not repeat the template\'s own "Quedamos atentos" line', () => {
    expect(
      composeReminderNotaAdicional({ state: NotaAdicionalState.Normal }),
    ).toBe('Gracias por su atención.');
  });

  it('returns the saldo pendiente line with the formatted amount, without repeating "Quedamos atentos"', () => {
    expect(
      composeReminderNotaAdicional({
        state: NotaAdicionalState.SaldoPendiente,
        amount: 158000,
      }),
    ).toBe(
      'Cuenta con un saldo pendiente de $158.000 por un abono incompleto.',
    );
  });

  it('returns the saldo a favor line with the formatted amount, without repeating "Quedamos atentos"', () => {
    expect(
      composeReminderNotaAdicional({
        state: NotaAdicionalState.SaldoAFavor,
        amount: 50000,
      }),
    ).toBe('Cuenta con un saldo a favor de $50.000.');
  });

  it('throws when saldo pendiente is requested without an amount', () => {
    expect(() =>
      composeReminderNotaAdicional({
        state: NotaAdicionalState.SaldoPendiente,
      }),
    ).toThrow();
  });

  it('throws when saldo a favor is requested without an amount', () => {
    expect(() =>
      composeReminderNotaAdicional({ state: NotaAdicionalState.SaldoAFavor }),
    ).toThrow();
  });
});

describe('composeConfirmationNotaAdicional', () => {
  it('returns a closing line that does not repeat any cierre', () => {
    expect(
      composeConfirmationNotaAdicional({ state: NotaAdicionalState.Normal }),
    ).toBe('Gracias por su atención.');
  });

  it('returns the saldo a favor line without repeating "Quedamos atentos"', () => {
    expect(
      composeConfirmationNotaAdicional({
        state: NotaAdicionalState.SaldoAFavor,
        amount: 200000,
      }),
    ).toBe('Cuenta con un saldo a favor de $200.000.');
  });

  it('throws when saldo a favor is requested without an amount', () => {
    expect(() =>
      composeConfirmationNotaAdicional({
        state: NotaAdicionalState.SaldoAFavor,
      }),
    ).toThrow();
  });
});
