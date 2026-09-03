import {
  AccountSummaryInstallmentForMessage,
  calculateAccountSummaryTotal,
  calculateGrandTotal,
  formatDateEs,
  NewLoanMessageData,
  OverdueInstallmentForMessage,
  renderAccountSummaryMessage,
  renderNewLoanMessage,
  renderOverdueReminderMessage,
  renderUpcomingDueMessage,
  UpcomingInstallmentForMessage,
} from './messageRenderer';

const TEMPLATE = [
  'Hola {{clientFullName}}, tienes cuotas vencidas:',
  '{{installmentsList}}',
  'El valor a pagar hoy es {{grandTotal}}',
].join('\n');

describe('messageRenderer', () => {
  describe('renderOverdueReminderMessage', () => {
    it('renders a single overdue installment', () => {
      const installments: OverdueInstallmentForMessage[] = [
        {
          installmentNumber: 3,
          promissoryNoteNumber: '743',
          totalDue: 520800,
          overdueDays: 740,
        },
      ];

      const message = renderOverdueReminderMessage(
        TEMPLATE,
        'Juana Pérez',
        installments,
      );

      expect(message).toContain('Hola Juana Pérez, tienes cuotas vencidas:');
      expect(message).toContain(
        '1️⃣ La cuota No. 3 del pagaré #743 por $520.800 (incluidos intereses) venció hace 740 días.',
      );
      expect(message).toContain('El valor a pagar hoy es $520.800');
    });

    it('renders multiple installments across multiple loans, numbered in order, with a grand total', () => {
      const installments: OverdueInstallmentForMessage[] = [
        {
          installmentNumber: 3,
          promissoryNoteNumber: '743',
          totalDue: 520800,
          overdueDays: 740,
        },
        {
          installmentNumber: 1,
          promissoryNoteNumber: '959',
          totalDue: 1023360,
          overdueDays: 484,
        },
        {
          installmentNumber: 2,
          promissoryNoteNumber: '959',
          totalDue: 994446,
          overdueDays: 409,
        },
      ];

      const message = renderOverdueReminderMessage(
        TEMPLATE,
        'Juana Pérez',
        installments,
      );

      expect(message).toContain('1️⃣ La cuota No. 3 del pagaré #743');
      expect(message).toContain('2️⃣ La cuota No. 1 del pagaré #959');
      expect(message).toContain('3️⃣ La cuota No. 2 del pagaré #959');
      // 520800 + 1023360 + 994446 = 2538606
      expect(message).toContain('El valor a pagar hoy es $2.538.606');
    });
  });

  describe('calculateGrandTotal', () => {
    it('sums totalDue across every included installment', () => {
      const installments: OverdueInstallmentForMessage[] = [
        {
          installmentNumber: 1,
          promissoryNoteNumber: '743',
          totalDue: 520800,
          overdueDays: 740,
        },
        {
          installmentNumber: 1,
          promissoryNoteNumber: '959',
          totalDue: 1023360,
          overdueDays: 484,
        },
      ];

      expect(calculateGrandTotal(installments)).toBe(1544160);
    });

    it('returns 0 for an empty list', () => {
      expect(calculateGrandTotal([])).toBe(0);
    });
  });

  describe('formatDateEs', () => {
    it('formats a date string in Spanish', () => {
      expect(formatDateEs('2026-05-20')).toBe('20 de mayo de 2026');
    });

    it('does not shift the day near a UTC/local timezone boundary', () => {
      expect(formatDateEs('2026-01-01')).toBe('1 de enero de 2026');
    });
  });

  describe('renderNewLoanMessage', () => {
    const NEW_LOAN_TEMPLATE = [
      'Hola {{clientFullName}}, registramos el pagaré #{{promissoryNoteNumber}}',
      'por concepto de {{loanDescription}}, vigente desde {{disbursedAt}}.',
      'Diferido a {{totalInstallments}} cuotas {{installmentsSummary}}.',
    ].join('\n');

    it('renders "cada una de $X" when every installment amount is equal', () => {
      const data: NewLoanMessageData = {
        clientFullName: 'David Ordoñez',
        promissoryNoteNumber: '1093',
        loanDescription: 'Compra de Apple MacBook Air M5',
        disbursedAt: '2026-05-20',
        totalInstallments: 12,
        installmentAmounts: Array(12).fill(359000) as number[],
      };

      const message = renderNewLoanMessage(NEW_LOAN_TEMPLATE, data);

      expect(message).toContain('registramos el pagaré #1093');
      expect(message).toContain(
        'por concepto de Compra de Apple MacBook Air M5',
      );
      expect(message).toContain('vigente desde 20 de mayo de 2026');
      expect(message).toContain('Diferido a 12 cuotas cada una de $359.000');
    });

    it('renders a per-installment breakdown when amounts vary', () => {
      const data: NewLoanMessageData = {
        clientFullName: 'Ana Ruiz',
        promissoryNoteNumber: '1136',
        loanDescription: null,
        disbursedAt: '2026-06-20',
        totalInstallments: 2,
        installmentAmounts: [650400, 650400],
      };
      const varying: NewLoanMessageData = {
        ...data,
        installmentAmounts: [700000, 600000],
      };

      const message = renderNewLoanMessage(NEW_LOAN_TEMPLATE, varying);

      expect(message).toContain('cuota 1: $700.000, cuota 2: $600.000');
      // Empty description placeholder collapses to nothing, not "null".
      expect(message).not.toContain('null');
    });
  });

  describe('renderUpcomingDueMessage', () => {
    const AVISO_TEMPLATE = [
      'Señor/a {{clientFullName}}',
      '{{installmentsList}}',
      'Le invitamos a realizar su pago en la fecha asignada.',
    ].join('\n');

    it('renders a single upcoming installment', () => {
      const installments: UpcomingInstallmentForMessage[] = [
        {
          installmentNumber: 6,
          promissoryNoteNumber: '957',
          amount: 299000,
          daysUntilDue: 5,
        },
      ];

      const message = renderUpcomingDueMessage(
        AVISO_TEMPLATE,
        'Luis Fernando Rosales',
        installments,
      );

      expect(message).toContain(
        '1️⃣ La cuota No. 6 del pagaré #957 por $299.000 vence en 5 días.',
      );
      expect(message).not.toContain('incluidos intereses');
      expect(message).not.toContain('grandTotal');
    });

    it('renders multiple upcoming installments across multiple loans, without a grand total', () => {
      const installments: UpcomingInstallmentForMessage[] = [
        {
          installmentNumber: 6,
          promissoryNoteNumber: '957',
          amount: 299000,
          daysUntilDue: 5,
        },
        {
          installmentNumber: 4,
          promissoryNoteNumber: '1035',
          amount: 485850,
          daysUntilDue: 7,
        },
      ];

      const message = renderUpcomingDueMessage(
        AVISO_TEMPLATE,
        'Luis Fernando Rosales',
        installments,
      );

      expect(message).toContain('1️⃣ La cuota No. 6 del pagaré #957');
      expect(message).toContain('2️⃣ La cuota No. 4 del pagaré #1035');
      expect(message).not.toContain('{{grandTotal}}');
    });
  });

  describe('renderAccountSummaryMessage', () => {
    const SUMMARY_TEMPLATE = [
      'Hola {{clientFullName}}, este es tu estado de cuenta:',
      '{{installmentsList}}',
      'Total: {{grandTotal}}',
    ].join('\n');

    it('renders an overdue line, an upcoming line, and a due-today line', () => {
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
        {
          installmentNumber: 5,
          promissoryNoteNumber: '743',
          totalDue: 300000,
          overdueDays: 0,
          daysUntilDue: 0,
        },
      ];

      const message = renderAccountSummaryMessage(
        SUMMARY_TEMPLATE,
        'Juana Pérez',
        installments,
      );

      expect(message).toContain('Pagaré #743:');
      expect(message).toContain(
        '1️⃣ Cuota No. 3 por $520.800 venció hace 45 días.',
      );
      expect(message).toContain(
        '2️⃣ Cuota No. 4 por $300.000 vence en 10 días.',
      );
      expect(message).toContain('3️⃣ Cuota No. 5 por $300.000 vence hoy.');
      // 520800 + 300000 + 300000 = 1120800
      expect(message).toContain('Total: $1.120.800');
    });

    // Bug fix, 2026-09-03 (human report): installments from different
    // pagarés were interleaved in dueDate order, hard to follow — now
    // grouped under one header per pagaré, in first-appearance order, with
    // bullet numbering restarting inside each group.
    it('groups installments by pagaré instead of interleaving them by date', () => {
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
          overdueDays: 0,
          daysUntilDue: 5,
        },
        {
          installmentNumber: 4,
          promissoryNoteNumber: '743',
          totalDue: 300000,
          overdueDays: 0,
          daysUntilDue: 10,
        },
      ];

      const message = renderAccountSummaryMessage(
        SUMMARY_TEMPLATE,
        'Juana Pérez',
        installments,
      );

      const pagare743Index = message.indexOf('Pagaré #743:');
      const pagare959Index = message.indexOf('Pagaré #959:');
      const cuota3Index = message.indexOf('1️⃣ Cuota No. 3');
      const cuota4Index = message.indexOf('2️⃣ Cuota No. 4');
      const cuota1Index = message.indexOf('1️⃣ Cuota No. 1');

      // Pagaré #743 (first seen, since its installment came first in the
      // dueDate-sorted input) comes before #959, and both its installments
      // — despite #959's installment being interleaved between them in the
      // input — stay together right under its own header.
      expect(pagare743Index).toBeGreaterThanOrEqual(0);
      expect(pagare959Index).toBeGreaterThan(pagare743Index);
      expect(cuota3Index).toBeGreaterThan(pagare743Index);
      expect(cuota4Index).toBeGreaterThan(cuota3Index);
      expect(cuota4Index).toBeLessThan(pagare959Index);
      expect(cuota1Index).toBeGreaterThan(pagare959Index);
    });

    // Bug fix, 2026-09-03 (human report): past the 10th item, bullets fell
    // back to plain "11.", "12." text instead of staying emoji-based.
    it('composes a bullet from digit keycaps past the 10th item', () => {
      const installments: AccountSummaryInstallmentForMessage[] = Array.from(
        { length: 12 },
        (_, index) => ({
          installmentNumber: index + 1,
          promissoryNoteNumber: '743',
          totalDue: 100000,
          overdueDays: 0,
          daysUntilDue: 5,
        }),
      );

      const message = renderAccountSummaryMessage(
        SUMMARY_TEMPLATE,
        'Juana Pérez',
        installments,
      );

      expect(message).toContain('🔟 Cuota No. 10');
      expect(message).toContain('1️⃣1️⃣ Cuota No. 11');
      expect(message).toContain('1️⃣2️⃣ Cuota No. 12');
      expect(message).not.toContain('11.');
      expect(message).not.toContain('12.');
    });
  });

  describe('calculateAccountSummaryTotal', () => {
    it('sums totalDue across every included installment', () => {
      const installments: AccountSummaryInstallmentForMessage[] = [
        {
          installmentNumber: 1,
          promissoryNoteNumber: '743',
          totalDue: 520800,
          overdueDays: 45,
          daysUntilDue: 0,
        },
        {
          installmentNumber: 2,
          promissoryNoteNumber: '743',
          totalDue: 300000,
          overdueDays: 0,
          daysUntilDue: 10,
        },
      ];

      expect(calculateAccountSummaryTotal(installments)).toBe(820800);
    });

    it('returns 0 for an empty list', () => {
      expect(calculateAccountSummaryTotal([])).toBe(0);
    });
  });
});
