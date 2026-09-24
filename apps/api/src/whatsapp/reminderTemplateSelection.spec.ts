import { MORA_GRACE_PERIOD_DAYS } from '../loans/installments/installmentCalculations';

import { MessageType } from './messageType.enum';
import { NotaAdicionalState } from './notaAdicional';
import {
  selectReminderTemplate,
  SEVERE_MORA_THRESHOLD_DAYS,
} from './reminderTemplateSelection';

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
      'Gracias por su atención.',
    ]);
  });

  it('picks SingleOverdueInstallment for one overdue installment within the mora grace period', () => {
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

  it('picks SingleOverdueInstallmentWithSurcharge past the mora grace period, using totalDue', () => {
    const result = selectReminderTemplate(
      'Jesus Dorado',
      [overdueInstallment({ overdueDays: 20, totalDue: 717000 })],
      [],
      normal,
    );

    expect(result.type).toBe(MessageType.SingleOverdueInstallmentWithSurcharge);
    expect(result.bodyParameters).toContain('$717.000');
    expect(result.bodyParameters).toContain('hace 20 días');
  });

  // Narrowed from 8 to 6 days, 2026-09-09 (client correction) — day 6
  // still has no surcharge, day 7 already does.
  it('stays on the plain SingleOverdueInstallment template exactly at the grace period boundary', () => {
    const result = selectReminderTemplate(
      'Cliente',
      [overdueInstallment({ overdueDays: MORA_GRACE_PERIOD_DAYS })],
      [],
      normal,
    );

    expect(result.type).toBe(MessageType.SingleOverdueInstallment);
  });

  it('switches to SingleOverdueInstallmentWithSurcharge the very next day', () => {
    const result = selectReminderTemplate(
      'Cliente',
      [overdueInstallment({ overdueDays: MORA_GRACE_PERIOD_DAYS + 1 })],
      [],
      normal,
    );

    expect(result.type).toBe(MessageType.SingleOverdueInstallmentWithSurcharge);
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
        overdueInstallment({ overdueDays: 25, totalDue: 717000 }),
        overdueInstallment({ overdueDays: 10, totalDue: 1528000 }),
      ],
      [],
      normal,
    );

    expect(result.type).toBe(MessageType.MultipleOverdueInstallments);
    expect(result.bodyParameters).toEqual([
      'Señor/a Jesus Dorado',
      '2',
      'hace 25 días',
      '$2.245.000',
      'Gracias por su atención.',
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
      'Gracias por su atención.',
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

  // Human report, 2026-09-23 — the *_30dias variants: same parameters as
  // the base template, only chosen once the client's mora (oldest overdue
  // installment) is MORE than 30 days.
  describe('mora of more than 30 days', () => {
    it('keeps the base template exactly at 30 days', () => {
      const result = selectReminderTemplate(
        'Maria Muñoz',
        [overdueInstallment({ overdueDays: SEVERE_MORA_THRESHOLD_DAYS })],
        [],
        normal,
      );

      expect(result.type).toBe(
        MessageType.SingleOverdueInstallmentWithSurcharge,
      );
    });

    it('picks the single-installment 30-day variant at 31 days, same parameters', () => {
      const result = selectReminderTemplate(
        'Maria Muñoz',
        [
          overdueInstallment({
            overdueDays: SEVERE_MORA_THRESHOLD_DAYS + 1,
            totalDue: 350000,
          }),
        ],
        [],
        normal,
      );

      expect(result.type).toBe(
        MessageType.SingleOverdueInstallmentWithSurchargeOver30Days,
      );
      expect(result.bodyParameters).toEqual([
        'Señor/a Maria Muñoz',
        '2',
        '#1190',
        'hace 31 días',
        '$350.000',
        'Gracias por su atención.',
      ]);
    });

    it('picks the multiple-installment 30-day variant when the OLDEST one is past 30 days', () => {
      const result = selectReminderTemplate(
        'Jesus Dorado',
        [
          overdueInstallment({ overdueDays: 85, totalDue: 717000 }),
          overdueInstallment({ overdueDays: 10, totalDue: 1528000 }),
        ],
        [],
        normal,
      );

      expect(result.type).toBe(
        MessageType.MultipleOverdueInstallmentsOver30Days,
      );
      expect(result.bodyParameters).toEqual([
        'Señor/a Jesus Dorado',
        '2',
        'hace 85 días',
        '$2.245.000',
        'Gracias por su atención.',
      ]);
    });

    it('picks the mixed 30-day variant, same parameters', () => {
      const result = selectReminderTemplate(
        'Maria Muñoz',
        [overdueInstallment({ overdueDays: 45, totalDue: 1200000 })],
        [upcomingInstallment({ amount: 600000 })],
        normal,
      );

      expect(result.type).toBe(MessageType.UpcomingAndOverdueMixedOver30Days);
      expect(result.bodyParameters).toEqual([
        'Señor/a Maria Muñoz',
        '1',
        '$1.200.000',
        '1',
        '$600.000',
        'Gracias por su atención.',
      ]);
    });

    it('keeps the base mixed template while every overdue installment is within 30 days', () => {
      const result = selectReminderTemplate(
        'Maria Muñoz',
        [overdueInstallment({ overdueDays: 30 })],
        [upcomingInstallment()],
        normal,
      );

      expect(result.type).toBe(MessageType.UpcomingAndOverdueMixed);
    });
  });
});
