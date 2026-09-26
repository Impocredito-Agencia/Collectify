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

import { Installment } from './installment.entity';

@Entity('payments')
export class Payment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column()
  installmentId!: string;

  @ManyToOne(() => Installment, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'installment_id' })
  installment!: Installment;

  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
    transformer: decimalTransformer,
  })
  amountPaid!: number;

  @Column({ type: 'date' })
  paidAt!: string;

  @Column({ type: 'text', nullable: true })
  observation!: string | null;

  // Deprecated as of Phase 28 — superseded by the payment_images table
  // (see PaymentImage entity), which supports more than one receipt photo
  // per payment. No longer written for new payments; kept, unchanged in
  // shape, only as a fallback for rows created before that migration (its
  // value was backfilled into payment_images at that point, so this is
  // read as a last resort, not the primary source). See
  // docs/phases/PHASE_28_MULTI_INSTALLMENT_PAYMENT.md.
  @Column({ type: 'varchar', nullable: true })
  imageUrl!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  // Bug fix, 2026-09-09 (human report) — a payment could never be
  // corrected once registered. Voiding sets deletedAt (see
  // InstallmentsService.voidPayment()) — every existing query in the
  // codebase that sums/lists payments already excludes soft-deleted rows
  // by default, so a voided payment automatically stops counting
  // anywhere without touching those call sites. This column carries the
  // mandatory reason a voided row must be paired with; null for any
  // payment that's never been voided.
  @Column({ type: 'text', nullable: true })
  voidReason!: string | null;

  // Human request, 2026-09-25 — mora the collector chose to forgive when
  // this payment settled the cuota. Always goes WITH a payment (never on its
  // own) and only when that payment closes the cuota, so `amountPaid` stays
  // the real cash received and `amountPaid + moraWaivedAmount` is what the
  // cuota's balance was reduced by. Being on the payment row means voiding
  // the payment (see InstallmentsService.voidPayment) undoes the waiver with
  // it: the cuota reopens with the mora owed again. 0 = nothing waived.
  // Never counted as money collected — cash reports keep summing amountPaid.
  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
    default: 0,
    transformer: decimalTransformer,
  })
  moraWaivedAmount!: number;

  // Optional free-text reason for the waiver. Only meaningful when
  // moraWaivedAmount > 0.
  @Column({ type: 'text', nullable: true })
  moraWaiverReason!: string | null;

  // Human report, 2026-09-14 — set when this payment was created by
  // applying a client's saldo a favor (ClientCreditLedgerEntry, type
  // `applied`) rather than an actual cash/transfer amount received. Shown
  // as a badge in the payment history so it reads differently from a real
  // collection, without needing its own separate history view — it's a
  // real Payment in every other respect (closes the installment, counts
  // toward totalPaid, etc.).
  @Column({ default: false })
  fundedByCredit!: boolean;

  @DeleteDateColumn()
  deletedAt!: Date | null;
}
