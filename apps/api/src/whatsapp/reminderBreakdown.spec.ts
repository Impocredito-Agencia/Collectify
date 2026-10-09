import { renderReminderBreakdown } from './reminderBreakdown';
import {
  ReminderOverdueInstallment,
  ReminderUpcomingInstallment,
} from './reminderTemplateSelection';

const overdue = (
  overrides: Partial<ReminderOverdueInstallment> = {},
): ReminderOverdueInstallment => ({
  installmentNumber: 3,
  promissoryNoteNumber: '743',
  amount: 100000,
  totalDue: 112500,
  overdueDays: 20,
  ...overrides,
});

const upcoming = (
  overrides: Partial<ReminderUpcomingInstallment> = {},
): ReminderUpcomingInstallment => ({
  installmentNumber: 5,
  promissoryNoteNumber: '743',
  amount: 100000,
  daysUntilDue: 3,
  ...overrides,
});

describe('renderReminderBreakdown', () => {
  it('returns null for a single overdue cuota', () => {
    expect(renderReminderBreakdown([overdue()], [])).toBeNull();
  });

  it('returns null for a single upcoming cuota', () => {
    expect(renderReminderBreakdown([], [upcoming()])).toBeNull();
  });

  it('returns null when there is nothing to list', () => {
    expect(renderReminderBreakdown([], [])).toBeNull();
  });

  it('lists each overdue cuota with its own total, grouped by pagaré', () => {
    const breakdown = renderReminderBreakdown(
      [
        overdue(),
        overdue({ installmentNumber: 4, totalDue: 100000, overdueDays: 4 }),
        overdue({
          installmentNumber: 1,
          promissoryNoteNumber: '#959',
          totalDue: 250000,
          overdueDays: 35,
        }),
      ],
      [],
    );

    expect(breakdown).toBe(
      'Pagaré #743:\n\n' +
        '1️⃣ Cuota No. 3 por $112.500 (recargos incluidos) venció hace 20 días.\n' +
        '2️⃣ Cuota No. 4 por $100.000 venció hace 4 días.\n\n' +
        'Pagaré #959:\n\n' +
        '1️⃣ Cuota No. 1 por $250.000 (recargos incluidos) venció hace 35 días.',
    );
  });

  it('lists overdue cuotas first, then upcoming ones by their plain amount', () => {
    const breakdown = renderReminderBreakdown(
      [overdue()],
      [upcoming(), upcoming({ installmentNumber: 6, daysUntilDue: 0 })],
    );

    expect(breakdown).toBe(
      'Pagaré #743:\n\n' +
        '1️⃣ Cuota No. 3 por $112.500 (recargos incluidos) venció hace 20 días.\n' +
        '2️⃣ Cuota No. 5 por $100.000 vence en 3 días.\n' +
        '3️⃣ Cuota No. 6 por $100.000 vence hoy.',
    );
  });
});
