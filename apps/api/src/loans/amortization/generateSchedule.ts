import {
  ConceptCalculationType,
  FixedAmountDistribution,
} from '../../interestConceptTypes/entities/interestConceptType.entity';

export interface ConceptAssignment {
  // Null for the system-generated corriente/moratorio interest concept
  // (not a catalog entry — see LoansService.buildInterestConceptAssignment()).
  // Always a real id for catalog-driven concepts.
  conceptTypeId: string | null;
  name: string;
  calculationType: ConceptCalculationType;
  value: number;
  // Required (validated at the DTO layer — "no silent default", see
  // docs/phases/PHASE_23_DYNAMIC_CHARGES.md) whenever calculationType is
  // FixedAmount. Unused for Percentage concepts.
  fixedAmountDistribution?: FixedAmountDistribution;
}

export interface GeneratedInstallmentConcept extends ConceptAssignment {
  computedAmount: number;
}

export interface GeneratedInstallment {
  installmentNumber: number;
  principalPortion: number;
  amount: number;
  concepts: GeneratedInstallmentConcept[];
}

// Amortization algorithm — capital fijo ("German"-style, constant
// principal), confirmed with the human 2026-09-04 against their real,
// actual Excel calculator: the principal portion is split evenly across
// every installment (principalAmount / totalInstallments, last
// installment absorbs the rounding remainder), and every percentage-type
// concept (corriente/moratorio interest, catalog fees) is computed on the
// outstanding balance *before* that installment's own principal is
// deducted — same convention the Excel uses ("capital pendiente" column).
//
// This reverses Phase 14's later "corrected to French" decision (see
// docs/phases/PHASE_14_INTEREST_CONCEPTS.md) — that level-total-payment
// ("cuota fija") model was internally consistent but doesn't match how
// the business actually calculates real loans, and for the same nominal
// rate produces meaningfully more total interest than capital fijo (the
// level-payment method back-loads principal repayment, so the balance —
// and therefore the interest charged on it — stays higher for longer).
// Confirmed via AskUserQuestion, 2026-09-04.
//
// "Cuota con interés" smoothing (confirmed with the human, 2026-09-04,
// same conversation as the down-payment/capital-fijo work — the client's
// Excel goes one step further than plain capital fijo): under pure
// capital fijo the total declines every period, because the principal
// share is constant while the balance it's charged interest on keeps
// shrinking. The client doesn't actually charge that declining number —
// they sum every period's true (declining) total, divide by
// totalInstallments, and round to the nearest $100, then charge that
// *identical* amount every single installment, including the last.
// People want to pay a round number like $124,200 every month, not
// $124,245 one month and $119,830 the next. The averaging step by itself
// preserves total interest exactly — capital fijo's true (lower, vs.
// level-payment/French) total interest is simply spread out evenly
// instead of front-loaded. The $100 rounding on top of that is a small,
// bounded nudge (at most ~$50 × totalInstallments over the life of the
// loan, in either direction) — not a new interest charge, just the same
// cosmetic rounding the client already applies by hand.
//
// Narrowed from the nearest $1,000 to the nearest $100, 2026-09-08
// (client request) — $1,000 rounded too aggressively for the client's
// taste; $100 keeps the "round number" convenience while landing much
// closer to the true, unrounded figure.
//
// Every individual concept is smoothed this way too (confirmed with the
// human), not just the aggregate total — a loan with two percentage
// concepts shows each one as a flat number every period, not just a flat
// combined total. Capital itself needs no smoothing: it's already
// constant under capital fijo (principalAmount / totalInstallments) — see
// buildTruePerPeriodSchedule below, which computes the classic
// capital-fijo numbers first; the smoothing pass afterward only touches
// percentage concepts. Fixed-amount concepts are already flat by
// construction (see buildFixedAmountSchedule) and pass through untouched.
//
// The one Percentage concept with conceptTypeId === null (the
// system-generated corriente-interest concept — see
// LoansService.buildInterestConceptAssignment; always present and always
// first, see resolveConceptsWithInterest) is the designated "cuota con
// interés" bucket: besides its own averaging, it also absorbs whatever
// delta the final $100 rounding introduces, so that
// principalPortion + every concept's computedAmount always sums to
// exactly the same rounded total on every installment — not just
// approximately. Every other concept (catalog picks) is independently
// smoothed with no special adjustment, using the same
// split-evenly-remainder-on-the-last-installment convention as
// buildFixedAmountSchedule. If no concept has conceptTypeId === null
// (only possible calling this function directly, bypassing LoansService —
// production calls always include the system corriente concept), the
// first Percentage concept takes that role instead; if there are no
// Percentage concepts at all, there is nothing meaningful to round into,
// so the schedule is left as plain capital fijo (this never happens in
// practice — a usury-rate concept is mandatory on every real loan).
export function generateAmortizationSchedule(
  principalAmount: number,
  totalInstallments: number,
  concepts: ConceptAssignment[],
): GeneratedInstallment[] {
  if (totalInstallments < 1) {
    throw new Error('totalInstallments must be at least 1');
  }

  const truePeriods = buildTruePerPeriodSchedule(
    principalAmount,
    totalInstallments,
    concepts,
  );

  const anchorIndex = resolveAnchorConceptIndex(concepts);
  if (anchorIndex === -1) {
    // Nothing to smooth into — return plain capital fijo.
    return truePeriods.map(({ principalPortion, conceptAmounts }, index) => {
      const computedConcepts = concepts.map((concept, ci) => ({
        ...concept,
        computedAmount: conceptAmounts[ci],
      }));
      return {
        installmentNumber: index + 1,
        principalPortion,
        amount: roundCurrency(
          principalPortion + conceptAmounts.reduce((s, a) => s + a, 0),
        ),
        concepts: computedConcepts,
      };
    });
  }

  // Every concept's true total across the whole loan — what gets
  // redistributed evenly below, instead of the true declining figures.
  const conceptTotals = concepts.map((_, ci) =>
    truePeriods.reduce((sum, period) => sum + period.conceptAmounts[ci], 0),
  );

  const cuotaFinal = roundToNearestHundred(
    (principalAmount + conceptTotals.reduce((s, t) => s + t, 0)) /
      totalInstallments,
  );

  // Non-anchor concepts: flat, split evenly, last installment absorbs the
  // peso-level remainder — identical convention to
  // buildFixedAmountSchedule's split_across_installments. FixedAmount
  // concepts are already flat, so this is a no-op for them.
  const smoothedConceptSchedules = concepts.map((concept, ci) => {
    if (ci === anchorIndex) {
      return null; // computed per-period below, as the rounding residual.
    }
    if (concept.calculationType === ConceptCalculationType.FixedAmount) {
      return truePeriods.map((period) => period.conceptAmounts[ci]);
    }
    return buildFixedAmountSchedule(
      conceptTotals[ci],
      totalInstallments,
      FixedAmountDistribution.SplitAcrossInstallments,
    );
  });

  return truePeriods.map(({ principalPortion }, index) => {
    const otherConceptsTotal = concepts.reduce((sum, _, ci) => {
      if (ci === anchorIndex) return sum;
      return sum + smoothedConceptSchedules[ci]![index];
    }, 0);

    const computedConcepts = concepts.map((concept, ci) => ({
      ...concept,
      computedAmount:
        ci === anchorIndex
          ? roundCurrency(cuotaFinal - principalPortion - otherConceptsTotal)
          : smoothedConceptSchedules[ci]![index],
    }));

    const conceptsTotal = computedConcepts.reduce(
      (sum, concept) => sum + concept.computedAmount,
      0,
    );

    return {
      installmentNumber: index + 1,
      principalPortion,
      amount: roundCurrency(principalPortion + conceptsTotal),
      concepts: computedConcepts,
    };
  });
}

