import {
  ConceptCalculationType,
  ConceptCategory,
} from '../../interestConceptTypes/entities/interestConceptType.entity';
import { Installment, InstallmentStatus } from '../entities/installment.entity';
import { LoanInstallmentConcept } from '../entities/loanInstallmentConcept.entity';

import {
  calculateInterest,
  calculateMoratoryCharges,
  calculateOverdueDays,
  calculateTotalDue,
} from './installmentCalculations';

export interface ConceptBreakdownItem {
  name: string;
  amount: number;
  category: ConceptCategory;
  // Added 2026-09-06 (client request — two pagarés made a day apart could
  // carry different rates as the usury ceiling moves, with no way to tell
  // which one a given pagaré actually used just from the currency amount
  // shown per cuota). The % (Percentage) or flat figure (FixedAmount)
  // actually applied — echoes LoanInstallmentConcept.value/calculationType
  // straight through for a corriente item below, and
  // MoratoryChargeItem.value/calculationType for a moratorio item. Optional
  // because calculatePayoff.ts's PayoffQuote also builds this same shape
  // for its corriente line items from a plain { name, amount } projection
  // that has no rate to attach (see PayoffInstallmentInput.corrienteConcepts)
  // — that screen is a "what would this cost today" preview, not "what rate
  // was this pagaré actually made at", so it's out of scope for this
  // addition.
  value?: number;
  calculationType?: ConceptCalculationType;
}

export interface InstallmentWithCalculated extends Installment {
  overdueDays: number;
  interest: number;
  totalDue: number;
  conceptBreakdown: ConceptBreakdownItem[];
}

// A paid installment owes nothing further, regardless of how late it once
// was — overdueDays/interest/totalDue are calculated-on-read per
// docs/DATABASE.md, only meaningful while pending. A cancelled installment
// (superseded by a refinance, per docs/DATABASE.md "Refinancing") is the
// same: it's excluded from active collection, so it owes nothing either —
// moratory charges are omitted entirely in that case, not shown as 0.
//
// Corriente items in conceptBreakdown are read straight from the
// LoanInstallmentConcept rows stored at generation time
// (docs/phases/PHASE_14_INTEREST_CONCEPTS.md) — the schedule doesn't change
// with the passage of time the way mora does. Moratorio items (Phase 23)
// are computed live, on read, via calculateMoratoryCharges — never stored,
// same as mora always has been. `concepts` defaults to [] so every existing
// caller that doesn't need the breakdown (e.g. WhatsApp message rendering)
// is unaffected.
//
// interestRate/calculateInterest (the pre-Phase-23 single-rate formula)
// remains the fallback for any loan with no moratory concepts assigned —
// this is what keeps every loan created before Phase 23 producing identical
// numbers with zero migration required.
export function enrichInstallment(
  installment: Installment,
  interestRate: number,
  concepts: LoanInstallmentConcept[] = [],
): InstallmentWithCalculated {
  const corrienteConcepts = concepts.filter(
    (concept) => concept.category === ConceptCategory.Corriente,
  );
  const moratoryConcepts = concepts.filter(
    (concept) => concept.category === ConceptCategory.Moratorio,
  );
  const corrienteBreakdown = corrienteConcepts.map((concept) => ({
    name: concept.nameSnapshot,
    amount: concept.computedAmount,
    category: ConceptCategory.Corriente,
    value: concept.value,
    calculationType: concept.calculationType,
  }));

  if (installment.status !== InstallmentStatus.Pending) {
    return {
      ...installment,
      overdueDays: 0,
      interest: 0,
      totalDue: 0,
      conceptBreakdown: corrienteBreakdown,
    };
  }

  const overdueDays = calculateOverdueDays(new Date(installment.dueDate));

  if (moratoryConcepts.length === 0) {
    const interest = calculateInterest(
      installment.amount,
      interestRate,
      overdueDays,
    );
    return {
      ...installment,
      overdueDays,
      interest,
      totalDue: calculateTotalDue(installment.amount, interest),
      conceptBreakdown: corrienteBreakdown,
    };
  }

  const moratoryCharges = calculateMoratoryCharges(
    installment.amount,
    overdueDays,
    moratoryConcepts.map((concept) => ({
      name: concept.nameSnapshot,
      calculationType: concept.calculationType,
      value: concept.value,
    })),
  );
  const interest = moratoryCharges.reduce((sum, item) => sum + item.amount, 0);

  return {
    ...installment,
    overdueDays,
    interest,
    totalDue: calculateTotalDue(installment.amount, interest),
    conceptBreakdown: [
      ...corrienteBreakdown,
      ...moratoryCharges.map((item) => ({
        ...item,
        category: ConceptCategory.Moratorio,
      })),
    ],
  };
}
