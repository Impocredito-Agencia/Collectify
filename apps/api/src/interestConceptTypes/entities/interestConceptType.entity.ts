import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { decimalTransformer } from '../../database/decimal.transformer';

export enum ConceptCalculationType {
  Percentage = 'percentage',
  FixedAmount = 'fixed_amount',
}

// Phase 23 — which side of the concept engine a type belongs to. Corriente
// concepts price a loan's ordinary cost at generation time (Phase 14,
// unchanged); moratorio concepts price overdue installments, computed live
// on read instead of projected at generation — see
// docs/phases/PHASE_23_DYNAMIC_CHARGES.md and installmentCalculations.ts's
// calculateMoratoryCharges.
export enum ConceptCategory {
  Corriente = 'corriente',
  Moratorio = 'moratorio',
}

// Only meaningful when calculationType is FixedAmount and category is
// Corriente — a moratorio fixed_amount concept is always charged once, flat,
// the moment an installment goes overdue (confirmed with the human), so it
// has no distribution mode to choose.
//
// RepeatedEachInstallment replaced FirstInstallmentOnly, 2026-09-03 (human
// report — charging the flat fee once on installment 1 and nothing after
// had no real use case for this client; what they actually needed was the
// same fixed amount charged in full on every installment, e.g. a recurring
// monthly service fee). See generateSchedule.ts's buildFixedAmountSchedule
// and migration RenameFirstInstallmentOnlyToRepeatedEachInstallment.
export enum FixedAmountDistribution {
  SplitAcrossInstallments = 'split_across_installments',
  RepeatedEachInstallment = 'repeated_each_installment',
}

// Admin-managed catalog of OPTIONAL interest/fee concepts (e.g. "Gastos de
// cobranza", "Seguro"). Confirmed with the human this must stay open-ended —
// the admin creates new concept types whenever needed, not a
// fixed/hardcoded list. See docs/phases/PHASE_14_INTEREST_CONCEPTS.md.
//
// Redesigned, 2026-09-03 (human report — the previous isUsuryRateConcept
// flag, "mark one catalog entry as THE mandatory usury-rate concept", was a
// bad design: indirect, fragile, and mixed two unrelated jobs into one
// screen). The loan's own corriente/moratorio interest is no longer a
// catalog entry at all — it's a system-generated LoanInstallmentConcept row
// (interestConceptTypeId: null), built directly from
// LoansService.buildInterestConceptAssignment() using
// CreateLoanDto.corrienteInterestRate/moratoryInterestRate (defaulting to,
// and never allowed above, the current usury ceiling). This catalog is
// purely for optional business fees again — no flag, no "mandatory"
// concept, nothing here drives loan pricing on its own. See
// docs/phases/PHASE_24_USURY_MANDATORY.md.
@Entity('interest_concept_types')
export class InterestConceptType {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  name!: string;

  @Column({ type: 'enum', enum: ConceptCalculationType })
  defaultCalculationType!: ConceptCalculationType;

  // Widened 2026-09-06 (human request) — decimal(12,2) -> decimal(12,4),
  // same target precision as UsuryRate.ratePercentage, so a percentage cargo
  // can actually be entered/stored to 4 decimal places instead of silently
  // rounding to 2 on save. Scoped to percentage concepts only: a
  // fixed_amount concept is a currency amount, which has no legitimate use
  // for more than 2 decimals — enforced in CreateInterestConceptTypeDto (see
  // its own comment), not at this column level, since one column serves
  // both calculation types. See migration WidenConceptValuePrecision.
  @Column({
    type: 'decimal',
    precision: 12,
    scale: 4,
    nullable: true,
    transformer: decimalTransformer,
  })
  defaultValue!: number | null;

  @Column({
    type: 'enum',
    enum: ConceptCategory,
    default: ConceptCategory.Corriente,
  })
  category!: ConceptCategory;

  @Column({
    type: 'enum',
    enum: FixedAmountDistribution,
    nullable: true,
  })
  fixedAmountDistribution!: FixedAmountDistribution | null;

  // Deactivating removes a type from the picker for new loans without
  // touching LoanInstallmentConcept rows already created from it — those
  // snapshot their own name/value at generation time (confirmed with the
  // human: existing loans must not change if the catalog entry changes).
  @Column({ default: true })
  isActive!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @DeleteDateColumn()
  deletedAt!: Date | null;
}
