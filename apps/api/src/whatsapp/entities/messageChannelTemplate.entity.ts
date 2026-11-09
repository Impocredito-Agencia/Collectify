import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { BrevoChannel } from '../../brevo/brevoTypes';
import { MessageType } from '../messageType.enum';

// Phase 36 — the email and SMS wording for each message type, one row per
// (type, channel). Unlike message_templates (fixed Meta-approved WhatsApp
// text, changed only by migration), these are admin-editable from the
// panel: email and SMS need no approval from anyone. Filled with the same
// {{1}}, {{2}}... values as the WhatsApp template of that type — see
// MESSAGE_TYPE_PARAMETERS — so every channel shows the same figures.
@Entity('message_channel_templates')
@Index('IDX_message_channel_templates_type_channel', ['type', 'channel'], {
  unique: true,
})
export class MessageChannelTemplate {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'enum', enum: MessageType })
  type!: MessageType;

  @Column({ type: 'enum', enum: BrevoChannel })
  channel!: BrevoChannel;

  // Email only — always null for SMS.
  @Column({ type: 'varchar', nullable: true })
  subject!: string | null;

  // Plain text with {{n}} placeholders. In email, *text* becomes bold and a
  // blank line starts a new paragraph; an SMS is sent as written, minus the
  // accents GSM-7 lacks (see smsText.ts).
  @Column({ type: 'text' })
  body!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @DeleteDateColumn()
  deletedAt!: Date | null;
}
