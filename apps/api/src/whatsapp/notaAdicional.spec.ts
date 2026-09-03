import {
  composeConfirmationNotaAdicional,
  composeReminderNotaAdicional,
  NotaAdicionalState,
} from './notaAdicional';

describe('composeReminderNotaAdicional', () => {
  it('returns the normal closing line', () => {
    expect(
      composeReminderNotaAdicional({ state: NotaAdicionalState.Normal }),
    ).toBe('Quedamos atentos a cualquier consulta.');
  });

  it('returns the saldo pendiente line with the formatted amount', () => {
    expect(
      composeReminderNotaAdicional({
        state: NotaAdicionalState.SaldoPendiente,
        amount: 158000,
      }),
    ).toBe(
      'Cuenta con un saldo pendiente de $158.000 por un abono incompleto. ' +
        'Quedamos atentos a cualquier consulta.',
    );
  });

  it('returns the saldo a favor line with the formatted amount', () => {
    expect(
      composeReminderNotaAdicional({
        state: NotaAdicionalState.SaldoAFavor,
        amount: 50000,
      }),
    ).toBe(
      'Cuenta con un saldo a favor de $50.000. Quedamos atentos a cualquier consulta.',
    );
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
  it('returns the normal closing line, without repeating any cierre', () => {
    expect(
      composeConfirmationNotaAdicional({ state: NotaAdicionalState.Normal }),
    ).toBe('Quedamos atentos a cualquier consulta.');
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
