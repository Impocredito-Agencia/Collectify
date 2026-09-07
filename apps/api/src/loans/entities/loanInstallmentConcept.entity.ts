import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { decimalTransformer } from '../../database/decimal.transformer';
import {
  ConceptCalculationType,
  ConceptCategory,
  InterestConceptType,
} from '../../interestConceptTypes/entities/interestConceptType.entity';

import { Installment } from './installment.entity';

// One row per interest/fee concept applied to a specific installment.
// Snapshots name/calculationType/value at generation time (confirmed with
// the human: an installment must not change if its InterestConceptType is
// later edited/deactivated — see docs/phases/PHASE_14_INTEREST_CONCEPTS.md).
// interestConceptTypeId is kept only as a soft reference for reporting
// ("total gastos de cobranza cobrados este mes"); everything needed to
// display or recompute this concept lives on this row already.
@Entity('loan_installment_concepts')
export class LoanInstallmentConcept {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column()
  installmentId!: string;

  @ManyToOne(() => Installment, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'installment_id' })
  installment!: Installment;

  @Column({ type: 'varchar', nullable: true })
  interestConceptTypeId!: string | null;

  @ManyToOne(() => InterestConceptType, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'interest_concept_type_id' })
  interestConceptType!: InterestConceptType | null;

  @Column()
  nameSnapshot!: string;

  @Column({ type: 'enum', enum: ConceptCalculationType })
  calculationType!: ConceptCalculationType;

  // Snapshotted from the type at assignment time, same as nameSnapshot/
  // calculationType. Distinguishes corriente rows (real computedAmount,
  // baked into the installment's amount) from moratorio rows (a
  // pure assignment record — see computedAmount's own comment below).
  @Column({ type: 'enum', enum: ConceptCategory })
  category!: ConceptCategory;

  // The % (for percentage concepts) or flat currency figure (for
  // fixed_amount concepts) actually used for this installment. Widened
  // 2026-09-06 (human request) — decimal(12,2) -> decimal(12,4), same
  // target precision as UsuryRate.ratePercentage — scoped to percentage
  // concepts only, a fixed_amount concept has no legitimate use for more
  // than 2 decimals (enforced in LoanConceptAssignmentDto, not at this
  // column level, since one column serves both calculation types). See
  // migration WidenConceptValuePrecision and
  // InterestConceptType.defaultValue's identical comment.
  @Column({
    type: 'decimal',
    precision: 12,
    scale: 4,
    transformer: decimalTransformer,
  })
  value!: number;

  // For a corriente concept: the resulting currency amount this concept
  // contributed to this installment, computed once at generation time
  // against the balance at that point, then stored (the schedule doesn't
  // change with the passage of time the way mora does).
  // For a moratorio concept: always stored as 0 — this row only records
  // that the concept is assigned to the loan. The real charge is computed
  // live, once the installment is actually overdue, by
  // installmentCalculations.ts's calculateMoratoryCharges, since future
  // overdue days can't be known in advance (confirmed with the human, see
  // docs/phases/PHASE_23_DYNAMIC_CHARGES.md).
  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
    transformer: decimalTransformer,
  })
  computedAmount!: number;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @DeleteDateColumn()
  deletedAt!: Date | null;
}
