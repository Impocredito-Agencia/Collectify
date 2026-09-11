import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { Client } from '../../clients/entities/client.entity';
import { User } from '../../users/entities/user.entity';

export enum WhatsappManualReplyStatus {
  Sent = 'sent',
  Failed = 'failed',
}

// Human report, 2026-09-19 — an admin's free-form "Responder" reply
// (WhatsappWebhookService.sendManualReply) used to only exist as local
// React state on WhatsappInboundMessagesPage.tsx: it disappeared on
// refresh and never reached any OTHER connected admin. Append-only, one
// row per reply actually sent — same convention as message_logs/
// whatsapp_inbound_messages/whatsapp_self_service_replies.
@Entity('whatsapp_manual_replies')
export class WhatsappManualReply {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // Nullable — same "log even if unrecognized" convention as
  // whatsapp_inbound_messages.clientId, though in practice a manual reply
  // is always sent from within a conversation whose number already
  // resolved to a client.
  @Index()
  @Column({ type: 'uuid', nullable: true })
  clientId!: string | null;

  @ManyToOne(() => Client, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'client_id' })
  client!: Client | null;

  @Column()
  phoneNumber!: string;

  @Column({ type: 'text' })
  messageContent!: string;

  // Nullable, SET NULL on delete — same convention as
  // AuditLog.actorUserId: a deleted admin's past replies stay in the
  // trail.
  @Index()
  @Column({ type: 'uuid', nullable: true })
  sentByUserId!: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'sent_by_user_id' })
  sentByUser!: User | null;

  @Column({ type: 'enum', enum: WhatsappManualReplyStatus })
  status!: WhatsappManualReplyStatus;

  @Column({ type: 'timestamptz' })
  sentAt!: Date;

  @CreateDateColumn()
  createdAt!: Date;
}
