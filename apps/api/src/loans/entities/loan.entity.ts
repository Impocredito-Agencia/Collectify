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

import { Client } from '../../clients/entities/client.entity';
import { decimalTransformer } from '../../database/decimal.transformer';

export enum InstallmentFrequency {
  Monthly = 'monthly',
  Biweekly = 'biweekly',
}

export enum LoanStatus {
  Active = 'active',
  Paid = 'paid',
  Refinanced = 'refinanced',
}

@Entity('loans')
export class Loan {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  clientId!: string;

  @ManyToOne(() => Client, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'client_id' })
  client!: Client;

  @Index({ unique: true })
  @Column()
  promissoryNoteNumber!: string;

  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
    transformer: decimalTransformer,
  })
  principalAmount!: number;

  @Column({
    type: 'decimal',
    precision: 5,
    scale: 2,
    transformer: decimalTransformer,
  })
  interestRate!: number;

  @Column({ type: 'date' })
  disbursedAt!: string;

  @Column({ type: 'enum', enum: InstallmentFrequency })
  installmentFrequency!: InstallmentFrequency;

  @Column()
  totalInstallments!: number;

  @Column({ type: 'enum', enum: LoanStatus, default: LoanStatus.Active })
  status!: LoanStatus;

  @Column({ type: 'varchar', nullable: true })
  refinancedFromLoanId!: string | null;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  // Set once the "new loan" WhatsApp message actually succeeds — either
  // from the synchronous send at creation/refinance time, or from the
  // Phase 18 retry cron picking up a loan whose synchronous send failed.
  // Lets that cron find "loans still needing their message" directly,
  // instead of the fragile message-content string-matching
  // LoanDetailPage.tsx used before. See
  // docs/phases/PHASE_18_MESSAGE_AUDIENCES.md.
  @Column({ type: 'timestamptz', nullable: true })
  newLoanMessageSentAt!: Date | null;

  @ManyToOne(() => Loan, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'refinanced_from_loan_id' })
  refinancedFromLoan!: Loan | null;

  // --- Co-debtor (codeudor), Phase 26 — a real Client, not a snapshot of
  // one: replaces Phase 21's flat co_debtor_* columns (a co-debtor is,
  // functionally, another client of the business — searchable/reusable as
  // one instead of re-typed by hand on every loan). At most one per loan,
  // and it can't be the same client as this loan's own `client` (confirmed
  // with the human, 2026-08-30) — enforced in LoansService, not at the DB
  // level (a CHECK comparing two columns on the same row is possible but
  // this project's convention keeps business rules in the service layer).
  // A client CAN be a co-debtor on more than one loan — no uniqueness
  // constraint here. onDelete: RESTRICT matches client_id's FK above;
  // clients are only ever soft-deleted in this app, so this never blocks
  // the normal "deactivate a client" flow.
  @Column({ type: 'uuid', nullable: true })
  coDebtorClientId!: string | null;

  @ManyToOne(() => Client, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'co_debtor_client_id' })
  coDebtorClient!: Client | null;

  // Relación con el deudor principal (e.g. "Hermano del deudor") — kept as
  // its own free-text column since it describes this specific loan's
  // relationship to the debtor, not a property of the co-debtor client
  // themselves, so it has no natural home on `clients`. See
  // docs/phases/PHASE_26_CODEBTOR_CLIENT.md.
  @Column({ type: 'varchar', nullable: true })
  coDebtorRelationship!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @DeleteDateColumn()
  deletedAt!: Date | null;
}
