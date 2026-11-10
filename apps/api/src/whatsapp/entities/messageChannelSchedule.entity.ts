import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { BrevoChannel } from '../../brevo/brevoTypes';
import { ReminderFamily } from '../reminderFamily';

// Phase 36, stage 3 — the reminder families that can also go out by email
// and SMS. Collection only (confirmed with the human, 2026-11-09): neither
// payment confirmations nor new pagaré / refinance ever go by email/SMS,
// and their email/SMS templates were removed. Adding one later = a new
// enum value + its two seeded rows + its templates.
export const CHANNEL_REMINDER_FAMILIES = [
  ReminderFamily.Overdue,
  ReminderFamily.UpcomingDue,
  ReminderFamily.CreditReport,
] as const;

export type ChannelReminderFamily = (typeof CHANNEL_REMINDER_FAMILIES)[number];

// When each family's email and SMS reminders run — one row per (family,
// channel), each with its own schedule and on/off, independent of the
// WhatsApp schedule of the same family (which stays on its message_templates
// "schedule owner" row). Seeded paused. See ChannelReminderCronService.
@Entity('message_channel_schedules')
@Index('IDX_message_channel_schedules_family_channel', ['family', 'channel'], {
  unique: true,
})
export class MessageChannelSchedule {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'enum', enum: CHANNEL_REMINDER_FAMILIES })
  family!: ChannelReminderFamily;

  @Column({ type: 'enum', enum: BrevoChannel })
  channel!: BrevoChannel;

  @Column({ type: 'varchar' })
  cronExpression!: string;

  @Column({ default: true })
  isPaused!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
