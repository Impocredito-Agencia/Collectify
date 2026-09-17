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
import { WhatsappDeliveryStatus } from '../whatsappDeliveryStatus.enum';

export enum WhatsappManualReplyStatus {
  Sent = 'sent',
  Failed = 'failed',
}

// Which self-service action produced this reply, when it was one — see
// SelfServiceMenuService's sendText/sendInteractive wrappers for where
// each one is sent from. Null for an admin's own typed reply or
// WhatsappWebhookService.closeConversation's closing message — neither
// comes from the self-service menu.
export enum SelfServiceReplyKind {
  MainMenu = 'main_menu',
  MiCuentaSubmenu = 'mi_cuenta_submenu',
  Breakdown = 'breakdown',
  PaymentHistory = 'payment_history',
  ReceiptRequest = 'receipt_request',
  ReceiptReceivedAck = 'receipt_received_ack',
  AdvisorHandoff = 'advisor_handoff',
  VolverAlMenuFollowUp = 'volver_al_menu_follow_up',
}

// Human report, 2026-09-19 — an admin's free-form "Responder" reply
// (WhatsappWebhookService.sendManualReply) used to only exist as local
// React state on WhatsappInboundMessagesPage.tsx: it disappeared on
// refresh and never reached any OTHER connected admin. Append-only, one
// row per reply actually sent — same convention as message_logs/
// whatsapp_inbound_messages/whatsapp_self_service_replies.
//
// Widened same day (human report) to also cover every OTHER outbound
// message a client receives outside the message_logs template system —
// the self-service menu's own automated replies (SelfServiceMenuService)
// and WhatsappWebhookService's "Cerrar conversación" closing message —
// via WhatsappOutboundLogService. sentByUserId is how the two are told
// apart: non-null means an admin actually typed this; null means either
// the bot composed and sent it, or (rarer) the admin who typed it was
// since deleted (see that column's own comment).
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

  // Human report, 2026-09-13 — see SelfServiceReplyKind's own comment.
  @Column({ type: 'enum', enum: SelfServiceReplyKind, nullable: true })
  selfServiceReplyKind!: SelfServiceReplyKind | null;

  @Column({ type: 'timestamptz' })
  sentAt!: Date;

  // Added 2026-09-16 — this table never captured a WAMID at all (unlike
  // message_logs, since 2026-09-03), because sendTextMessage/
  // sendInteractiveButtonsMessage — the two Meta calls every row here goes
  // through — didn't return one. Both now do (mirroring
  // sendTemplateMessage's existing SendMessageResult shape), so every new
  // reply/self-service send/closing message can be correlated against a
  // later delivery-status webhook. Null for any row created before this
  // column existed, or if Meta's response omitted it.
  @Index()
  @Column({ type: 'varchar', nullable: true })
  whatsappMessageId!: string | null;

  // Same delivery-status tracking as MessageLog — see that entity's own
  // comment and extractStatusEvents.ts.
  @Column({ type: 'enum', enum: WhatsappDeliveryStatus, nullable: true })
  deliveryStatus!: WhatsappDeliveryStatus | null;

  @Column({ type: 'timestamptz', nullable: true })
  deliveryStatusUpdatedAt!: Date | null;

  @Column({ type: 'int', nullable: true })
  lastErrorCode!: number | null;

  @Column({ type: 'varchar', nullable: true })
  lastErrorTitle!: string | null;

  @CreateDateColumn()
  createdAt!: Date;
}
