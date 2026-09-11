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
import { Payment } from '../../loans/entities/payment.entity';

// Image/Document/Audio/Video/Sticker/Location added 2026-09-11 (human
// report — a client's payment receipt photo rendered as a bare "—" in the
// inbox, indistinguishable from any other unrecognized event). Only the
// media kinds this business's WhatsApp bot actually receives in practice
// get their own value; anything else Meta might send (contacts, reactions,
// orders, system events, truly unknown types) still falls back to Other —
// see extractInboundEvents.ts's parseMessage.
export enum WhatsappInboundMessageType {
  Button = 'button',
  Text = 'text',
  Image = 'image',
  Document = 'document',
  Audio = 'audio',
  Video = 'video',
  Sticker = 'sticker',
  Location = 'location',
  Other = 'other',
}

// Append-only — one row per inbound WhatsApp event received (button tap or
// free text), from a recognized client or not. Never dropped, per
// docs/phases/PHASE_22_WHATSAPP_WEBHOOK.md. No updated_at/deleted_at, same
// convention as MessageLog.
@Entity('whatsapp_inbound_messages')
export class WhatsappInboundMessage {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // Nullable — an inbound message from a phone number that doesn't match
  // any client is still logged, not dropped. SET NULL (not RESTRICT) since
  // this is historical record of an event, not a reference that should
  // block a client's own soft-delete.
  @Index()
  @Column({ type: 'uuid', nullable: true })
  clientId!: string | null;

  @ManyToOne(() => Client, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'client_id' })
  client!: Client | null;

  @Column()
  fromPhoneNumber!: string;

  @Column({ type: 'enum', enum: WhatsappInboundMessageType })
  type!: WhatsappInboundMessageType;

  @Column({ type: 'varchar', nullable: true })
  buttonPayload!: string | null;

  @Column({ type: 'text', nullable: true })
  bodyText!: string | null;

  // Human report, 2026-09-11 — the Cloudinary URL WhatsappMediaService
  // re-hosted this message's attachment to. Only image/document trigger a
  // re-host — those are the only kinds relevant as payment evidence for
  // this business; audio/video/sticker/location are still logged with
  // their own `type` above (never dropped) but never hit Cloudinary at
  // all, on purpose — see extractInboundEvents.ts's parseMessage. Null
  // until the download+upload succeeds, which never blocks this row
  // itself from being saved — see WhatsappWebhookService.persistEvent.
  // Stays null forever for a non-media message, an unhosted media type, or
  // when Cloudinary/WhatsApp credentials aren't configured, or the
  // download/upload failed.
  @Column({ type: 'varchar', nullable: true })
  mediaUrl!: string | null;

  // Human report, 2026-09-11 — set once a collector reviews this
  // message's comprobante and registers a payment from it (the "Registrar
  // pago con este comprobante" flow — see
  // apps/client/src/features/whatsappInboundMessages/RegisterPaymentFromWhatsappModal.tsx
  // and InstallmentsService.registerPayment's sourceWhatsappMessageId
  // handling). Nullable and SET NULL on delete — a payment record is
  // never hard-deleted in this system (only soft-deleted/voided), but this
  // stays defensive regardless, same convention as clientId above. Lets
  // the inbox render "✅ Ya registrado" instead of the raw media bubble,
  // so a comprobante doesn't get registered as a payment twice by
  // accident.
  @Index()
  @Column({ type: 'uuid', nullable: true })
  paymentId!: string | null;

  @ManyToOne(() => Payment, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'payment_id' })
  payment!: Payment | null;

  // The full webhook event Meta sent, for debugging/replay — see
  // docs/phases/PHASE_22_WHATSAPP_WEBHOOK.md.
  @Column({ type: 'jsonb' })
  rawPayload!: Record<string, unknown>;

  @Column({ type: 'timestamptz' })
  receivedAt!: Date;

  @CreateDateColumn()
  createdAt!: Date;
}
