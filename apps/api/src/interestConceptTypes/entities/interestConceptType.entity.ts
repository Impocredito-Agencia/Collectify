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
export enum FixedAmountDistribution {
  SplitAcrossInstallments = 'split_across_installments',
  FirstInstallmentOnly = 'first_installment_only',
}

// Admin-managed catalog of interest/fee concepts (e.g. "Interés
// remuneratorio", "Gastos de cobranza"). Confirmed with the human this must
// stay open-ended — the admin creates new concept types whenever needed,
// not a fixed/hardcoded list. See docs/phases/PHASE_14_INTEREST_CONCEPTS.md.
@Entity('interest_concept_types')
export class InterestConceptType {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  name!: string;

  @Column({ type: 'enum', enum: ConceptCalculationType })
  defaultCalculationType!: ConceptCalculationType;

  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
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

  // Added 2026-09-03, human bug report: at most one Percentage concept per
  // category can carry this flag (enforced in
  // InterestConceptTypesService.create/update — setting it on one concept
  // unsets it on any other in the same category, not a DB constraint, same
  // pattern as this project's other "one active X" rules). LoansService
  // requires this concept's id to be present in the corresponding
  // concepts/moratoryConcepts list on every loan create/refinance/preview —
  // it's the mandatory, non-removable usury-rate row the loan form always
  // shows. See docs/phases/PHASE_24_USURY_MANDATORY.md.
  @Column({ default: false })
  isUsuryRateConcept!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @DeleteDateColumn()
  deletedAt!: Date | null;
}
