import {
  ConceptCalculationType,
  ConceptCategory,
} from '../interestConceptTypes/entities/interestConceptType.entity';

import { Installment } from './entities/installment.entity';
import { InstallmentFrequency, Loan, LoanStatus } from './entities/loan.entity';
import { LoanInstallmentConcept } from './entities/loanInstallmentConcept.entity';

export interface OriginationCharge {
  name: string;
  category: ConceptCategory;
  calculationType: ConceptCalculationType;
  value: number;
}

// Human request, 2026-11-05 — "necesitamos poder saber a qué tasa se les
// financió a los clientes, es decir, cómo fue creado el crédito": the terms a
// pagaré was created with, read back from what was stored at creation.
// Nothing here is recomputed; a figure that was never stored is null ("solo
// mostrar lo que hay", confirmed with the human).
export interface LoanOriginationTerms {
  loanId: string;
  promissoryNoteNumber: string;
  status: LoanStatus;
  disbursedAt: string;
  createdAt: Date;
  // The capital financed by the cuotas (the cuota inicial is separate).
  principalAmount: number;
  installmentFrequency: InstallmentFrequency;
  // Cuotas of the financed capital, the cuota inicial not counted.
  financedInstallments: number;
  downPaymentAmount: number | null;
  // The cuota amount of the first financed cuota (capital + corriente
  // interest + fees, as stored).
  installmentAmount: number | null;
  // The system interest rates (LoansService.resolveConceptsWithInterest),
  // as the % snapshotted on the cuotas. Corriente is charged per cuota on the
  // remaining balance (per month or per fortnight, per the frequency);
  // moratorio is monthly, prorated per overdue day. null when the pagaré
  // carries no such rate (e.g. a loan typed in before rates were stored).
  corrienteInterestRate: number | null;
  moratoryInterestRate: number | null;
  // Optional catalog fees assigned at creation (interest_concept_types).
  otherCharges: OriginationCharge[];
  refinancedFromLoanId: string | null;
  refinanceMoraWaivedAmount: number;
  refinanceMoraWaiverReason: string | null;
}

// A system rate is the system-generated concept (no catalog type) of that
// category, stored as a percentage.
function systemRate(
  concepts: LoanInstallmentConcept[],
  category: ConceptCategory,
): number | null {
  const concept = concepts.find(
    (item) =>
      item.category === category &&
      item.interestConceptTypeId === null &&
      item.calculationType === ConceptCalculationType.Percentage,
  );
  return concept ? concept.value : null;
}

// `installments` is every installment of the loan (any status — a refinanced
// loan's are cancelled, the terms still apply); `firstFinancedConcepts` the
// concepts of its first non-down-payment installment, which carries the
// loan's rates (the same on every cuota — see ConceptBreakdownItem.value).
export function buildOriginationTerms(
  loan: Loan,
  installments: Installment[],
  firstFinancedConcepts: LoanInstallmentConcept[],
): LoanOriginationTerms {
  const downPayment = installments.find(
    (installment) => installment.isDownPayment,
  );
  const financed = installments
    .filter((installment) => !installment.isDownPayment)
    .sort((a, b) => a.installmentNumber - b.installmentNumber);

  return {
    loanId: loan.id,
    promissoryNoteNumber: loan.promissoryNoteNumber,
    status: loan.status,
    disbursedAt: loan.disbursedAt,
    createdAt: loan.createdAt,
    principalAmount: loan.principalAmount,
    installmentFrequency: loan.installmentFrequency,
    financedInstallments: financed.length,
    downPaymentAmount: downPayment ? downPayment.amount : null,
    installmentAmount: financed.length > 0 ? financed[0].amount : null,
    corrienteInterestRate: systemRate(
      firstFinancedConcepts,
      ConceptCategory.Corriente,
    ),
    moratoryInterestRate: systemRate(
      firstFinancedConcepts,
      ConceptCategory.Moratorio,
    ),
    otherCharges: firstFinancedConcepts
      .filter((concept) => concept.interestConceptTypeId !== null)
      .map((concept) => ({
        name: concept.nameSnapshot,
        category: concept.category,
        calculationType: concept.calculationType,
        value: concept.value,
      })),
    refinancedFromLoanId: loan.refinancedFromLoanId,
    refinanceMoraWaivedAmount: loan.refinanceMoraWaivedAmount ?? 0,
    refinanceMoraWaiverReason: loan.refinanceMoraWaiverReason ?? null,
  };
}
