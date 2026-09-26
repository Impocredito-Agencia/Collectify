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
import { Payment } from '../../loans/entities/payment.entity';

import { Client } from './client.entity';

// Human report, 2026-09-14 — a payment that exceeds what an installment
// actually owes used to be rejected outright (see docs/DATABASE.md's
// "#0920" bug fix). Now accepted: the excess is recorded here instead of
// inflating the installment's own Payment row past what it truly owed,
// which would corrupt every totalDue/remainingBalance calculation
// downstream. Generating a credit is automatic (the register-payment
// confirm dialog discloses it before the cobrador confirms); APPLYING one
// to a future installment stays a deliberate, explicit operator action —
// confirmed with the human, same "never silent/automatic" requirement
// docs/phases/PHASE_33_MESSAGE_TEMPLATES_V2.md already recorded for this.
export enum ClientCreditLedgerEntryType {
  // Adds to the balance: an excess payment left credit behind.
  Created = 'created',
  // Subtracts: the credit was spent on a pending installment.
  Applied = 'applied',
  // Subtracts — human request, 2026-09-26: the cash was handed back to the
  // client ("devolver al cliente"). The honest way to take a credit off the
  // books instead of discarding it: it records the money actually leaving,
  // who did it and why (audit log + `note`).
  Refunded = 'refunded',
  // Subtracts — human request, 2026-09-26: the payment that generated a
  // credit was voided (registered by mistake), so the credit it created is
  // taken back. Linked through sourcePaymentId, like the `created` entry it
  // undoes.
  Reversed = 'reversed',
  // Adds — human request, 2026-09-26: a credit-funded payment was voided, so
  // the credit it had spent goes back to the client. Linked through
  // resultingPaymentId, like the `applied` entry it undoes.
  Restored = 'restored',
}

// Append-only, same convention as MessageLog/WhatsappInboundMessage — a
// client's current available balance is derived by summing this table
// (Created/Restored add; Applied/Refunded/Reversed subtract), never stored as a single mutable
// running total, so there's always a full, auditable trail of exactly
// which payment generated a credit and which installment absorbed it.
@Entity('client_credit_ledger_entries')
export class ClientCreditLedgerEntry {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // NOT NULL, RESTRICT — this is live financial state a cobrador/admin
  // acts on (an available balance to apply), not a historical record that
  // should go blank under a deleted client. Same reasoning as
  // WhatsappConversationTicket.clientId.
  @Index()
  @Column()
  clientId!: string;

  @ManyToOne(() => Client, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'client_id' })
  client!: Client;

  @Column({ type: 'enum', enum: ClientCreditLedgerEntryType })
  type!: ClientCreditLedgerEntryType;

  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
    transformer: decimalTransformer,
  })
  amount!: number;

  // Set only for `created` — the (capped) Payment whose excess generated
  // this credit. RESTRICT: a payment that generated a still-outstanding
  // credit can't be voided out from under it without that credit's own
  // history disappearing — see InstallmentsService.voidPayment, which will
  // need its own decision about what happens to a credit sourced from a
  // payment being voided (not yet built — see docs/DATABASE.md).
  @Column({ type: 'uuid', nullable: true })
  sourcePaymentId!: string | null;

  @ManyToOne(() => Payment, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'source_payment_id' })
  sourcePayment!: Payment | null;

  // Set only for `applied` — the real Payment row this application created
  // against the destination installment (Payment.fundedByCredit = true).
  @Column({ type: 'uuid', nullable: true })
  resultingPaymentId!: string | null;

  @ManyToOne(() => Payment, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'resulting_payment_id' })
  resultingPayment!: Payment | null;

  // Free text — the reason of a refund, or why an automatic reversal/
  // restoration happened. Null for created/applied entries.
  @Column({ type: 'text', nullable: true })
  note!: string | null;

  @CreateDateColumn()
  createdAt!: Date;
}
