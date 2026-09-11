import { MessageType } from './messageType.enum';
import {
  selectPaidInFullTemplate,
  selectPaymentConfirmationTemplate,
} from './paymentConfirmationTemplateSelection';

describe('selectPaymentConfirmationTemplate', () => {
  it('composes the normal case with no overpayment', () => {
    const result = selectPaymentConfirmationTemplate({
      clientFullName: 'Angela Fajardo',
      installmentNumber: 14,
      promissoryNoteNumber: '778',
      remainingInstallments: 4,
      overpaymentAmount: 0,
    });

    expect(result.type).toBe(MessageType.PaymentConfirmation);
    expect(result.bodyParameters).toEqual([
      'Señor/a Angela Fajardo',
      '14',
      '778',
      '4',
      'Gracias por su atención.',
    ]);
  });

  it('composes the saldo a favor case when there was an overpayment', () => {
    const result = selectPaymentConfirmationTemplate({
      clientFullName: 'Angela Fajardo',
      installmentNumber: 14,
      promissoryNoteNumber: '778',
      remainingInstallments: 4,
      overpaymentAmount: 20000,
    });

    expect(result.bodyParameters.at(-1)).toBe(
      'Cuenta con un saldo a favor de $20.000.',
    );
  });
});

describe('selectPaidInFullTemplate', () => {
  it('composes the normal case', () => {
    const result = selectPaidInFullTemplate({
      clientFullName: 'Nicolas Sarasty',
      promissoryNoteNumber: '922',
      overpaymentAmount: 0,
    });

    expect(result.type).toBe(MessageType.PaidInFull);
    expect(result.bodyParameters).toEqual([
      'Señor/a Nicolas Sarasty',
      '922',
      'Gracias por su atención.',
    ]);
  });

  it('composes the saldo a favor case', () => {
    const result = selectPaidInFullTemplate({
      clientFullName: 'Nicolas Sarasty',
      promissoryNoteNumber: '922',
      overpaymentAmount: 15000,
    });

    expect(result.bodyParameters.at(-1)).toBe(
      'Cuenta con un saldo a favor de $15.000.',
    );
  });
});
