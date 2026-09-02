import { InstallmentFrequency } from '../loans/entities/loan.entity';

import {
  formatCurrency,
  formatDateEs,
  formatTratamiento,
} from './messageRenderer';
import { MessageType } from './messageType.enum';

function frequencyLabel(frequency: InstallmentFrequency): string {
  switch (frequency) {
    case InstallmentFrequency.Monthly:
      return 'mensuales';
    case InstallmentFrequency.Biweekly:
      return 'quincenales';
  }
}

function money(amount: number): string {
  return `$${formatCurrency(amount)}`;
}

export interface NewLoanTemplateInstallment {
  amount: number;
  dueDate: string;
}

export interface SelectNewLoanTemplateInput {
  clientFullName: string;
  promissoryNoteNumber: string;
  disbursedAt: string;
  description: string | null;
  frequency: InstallmentFrequency;
  // Excludes the "cuota inicial" — per docs/phases/PHASE_13_INITIAL_INSTALLMENT.md
  // and Loan.initialPayment's own doc comment, the down payment is purely
  // informational and is never one of the loan's tracked installments.
  installments: NewLoanTemplateInstallment[];
  // Loan.initialPayment — null when there was no down payment.
  initialPayment: number | null;
  // Whether this is the client's first loan ever (no other loan on file,
  // any status) — confirmed by the human (2026-09-01) as the exact
  // "cliente nuevo" definition. Irrelevant for a refinance, since a
  // refinanced client always already had a loan.
  isNewClient: boolean;
}

export interface SelectRefinanceTemplateInput {
  clientFullName: string;
  // The pagaré being refinanced — NOT the new one.
  originalPromissoryNoteNumber: string;
  frequency: InstallmentFrequency;
  installments: NewLoanTemplateInstallment[];
}

export interface TemplateSelectionResult {
  type: MessageType;
  bodyParameters: string[];
}

// Templates 1 & 2 (new loan) — see docs/phases/PHASE_33_MESSAGE_TEMPLATES_V2.md
// for the exact body/parameter order this mirrors.
export function selectNewLoanTemplate(
  input: SelectNewLoanTemplateInput,
): TemplateSelectionResult {
  const [firstInstallment] = input.installments;
  const tratamiento = formatTratamiento(input.clientFullName);
  const frequency = frequencyLabel(input.frequency);
  const trackedTotal = input.installments.reduce(
    (sum, installment) => sum + installment.amount,
    0,
  );

  if (input.initialPayment != null) {
    const totalWithInitialPayment = input.initialPayment + trackedTotal;
    const type = input.isNewClient
      ? MessageType.NewLoanNewClientInitialInstallment
      : MessageType.NewLoanExistingClientInitialInstallment;

    return {
      type,
      bodyParameters: [
        tratamiento,
        input.promissoryNoteNumber,
        formatDateEs(input.disbursedAt),
        input.description ?? '',
        money(totalWithInitialPayment),
        // +1 to count the cuota inicial alongside the tracked installments
        // in the intro's "diferido en N cuotas" — see the worked example
        // in the phase doc (10 = 1 inicial + 9 restantes).
        String(input.installments.length + 1),
        frequency,
        money(input.initialPayment),
        String(input.installments.length),
        money(firstInstallment.amount),
        formatDateEs(firstInstallment.dueDate),
      ],
    };
  }

  const type = input.isNewClient
    ? MessageType.NewLoanNewClient
    : MessageType.NewLoanExistingClient;

  return {
    type,
    bodyParameters: [
      tratamiento,
      input.promissoryNoteNumber,
      formatDateEs(input.disbursedAt),
      input.description ?? '',
      money(trackedTotal),
      String(input.installments.length),
      frequency,
      money(firstInstallment.amount),
      formatDateEs(firstInstallment.dueDate),
    ],
  };
}

// Template 3 — single-loan refinance only. A multi-loan merge reuses
// NewLoanExistingClient instead (selectNewLoanTemplate above), with the
// merged pagarés listed in `description` — no special handling needed
// here, per the phase doc.
export function selectRefinanceTemplate(
  input: SelectRefinanceTemplateInput,
): TemplateSelectionResult {
  const [firstInstallment] = input.installments;
  const total = input.installments.reduce(
    (sum, installment) => sum + installment.amount,
    0,
  );

  return {
    type: MessageType.RefinanceSingleLoan,
    bodyParameters: [
      formatTratamiento(input.clientFullName),
      input.originalPromissoryNoteNumber,
      money(total),
      String(input.installments.length),
      frequencyLabel(input.frequency),
      money(firstInstallment.amount),
      formatDateEs(firstInstallment.dueDate),
    ],
  };
}
