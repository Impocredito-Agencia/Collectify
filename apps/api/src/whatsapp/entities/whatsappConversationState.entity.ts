import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { Client } from '../../clients/entities/client.entity';

// Where a client currently is in the self-service menu (Phase 34) — WhatsApp
// itself keeps no such state, every inbound message arrives independent of
// the last, so "Volver al menú" going back to the right screen requires the
// backend to remember it. `awaitingReceipt` is a deliberate deviation from
// docs/phases/PHASE_34_INTERACTIVE_MENU.md's original wording (which
// described using a null/`none` currentMenu for this) — a distinct value
// avoids null meaning two different things ("no active context" — no row at
// all — vs "mid-receipt-flow"), which would otherwise make a stray text
// message while awaiting a receipt look identical to a brand-new
// conversation and incorrectly re-show the main menu.
export enum ConversationMenu {
  Main = 'main',
  MiCuentaSubmenu = 'mi_cuenta_submenu',
  AwaitingReceipt = 'awaiting_receipt',
}

// One row per phone number currently mid-conversation with the self-service
// menu — upserted on every relevant inbound event, expiring with the same
// 24h session window Meta itself uses. Ephemeral, not append-only (unlike
// WhatsappInboundMessage): ON CONFLICT (phone_number) replaces the row, and
// an expired row is treated as "no state" by query rather than a scheduled
// cleanup job — see docs/phases/PHASE_34_INTERACTIVE_MENU.md open questions.
@Entity('whatsapp_conversation_states')
export class WhatsappConversationState {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column()
  phoneNumber!: string;

  // Nullable — same "log even if unrecognized" convention as
  // WhatsappInboundMessage. SET NULL, not RESTRICT: this is ephemeral
  // conversation state, not a record that should block a client's own
  // soft-delete.
  @Column({ type: 'uuid', nullable: true })
  clientId!: string | null;

  @ManyToOne(() => Client, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'client_id' })
  client!: Client | null;

  @Column({ type: 'enum', enum: ConversationMenu })
  currentMenu!: ConversationMenu;

  @Column({ type: 'timestamptz' })
  expiresAt!: Date;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
