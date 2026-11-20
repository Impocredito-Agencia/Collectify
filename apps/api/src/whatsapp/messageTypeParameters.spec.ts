import { InstallmentFrequency } from '../loans/entities/loan.entity';

import { selectCreditReportTemplate } from './creditReportTemplateSelection';
import { MessageType } from './messageType.enum';
import {
  exampleParametersFor,
  MESSAGE_TYPE_PARAMETERS,
} from './messageTypeParameters';
import {
  selectNewLoanTemplate,
  selectRefinanceTemplate,
} from './newLoanTemplateSelection';
import { NotaAdicionalState } from './notaAdicional';
import {
  selectPaidInFullTemplate,
  selectPaymentConfirmationTemplate,
} from './paymentConfirmationTemplateSelection';
import {
  ReminderOverdueInstallment,
  ReminderUpcomingInstallment,
  selectReminderTemplate,
  TemplateSelectionResult,
} from './reminderTemplateSelection';

const NAME = 'Juana Pérez';
const NOTA = { state: NotaAdicionalState.Normal };

function overdue(overdueDays: number): ReminderOverdueInstallment {
  return {
    installmentNumber: 3,
    promissoryNoteNumber: '#1021',
    amount: 150000,
    totalDue: 165000,
    overdueDays,
  };
}

function upcoming(daysUntilDue: number): ReminderUpcomingInstallment {
  return {
    installmentNumber: 4,
    promissoryNoteNumber: '#1021',
    amount: 150000,
    daysUntilDue,
  };
}

const installments = [
  { amount: 150000, dueDate: '2026-12-09' },
  { amount: 150000, dueDate: '2027-01-09' },
];
const newLoanInput = {
  clientFullName: NAME,
  promissoryNoteNumber: '#1021',
  disbursedAt: '2026-11-09',
  description: 'Celular',
  frequency: InstallmentFrequency.Monthly,
  installments,
};

// Every real selection the senders can make, one or more per MessageType.
function allSelections(): TemplateSelectionResult[] {
  const selections: (TemplateSelectionResult | null)[] = [
    selectReminderTemplate(NAME, [], [upcoming(3)], NOTA),
    selectReminderTemplate(NAME, [], [upcoming(3), upcoming(5)], NOTA),
    selectReminderTemplate(NAME, [overdue(3)], [], NOTA),
    selectReminderTemplate(NAME, [overdue(12)], [], NOTA),
    selectReminderTemplate(NAME, [overdue(35)], [], NOTA),
    selectReminderTemplate(NAME, [overdue(12), overdue(20)], [], NOTA),
    selectReminderTemplate(NAME, [overdue(12), overdue(35)], [], NOTA),
    selectReminderTemplate(NAME, [overdue(12)], [upcoming(3)], NOTA),
    selectReminderTemplate(NAME, [overdue(35)], [upcoming(3)], NOTA),
    selectCreditReportTemplate(NAME, [overdue(30)]),
    selectCreditReportTemplate(NAME, [overdue(50)]),
    selectNewLoanTemplate({
      ...newLoanInput,
      downPayment: null,
      isNewClient: true,
    }),
    selectNewLoanTemplate({
      ...newLoanInput,
      downPayment: null,
      isNewClient: false,
    }),
    selectNewLoanTemplate({
      ...newLoanInput,
      downPayment: { amount: 300000, dueDate: '2026-11-20' },
      isNewClient: true,
    }),
    selectNewLoanTemplate({
      ...newLoanInput,
      downPayment: { amount: 300000, dueDate: '2026-11-20' },
      isNewClient: false,
    }),
    selectRefinanceTemplate({
      clientFullName: NAME,
      originalPromissoryNoteNumber: '#1021',
      frequency: InstallmentFrequency.Monthly,
      installments,
    }),
    selectPaymentConfirmationTemplate({
      clientFullName: NAME,
      installmentNumber: 3,
      promissoryNoteNumber: '#1021',
      remainingInstallments: 7,
      overpaymentAmount: 0,
    }),
    selectPaidInFullTemplate({
      clientFullName: NAME,
      promissoryNoteNumber: '#1021',
      overpaymentAmount: 0,
    }),
  ];
  return selections.filter(
    (selection): selection is TemplateSelectionResult => selection !== null,
  );
}

describe('MESSAGE_TYPE_PARAMETERS', () => {
  it('describes as many parameters as each real selection sends', () => {
    for (const selection of allSelections()) {
      expect({
        type: selection.type,
        count: MESSAGE_TYPE_PARAMETERS[selection.type].length,
      }).toEqual({
        type: selection.type,
        count: selection.bodyParameters.length,
      });
    }
  });

  it('is checked against a real selection for every message type', () => {
    const covered = new Set(allSelections().map((s) => s.type));
    expect([...covered].sort()).toEqual(Object.values(MessageType).sort());
  });

  it('gives a non-empty example for every parameter', () => {
    for (const type of Object.values(MessageType)) {
      expect(exampleParametersFor(type).every(Boolean)).toBe(true);
    }
  });
});
