import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { decimalTransformer } from '../../database/decimal.transformer';
import { User } from '../../users/entities/user.entity';

// Historical rows, never mutated — confirmed with the human (see
// docs/phases/PHASE_15_USURY_RATE.md "Resolved"): a new month's rate is
// always a new row, so past months' certified rates stay queryable exactly
// as they were when they applied. Append-only, same convention as
// audit_logs/message_logs — no updatedAt/deletedAt.
@Entity('usury_rates')
export class UsuryRate {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // First day of the certified month (e.g. '2026-08-01'). Unique — the
  // service layer also rejects a duplicate month before insert, but the
  // constraint is the actual guarantee that history is never overwritten.
  @Index({ unique: true })
  @Column({ type: 'date' })
  effectiveMonth!: string;

  // The monthly EFFECTIVE rate actually applied to loan interest — every
  // existing consumer (LoansService pricing percentage concepts per
  // installment) reads this field unchanged. As of 2026-09-03 it's no
  // longer typed by hand: UsuryRateService.setRate computes it from
  // annualRatePercentage below via convertAnnualToMonthlyRate. Widened from
  // decimal(5,2) to decimal(7,4) in the same migration — the old 2-decimal
  // precision would have truncated a real value like 2.1605% to 2.16%.
  @Column({
    type: 'decimal',
    precision: 7,
    scale: 4,
    transformer: decimalTransformer,
  })
  ratePercentage!: number;

  // The raw published rate from the Superintendencia Financiera ("interés
  // bancario corriente", crédito de consumo y ordinario — see
  // https://www.superfinanciera.gov.co/publicaciones/10829/sala-de-prensacomunicados-de-prensa-interes-bancario-corriente-10829/),
  // e.g. 29.24 for "29,24%". Added 2026-09-03 — nullable because no real
  // rate had ever been entered in production before this column existed
  // (confirmed with the human, nothing to backfill), not because it's
  // optional for new rows: CreateUsuryRateDto always requires it, and
  // setRate always populates it alongside the derived ratePercentage above.
  @Column({
    type: 'decimal',
    precision: 6,
    scale: 2,
    nullable: true,
    transformer: decimalTransformer,
  })
  annualRatePercentage!: number | null;

  // Nullable + SET NULL, same reasoning as audit_logs.actorUserId: keep the
  // historical rate row (and the record that someone entered it) even after
  // the acting user is deleted.
  @Column({ type: 'varchar', nullable: true })
  createdBy!: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by' })
  createdByUser!: User | null;

  @CreateDateColumn()
  createdAt!: Date;
}
