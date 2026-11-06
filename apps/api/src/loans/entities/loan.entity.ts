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
import { User } from '../../users/entities/user.entity';
import { LoanDeletionSnapshot } from '../deletion/loanDeletionSnapshot';

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

  // Human request, 2026-11-05 — accrued mora of the old loan forgiven when
  // it was refinanced into this one. Same rules as Payment.moraWaivedAmount
  // (by amount, moratory interest only, capped at the mora the refinance
  // quote is actually charging — see LoansService.refinance). Informational
  // for the new loan's own math: the admin still enters the new
  // principalAmount, this records how much of the old mora was left out of
  // it and why. 0 = nothing waived (and always 0 on a non-refinanced loan).
  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
    default: 0,
    transformer: decimalTransformer,
  })
  refinanceMoraWaivedAmount!: number;

  // Optional free-text reason for the waiver above.
  @Column({ type: 'text', nullable: true })
  refinanceMoraWaiverReason!: string | null;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  // The "new loan" message is picked up by a scheduled cron sweep
  // (NewLoanReminderService.runPendingLoanNotifications) over loans where
  // isNewLoan is true and this column is still null — restored 2026-09-09
  // (confirmed with the human) after a brief 2026-09-07 revert back to
  // synchronous sending. Set once that send actually succeeds (by
  // sendNewLoanMessage itself, regardless of whether it ran from the
  // sweep or from a manual POST /message-logs/:id/retry) — never touched
  // on a failed send, so the next sweep run picks the loan back up
  // automatically.
  @Column({ type: 'timestamptz', nullable: true })
  newLoanMessageSentAt!: Date | null;

  // Distinguishes a genuinely new credit event (should get the scheduled
  // "new loan" WhatsApp message) from a historical/backfilled loan being
  // entered into the platform after the fact (bulk import, or an old loan
  // book still being typed in by hand) — those must never trigger the
  // message. Decided once, explicitly, at creation (a checkbox on
  // LoanForm); refinance() always hardcodes this true instead (a
  // refinance is never a historical/backfilled event — see refinance()'s
  // own comment). Default false ("es viejo") — most loans entered right
  // now are historical backfills, so nothing needs it set to behave
  // safely. See the migration comment
  // (AddIsNewLoanToLoans) for why the default matters.
  @Column({ default: false })
  isNewLoan!: boolean;

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

  // Human report, 2026-09-19 — an optional, per-loan alternate contact
  // (not a Client — a free-form name/number, since it's typically someone
  // outside the business's client base entirely, e.g. a relative handling
  // this one pagaré for the actual debtor). Rare by design ("algo extra
  // que pasa en pocos casos") — presence of alternateContactPhoneNumber
  // IS the "enabled" flag, same convention as coDebtorClientId above, no
  // separate boolean column. When set, every WhatsApp message ABOUT this
  // specific loan (reminders, confirmations, the self-service menu when
  // this contact texts in) goes to this number instead of the client's
  // own — see clientRecipientPhoneNumbers.ts's reminder-grouping callers
  // and docs/DATABASE.md's note of this date. Scoped strictly to this one
  // loan: the contact never sees or acts on the client's other loans,
  // even if a client has several and only one carries this override.
  @Column({ type: 'varchar', nullable: true })
  alternateContactName!: string | null;

  @Column({ type: 'varchar', nullable: true })
  alternateContactPhoneNumber!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @DeleteDateColumn()
  deletedAt!: Date | null;

  // --- Phase 35 — irreversible deletion with an audit trail (see
  // docs/phases/PHASE_35_LOAN_DELETION.md). All three stay null for a live
  // loan and for one deleted before this phase (Phase 30, no payments);
  // set together, exactly once, by LoanDeletionService.delete(). ---

  // Who deleted it. SET NULL, same as audit_logs.actor_user_id: removing a
  // user account must never take a deleted pagaré's record with it.
  @Column({ type: 'uuid', nullable: true })
  deletedByUserId!: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'deleted_by_user_id' })
  deletedByUser!: User | null;

  // The mandatory reason typed in the deletion dialog.
  @Column({ type: 'text', nullable: true })
  deletionReason!: string | null;

  // The cuotas' figures, mora included, frozen at the moment of deletion.
  @Column({ type: 'jsonb', nullable: true })
  deletionSnapshot!: LoanDeletionSnapshot | null;
}
