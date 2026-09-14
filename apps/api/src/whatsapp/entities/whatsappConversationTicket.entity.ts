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

// Human report, 2026-09-13 — cobradores had no way to tell which
// conversations actually need a human vs. the client just clicking through
// the self-service menu. Deliberately just 2 states (not a 3-state
// pending/in-progress/resolved "ticket"): a middle "in progress" state
// that stops counting toward the pending badge the moment someone opens
// the chat would let a conversation someone opened but got distracted
// from silently fall off the radar — exactly the failure mode this is
// meant to prevent. See docs/DATABASE.md.
export enum WhatsappTicketStatus {
  Pending = 'pending',
  Resolved = 'resolved',
}

// What most recently (re)opened this ticket — see SelfServiceMenuService
// for where each one fires. Purely informational (shown in the inbox list
// so a cobrador knows why a conversation needs them without opening it),
// doesn't affect status/behavior.
export enum WhatsappTicketTriggerKind {
  AdvisorRequested = 'advisor_requested',
  ReceiptImage = 'receipt_image',
  ReceiptDocument = 'receipt_document',
}

// One row per client, upserted — NOT append-only, same convention as
// WhatsappConversationState. Unlike that table, this one never expires:
// ConversationMenu tracks the bot's own script position and is tied to
// Meta's 24h session window on purpose, while this tracks whether a HUMAN
// has resolved the client's request, which can legitimately take longer
// than 24h (a comprobante sent Saturday night might not get reviewed until
// Monday) and must stay visible the whole time.
@Entity('whatsapp_conversation_tickets')
export class WhatsappConversationTicket {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // Unique, NOT NULL — every trigger (handOffToAdvisor, the receipt flow,
  // an unprompted image/document) only ever runs for a resolved Client.
  // ON DELETE RESTRICT, not SET NULL — this is live operational state a
  // cobrador acts on, not a historical record that should just go blank
  // under a deleted client.
  @Index({ unique: true })
  @Column()
  clientId!: string;

  @ManyToOne(() => Client, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'client_id' })
  client!: Client;

  @Column({ type: 'enum', enum: WhatsappTicketStatus })
  status!: WhatsappTicketStatus;

  @Column({ type: 'enum', enum: WhatsappTicketTriggerKind })
  triggerKind!: WhatsappTicketTriggerKind;

  // Refreshed every time the status (re)becomes Pending — see
  // WhatsappConversationTicketService.openOrReopen. Drives the FIFO
  // ordering of pending conversations in the inbox (oldest-waiting-first),
  // not createdAt, since a resolved ticket that reopens should jump back
  // to "just started waiting", not to whenever it was first ever created.
  @Column({ type: 'timestamptz' })
  pendingSince!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  resolvedAt!: Date | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
