import {
  findOldestOverdueInstallment,
  selectCreditReportTemplate,
} from './creditReportTemplateSelection';
import { MessageType } from './messageType.enum';

function overdue(overdueDays: number, totalDue = 100000) {
  return {
    installmentNumber: 1,
    promissoryNoteNumber: '#1001',
    amount: 90000,
    totalDue,
    overdueDays,
  };
}

describe('selectCreditReportTemplate', () => {
  it.each([
    [30, MessageType.CreditReport30Days],
    [50, MessageType.CreditReport50Days],
  ])('picks the template on exactly day %i', (days, type) => {
    expect(
      selectCreditReportTemplate('Miguel Perez', [overdue(days, 250000)]),
    ).toEqual({
      type,
      bodyParameters: ['Señor/a Miguel Perez', '#1001', '$250.000'],
    });
  });

  it.each([1, 29, 31, 49, 51, 90])('sends nothing on day %i', (days) => {
    expect(selectCreditReportTemplate('Miguel Perez', [overdue(days)])).toBe(
      null,
    );
  });

  it('sends nothing with no overdue cuotas', () => {
    expect(selectCreditReportTemplate('Miguel Perez', [])).toBe(null);
  });

  it("counts the pagaré's mora from its oldest cuota, not any cuota", () => {
    expect(
      selectCreditReportTemplate('Miguel Perez', [overdue(44), overdue(30)]),
    ).toBe(null);
  });

  it('sums every overdue cuota of the pagaré in the value', () => {
    const selection = selectCreditReportTemplate('Miguel Perez', [
      overdue(30, 150000),
      overdue(15, 100000),
    ]);

    expect(selection?.bodyParameters[2]).toBe('$250.000');
  });

  it('adds the # to a pagaré number stored without one', () => {
    const selection = selectCreditReportTemplate('Miguel Perez', [
      { ...overdue(30), promissoryNoteNumber: '743' },
    ]);

    expect(selection?.bodyParameters[1]).toBe('#743');
  });
});

describe('findOldestOverdueInstallment', () => {
  it('returns the cuota with the most days overdue', () => {
    expect(
      findOldestOverdueInstallment([overdue(5), overdue(30), overdue(10)])
        ?.overdueDays,
    ).toBe(30);
  });
});
