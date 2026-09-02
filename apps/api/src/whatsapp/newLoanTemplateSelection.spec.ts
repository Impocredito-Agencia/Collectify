import { InstallmentFrequency } from '../loans/entities/loan.entity';

import { MessageType } from './messageType.enum';
import {
  selectNewLoanTemplate,
  selectRefinanceTemplate,
} from './newLoanTemplateSelection';

describe('selectNewLoanTemplate', () => {
  const baseInput = {
    clientFullName: 'Juan Pérez',
    promissoryNoteNumber: '#1190',
    disbursedAt: '2026-08-20',
    description: '- Televisor Samsung 55 pulgadas',
    frequency: InstallmentFrequency.Monthly,
    installments: [
      { amount: 300000, dueDate: '2026-09-01' },
      { amount: 300000, dueDate: '2026-10-01' },
    ],
    initialPayment: null,
  };

  it('picks NewLoanNewClient for a new client with no cuota inicial', () => {
    const result = selectNewLoanTemplate({ ...baseInput, isNewClient: true });

    expect(result.type).toBe(MessageType.NewLoanNewClient);
    expect(result.bodyParameters).toEqual([
      'Señor/a Juan Pérez',
      '#1190',
      '20 de agosto de 2026',
      '- Televisor Samsung 55 pulgadas',
      '$600.000',
      '2',
      'mensuales',
      '$300.000',
      '1 de septiembre de 2026',
    ]);
  });

  it('picks NewLoanExistingClient for an existing client with no cuota inicial', () => {
    const result = selectNewLoanTemplate({ ...baseInput, isNewClient: false });

    expect(result.type).toBe(MessageType.NewLoanExistingClient);
  });

  it('picks NewLoanNewClientInitialInstallment and composes the split totals', () => {
    const result = selectNewLoanTemplate({
      ...baseInput,
      isNewClient: true,
      installments: [
        { amount: 400000, dueDate: '2026-09-10' },
        { amount: 400000, dueDate: '2026-10-10' },
      ],
      initialPayment: 1400000,
    });

    expect(result.type).toBe(MessageType.NewLoanNewClientInitialInstallment);
    expect(result.bodyParameters).toEqual([
      'Señor/a Juan Pérez',
      '#1190',
      '20 de agosto de 2026',
      '- Televisor Samsung 55 pulgadas',
      '$2.200.000',
      '3',
      'mensuales',
      '$1.400.000',
      '2',
      '$400.000',
      '10 de septiembre de 2026',
    ]);
  });

  it('picks NewLoanExistingClientInitialInstallment for an existing client with cuota inicial', () => {
    const result = selectNewLoanTemplate({
      ...baseInput,
      isNewClient: false,
      initialPayment: 500000,
    });

    expect(result.type).toBe(
      MessageType.NewLoanExistingClientInitialInstallment,
    );
  });
});

describe('selectRefinanceTemplate', () => {
  it('always picks RefinanceSingleLoan', () => {
    const result = selectRefinanceTemplate({
      clientFullName: 'Liseth Obando',
      originalPromissoryNoteNumber: '#1029',
      frequency: InstallmentFrequency.Monthly,
      installments: [
        { amount: 201000, dueDate: '2026-08-15' },
        { amount: 201000, dueDate: '2026-09-15' },
      ],
    });

    expect(result.type).toBe(MessageType.RefinanceSingleLoan);
    expect(result.bodyParameters).toEqual([
      'Señor/a Liseth Obando',
      '#1029',
      '$402.000',
      '2',
      'mensuales',
      '$201.000',
      '15 de agosto de 2026',
    ]);
  });
});
