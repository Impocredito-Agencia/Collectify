import { MessageType } from './messageType.enum';
import { NotaAdicionalState } from './notaAdicional';
import { selectReminderTemplate } from './reminderTemplateSelection';

const normal = { state: NotaAdicionalState.Normal };

function overdueInstallment(overrides = {}) {
  return {
    installmentNumber: 2,
    promissoryNoteNumber: '#1190',
    amount: 300000,
    totalDue: 300000,
    overdueDays: 3,
    ...overrides,
  };
}

function upcomingInstallment(overrides = {}) {
  return {
    installmentNumber: 3,
    promissoryNoteNumber: '#1039',
    amount: 2052000,
    daysUntilDue: 5,
    ...overrides,
  };
}

describe('selectReminderTemplate', () => {
  it('picks UpcomingAndOverdueMixed when the client has both', () => {
    const result = selectReminderTemplate(
      'Maria Muñoz',
      [overdueInstallment({ totalDue: 1200000 })],
      [upcomingInstallment({ amount: 600000 })],
      normal,
    );

    expect(result.type).toBe(MessageType.UpcomingAndOverdueMixed);
    expect(result.bodyParameters).toEqual([
      'Señor/a Maria Muñoz',
      '1',
      '$1.200.000',
      '1',
      '$600.000',
      'Quedamos atentos a cualquier consulta.',
    ]);
  });

  it('picks SingleOverdueInstallment for one overdue installment within 8 days', () => {
    const result = selectReminderTemplate(
      'Fernando Villota',
      [overdueInstallment({ overdueDays: 3, amount: 300000 })],
      [],
      normal,
    );

    expect(result.type).toBe(MessageType.SingleOverdueInstallment);
    expect(result.bodyParameters[3]).toBe('$300.000');
    expect(result.bodyParameters[4]).toBe('hace 3 días');
  });

  it('picks SingleOverdueInstallmentWithSurcharge past day 8, using totalDue', () => {
    const result = selectReminderTemplate(
      'Jesus Dorado',
      [overdueInstallment({ overdueDays: 85, totalDue: 717000 })],
      [],
      normal,
    );

    expect(result.type).toBe(MessageType.SingleOverdueInstallmentWithSurcharge);
    expect(result.bodyParameters).toContain('$717.000');
    expect(result.bodyParameters).toContain('hace 85 días');
  });

  it('uses singular "hace 1 día" for exactly one overdue day', () => {
    const result = selectReminderTemplate(
      'Cliente',
      [overdueInstallment({ overdueDays: 1 })],
      [],
      normal,
    );

    expect(result.bodyParameters).toContain('hace 1 día');
  });

  it('picks MultipleOverdueInstallments for more than one overdue installment', () => {
    const result = selectReminderTemplate(
      'Jesus Dorado',
      [
        overdueInstallment({ overdueDays: 85, totalDue: 717000 }),
        overdueInstallment({ overdueDays: 10, totalDue: 1528000 }),
      ],
      [],
      normal,
    );

    expect(result.type).toBe(MessageType.MultipleOverdueInstallments);
    expect(result.bodyParameters).toEqual([
      'Señor/a Jesus Dorado',
      '2',
      'hace 85 días',
      '$2.245.000',
      'Quedamos atentos a cualquier consulta.',
    ]);
  });

  it('picks SingleUpcomingInstallment for one upcoming installment', () => {
    const result = selectReminderTemplate(
      'Maria Muñoz',
      [],
      [upcomingInstallment({ daysUntilDue: 0 })],
      normal,
    );

    expect(result.type).toBe(MessageType.SingleUpcomingInstallment);
    expect(result.bodyParameters).toContain('hoy');
  });

  it('uses "mañana" for exactly 1 day until due', () => {
    const result = selectReminderTemplate(
      'Maria Muñoz',
      [],
      [upcomingInstallment({ daysUntilDue: 1 })],
      normal,
    );

    expect(result.bodyParameters).toContain('mañana');
  });

  it('picks MultipleUpcomingInstallments for more than one upcoming installment', () => {
    const result = selectReminderTemplate(
      'Nicolas Sarasty',
      [],
      [
        upcomingInstallment({ amount: 300000, daysUntilDue: 3 }),
        upcomingInstallment({ amount: 300000, daysUntilDue: 1 }),
      ],
      normal,
    );

    expect(result.type).toBe(MessageType.MultipleUpcomingInstallments);
    expect(result.bodyParameters).toEqual([
      'Señor/a Nicolas Sarasty',
      '2',
      '$600.000',
      'mañana',
      'Quedamos atentos a cualquier consulta.',
    ]);
  });

  it('includes the saldo pendiente note when passed', () => {
    const result = selectReminderTemplate(
      'Cliente',
      [overdueInstallment()],
      [],
      { state: NotaAdicionalState.SaldoPendiente, amount: 50000 },
    );

    expect(result.bodyParameters.at(-1)).toContain(
      'saldo pendiente de $50.000',
    );
  });
});
