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
import { MessageType } from '../messageType.enum';
import { WhatsappDeliveryStatus } from '../whatsappDeliveryStatus.enum';

export enum MessageLogStatus {
  Sent = 'sent',
  Failed = 'failed',
}

// Append-only — one row per reminder actually sent to a client, per
// docs/DATABASE.md. No updated_at/deleted_at: history is never edited.
@Entity('message_logs')
export class MessageLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column()
  clientId!: string;

  @ManyToOne(() => Client, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'client_id' })
  client!: Client;

  @Column({ type: 'enum', enum: MessageType })
  type!: MessageType;

  @Column()
  phoneNumber!: string;

  @Column({ type: 'text' })
  messageContent!: string;

  @Column({ type: 'enum', enum: MessageLogStatus })
  status!: MessageLogStatus;

  @Column({ type: 'timestamptz' })
  sentAt!: Date;

  // Meta's WAMID for this send (null on a Failed send, or a send made
  // before this column existed). Bug fix, 2026-09-03: lets a "Más
  // información" button tap be traced back to the exact reminder it
  // replied to via the inbound webhook's `context.id` — see
  // SelfServiceMenuService.sendBreakdownForContext. Indexed as of
  // 2026-09-16 — also the lookup key for applying a delivery-status
  // webhook update below.
  @Index()
  @Column({ type: 'varchar', nullable: true })
  whatsappMessageId!: string | null;

  // Added 2026-09-16 — Meta's per-message webhook status callback
  // (change.value.statuses[]), applied by
  // WhatsappWebhookService.applyDeliveryStatusUpdate once a matching WAMID
  // arrives. Null means no callback has been received (yet, or ever) for
  // this send — distinct from `status` above, which only ever reflects
  // whether the synchronous Send API call itself succeeded. See
  // extractStatusEvents.ts and docs/DATABASE.md.
  @Column({ type: 'enum', enum: WhatsappDeliveryStatus, nullable: true })
  deliveryStatus!: WhatsappDeliveryStatus | null;

  @Column({ type: 'timestamptz', nullable: true })
  deliveryStatusUpdatedAt!: Date | null;

  // Only set when deliveryStatus is Failed and Meta's callback included an
  // errors[] entry — e.g. code 131026 ("Message Undeliverable"), the
  // closest signal Meta exposes to "this number blocked the business".
  // Never a hard "blocked" verdict on its own — see
  // whatsappDeliveryHealth.ts.
  @Column({ type: 'int', nullable: true })
  lastErrorCode!: number | null;

  @Column({ type: 'varchar', nullable: true })
  lastErrorTitle!: string | null;

  // Phase 18 manual retry tracking — retriedAt is set on the ORIGINAL
  // (failed) row once someone retries it; retryOfMessageLogId is set on
  // the NEW row created for that retry attempt, pointing back at the
  // original. Both nullable: most rows are never retried. See
  // docs/phases/PHASE_18_MESSAGE_AUDIENCES.md.
  @Column({ type: 'timestamptz', nullable: true })
  retriedAt!: Date | null;

  @Column({ type: 'varchar', nullable: true })
  retryOfMessageLogId!: string | null;

  @ManyToOne(() => MessageLog, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'retry_of_message_log_id' })
  retryOfMessageLog!: MessageLog | null;

  @CreateDateColumn()
  createdAt!: Date;
}
