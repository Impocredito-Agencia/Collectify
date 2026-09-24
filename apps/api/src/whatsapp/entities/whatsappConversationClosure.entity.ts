import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

// Human report, 2026-09-23 — "que pueda marcar el chat cerrado, para que
// salga en verde cuando sea, no solo cuando el cliente pide asesor, pero
// que se cambie cuando un cliente escriba nuevamente". A
// WhatsappConversationTicket only exists once the bot hands a KNOWN client
// off to a human, so it can't back "close any chat" — an unrecognized
// number never has one, and neither does a client who never asked for an
// advisor. This is the separate, simpler marker: the last time an admin
// closed this conversation, nothing more.
//
// Never cleared when the client writes again — "closed" is derived at read
// time instead (closedAt newer than the conversation's latest inbound
// message, see WhatsappWebhookService.findConversations), so there's no
// write on the inbound hot path to keep in sync and no way for the two to
// drift apart.
//
// One row per conversation, upserted — same convention as
// WhatsappConversationTicket/WhatsappConversationState.
@Entity('whatsapp_conversation_closures')
export class WhatsappConversationClosure {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // Same identifier findConversations groups conversations by: the
  // client's id (as text) for a matched client — covers every number on
  // file for them — or the "+"-prefixed phone number for an unrecognized
  // one. Not an FK on purpose, since it's one or the other.
  @Index({ unique: true })
  @Column()
  contactKey!: string;

  @Column({ type: 'timestamptz' })
  closedAt!: Date;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
