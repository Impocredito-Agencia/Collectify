import { AccountSummaryInstallmentForMessage } from './messageRenderer';
import { renderBreakdownMessage } from './selfServiceMenuMessages';

describe('renderBreakdownMessage', () => {
  it('says there are no pending installments when the list is empty', () => {
    const message = renderBreakdownMessage('Juana Pérez', []);

    expect(message).toBe(
      'Hola Juana Pérez, no tienes cuotas pendientes en este momento. 🎉',
    );
  });

  // Bug fix, 2026-09-03 (human report): findPendingInstallmentsBreakdown
  // returns every pending installment, overdue or not — a client with only
  // future installments and nothing overdue was getting the full desglose,
  // reading like an alarm for a debt that isn't actually late.
  it('says the client is up to date when nothing is overdue', () => {
    const installments: AccountSummaryInstallmentForMessage[] = [
      {
        installmentNumber: 4,
        promissoryNoteNumber: '743',
        totalDue: 300000,
        overdueDays: 0,
        daysUntilDue: 10,
      },
    ];

    const message = renderBreakdownMessage('Juana Pérez', installments);

    expect(message).toBe('Hola Juana Pérez, estás al día con tus pagos. 🎉');
  });

  it('renders the full desglose when at least one installment is overdue', () => {
    const installments: AccountSummaryInstallmentForMessage[] = [
      {
        installmentNumber: 3,
        promissoryNoteNumber: '743',
        totalDue: 520800,
        overdueDays: 45,
        daysUntilDue: 0,
      },
      {
        installmentNumber: 4,
        promissoryNoteNumber: '743',
        totalDue: 300000,
        overdueDays: 0,
        daysUntilDue: 10,
      },
    ];

    const message = renderBreakdownMessage('Juana Pérez', installments);

    expect(message).toContain('este es el desglose de tus cuotas');
    expect(message).toContain('Pagaré #743:');
    expect(message).toContain(
      '1️⃣ Cuota No. 3 por $520.800 venció hace 45 días.',
    );
    expect(message).toContain('2️⃣ Cuota No. 4 por $300.000 vence en 10 días.');
    // 520800 + 300000 = 820800. Bug fix, 2026-09-03 (human report): matches
    // the confirmed real overdue-reminder phrasing/closing line.
    expect(message).toContain('El valor a pagar hoy es $820.800 🚨');
    expect(message).toContain('Quedamos atentos a cualquier consulta.');
  });

  // Bug fix, 2026-09-03 (human report): installments from different
  // pagarés were interleaved in dueDate order — now grouped under one
  // header per pagaré.
  it('groups the desglose by pagaré', () => {
    const installments: AccountSummaryInstallmentForMessage[] = [
      {
        installmentNumber: 3,
        promissoryNoteNumber: '743',
        totalDue: 520800,
        overdueDays: 45,
        daysUntilDue: 0,
      },
      {
        installmentNumber: 1,
        promissoryNoteNumber: '959',
        totalDue: 200000,
        overdueDays: 10,
        daysUntilDue: 0,
      },
    ];

    const message = renderBreakdownMessage('Juana Pérez', installments);

    const pagare743Index = message.indexOf('Pagaré #743:');
    const pagare959Index = message.indexOf('Pagaré #959:');

    expect(pagare743Index).toBeGreaterThanOrEqual(0);
    expect(pagare959Index).toBeGreaterThan(pagare743Index);
  });
});
