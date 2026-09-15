import { formatTratamiento } from './messageRenderer';
import { MessageType } from './messageType.enum';
import {
  composeConfirmationNotaAdicional,
  NotaAdicionalState,
} from './notaAdicional';

export interface SelectPaymentConfirmationInput {
  clientFullName: string;
  installmentNumber: number;
  promissoryNoteNumber: string;
  // Pending installments still left on this loan AFTER this one — not
  // counting this one, which just became Paid.
  remainingInstallments: number;
  // The client's current saldo a favor (ClientCreditBalanceService's
  // ledger balance), 0 when the message is routed to a loan's alternate
  // contact instead of the client — see PaymentConfirmationService's own
  // comment on both points.
  overpaymentAmount: number;
}

export interface SelectPaidInFullInput {
  clientFullName: string;
  promissoryNoteNumber: string;
  overpaymentAmount: number;
}

export interface TemplateSelectionResult {
  type: MessageType;
  bodyParameters: string[];
}

function notaFor(overpaymentAmount: number): string {
  return composeConfirmationNotaAdicional(
    overpaymentAmount > 0
      ? { state: NotaAdicionalState.SaldoAFavor, amount: overpaymentAmount }
      : { state: NotaAdicionalState.Normal },
  );
}

export function selectPaymentConfirmationTemplate(
  input: SelectPaymentConfirmationInput,
): TemplateSelectionResult {
  return {
    type: MessageType.PaymentConfirmation,
    bodyParameters: [
      formatTratamiento(input.clientFullName),
      String(input.installmentNumber),
      input.promissoryNoteNumber,
      String(input.remainingInstallments),
      notaFor(input.overpaymentAmount),
    ],
  };
}

export function selectPaidInFullTemplate(
  input: SelectPaidInFullInput,
): TemplateSelectionResult {
  return {
    type: MessageType.PaidInFull,
    bodyParameters: [
      formatTratamiento(input.clientFullName),
      input.promissoryNoteNumber,
      notaFor(input.overpaymentAmount),
    ],
  };
}