interface TruePeriod {
  principalPortion: number;
  conceptAmounts: number[];
}

// The classic capital-fijo numbers (declining interest, constant
// principal) — used only as an input to the smoothing pass above, never
// returned directly (except in the no-concepts-to-smooth-into fallback).
function buildTruePerPeriodSchedule(
  principalAmount: number,
  totalInstallments: number,
  concepts: ConceptAssignment[],
): TruePeriod[] {
  const fixedAmountSchedules = new Map<string, number[]>();
  for (const concept of concepts) {
    if (concept.calculationType !== ConceptCalculationType.FixedAmount) {
      continue;
    }
    if (!concept.fixedAmountDistribution) {
      throw new Error(
        `Concept "${concept.name}" is fixed_amount but has no fixedAmountDistribution configured — edit it in the catalog before assigning it to a loan.`,
      );
    }
    fixedAmountSchedules.set(
      // Non-null: the synthetic interest concept is always Percentage and
      // never reaches this branch.
      concept.conceptTypeId!,
      buildFixedAmountSchedule(
        concept.value,
        totalInstallments,
        concept.fixedAmountDistribution,
      ),
    );
  }

  const principalPerInstallment = roundCurrency(
    principalAmount / totalInstallments,
  );

  let runningBalance = principalAmount;
  const periods: TruePeriod[] = [];

  for (let index = 0; index < totalInstallments; index++) {
    const isLast = index === totalInstallments - 1;

    const conceptAmounts = concepts.map((concept) =>
      concept.calculationType === ConceptCalculationType.Percentage
        ? roundCurrency((runningBalance * concept.value) / 100)
        : // Non-null: every fixed_amount concept got a schedule above, or
          // the function already threw before reaching this loop.
          fixedAmountSchedules.get(concept.conceptTypeId!)![index],
    );

    const principalPortion = isLast
      ? roundCurrency(runningBalance)
      : principalPerInstallment;

    periods.push({ principalPortion, conceptAmounts });

    runningBalance = roundCurrency(runningBalance - principalPortion);
  }

  return periods;
}

// See this file's top comment for why this concept is the one that
// absorbs the $100 rounding residual.
function resolveAnchorConceptIndex(concepts: ConceptAssignment[]): number {
  const systemConceptIndex = concepts.findIndex(
    (concept) => concept.conceptTypeId === null,
  );
  if (systemConceptIndex !== -1) {
    return systemConceptIndex;
  }
  return concepts.findIndex(
    (concept) => concept.calculationType === ConceptCalculationType.Percentage,
  );
}

function roundToNearestHundred(value: number): number {
  return Math.round(value / 100) * 100;
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

// split_across_installments divides value evenly, remainder absorbed into
// the last installment — same convention as principalPortion's own
// rounding. repeated_each_installment charges the full value on every
// installment, not divided (e.g. a recurring monthly fee) — replaced
// first_installment_only, 2026-09-03, see FixedAmountDistribution's own
// comment. See docs/phases/PHASE_23_DYNAMIC_CHARGES.md.
function buildFixedAmountSchedule(
  value: number,
  totalInstallments: number,
  distribution: FixedAmountDistribution,
): number[] {
  if (distribution === FixedAmountDistribution.RepeatedEachInstallment) {
    return Array<number>(totalInstallments).fill(roundCurrency(value));
  }

  const base = roundCurrency(value / totalInstallments);
  const schedule = Array<number>(totalInstallments).fill(base);
  schedule[totalInstallments - 1] = roundCurrency(
    value - base * (totalInstallments - 1),
  );
  return schedule;
}
