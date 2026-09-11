import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { MessageType } from '../messageType.enum';

// Content is fixed per type, not admin-editable — WhatsApp only allows
// business-initiated messages via Meta-approved templates outside the 24h
// window (see CONFIGURACION_WHATSAPP_META.md), so an in-app "edit" feature
// would be misleading. Updating a template's content is a migration, like
// any other data change — see docs/DATABASE.md "Changed after Phase 9".
@Entity('message_templates')
export class MessageTemplate {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  name!: string;

  @Index({ unique: true })
  @Column({ type: 'enum', enum: MessageType })
  type!: MessageType;

  @Column({ type: 'text' })
  content!: string;

  // Added Phase 33 — the real Meta template this row sends via the
  // Template Messages API (WhatsAppService.sendTemplateMessage), replacing
  // the old plain-text-only send. Kept as its own column rather than
  // reusing `type` even though the two are always identical in practice
  // (type's enum values are literally named after the Meta template
  // names) — see docs/phases/PHASE_33_MESSAGE_TEMPLATES_V2.md.
  @Column()
  metaTemplateName!: string;

  // The exact language code selected when submitting this template to
  // Meta — must match exactly or every send is rejected. Confirmed 'es'
  // for all 13 templates as of Phase 33.
  @Column()
  metaLanguageCode!: string;

  // Admin-editable schedule for this type's cron job (Phase 18) — nullable,
  // falling back to a per-type code default when unset. See
  // WhatsappCronService and docs/phases/PHASE_18_MESSAGE_AUDIENCES.md.
  @Column({ type: 'varchar', nullable: true })
  cronExpression!: string | null;

  // Human report, 2026-09-19 — whether an admin paused this family's cron
  // via WhatsappCronService.pause(). Only the schedule-owner row per
  // family carries a meaningful value (same convention as cronExpression
  // above) — WhatsappCronService reads it at boot so a pause survives a
  // deploy/restart instead of silently resuming every time.
  @Column({ default: false })
  cronPaused!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @DeleteDateColumn()
  deletedAt!: Date | null;
}
