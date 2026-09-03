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
  // SelfServiceMenuService.sendBreakdownForContext.
  @Column({ type: 'varchar', nullable: true })
  whatsappMessageId!: string | null;

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
