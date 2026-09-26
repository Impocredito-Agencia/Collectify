import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsDateString,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  IsUrl,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreatePaymentDto {
  @ApiProperty({ example: 150000 })
  @IsPositive()
  amountPaid!: number;

  @ApiProperty({ example: '2026-07-09' })
  @IsDateString()
  paidAt!: string;

  @ApiPropertyOptional({ example: 'Pagó en el local' })
  @IsOptional()
  @IsString()
  observation?: string;

  // The api never handles the upload — each URL must already point to an
  // externally hosted deposit receipt photo (Cloudinary, see
  // docs/phases/PHASE_12_PAYMENT_ATTACHMENTS.md). @IsUrl({}, {each: true})
  // rejects anything that isn't a well-formed URL. Phase 28 — a payment can
  // now carry more than one receipt photo ("hay personas que mandan más de
  // un comprobante por cuota"); persisted as payment_images rows, one per
  // URL. Replaces the old singular imageUrl field.
  @ApiPropertyOptional({
    type: [String],
    example: ['https://res.cloudinary.com/demo/image/upload/receipt.jpg'],
    description:
      'URLs of the deposit receipt photos, already uploaded to the external image host. The api does not accept or process image bytes directly.',
  })
  @IsOptional()
  @IsArray()
  @IsUrl({}, { each: true })
  imageUrls?: string[];

  // Human request, 2026-09-25 — see Payment.moraWaivedAmount. Whole pesos,
  // and the server requires amountPaid + moraWaivedAmount to settle the
  // cuota exactly (InstallmentsService.assertValidMoraWaiver), so a stale
  // screen can never leave a peso short or over.
  @ApiPropertyOptional({
    example: 12300,
    description:
      'Mora forgiven together with this payment. Only allowed when the payment settles the cuota completely: amountPaid must equal the cuota balance minus this amount, exactly.',
  })
  @IsOptional()
  @IsInt()
  @IsPositive()
  moraWaivedAmount?: number;

  @ApiPropertyOptional({ example: 'Pagó todo de contado' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  moraWaiverReason?: string;

  // Human report, 2026-09-11 — set by the "Registrar pago con este
  // comprobante" flow (WhatsApp inbox → RegisterPaymentFromWhatsappModal)
  // so InstallmentsService.registerPayment can link the resulting Payment
  // back to the WhatsappInboundMessage the comprobante came from. Optional
  // and best-effort: a payment always registers successfully even if this
  // id is missing or stale — see that method's own comment.
  @ApiPropertyOptional({
    description:
      "The WhatsappInboundMessage id this payment's comprobante was reviewed from, if registered via the WhatsApp inbox — links the two so the inbox can show it as already handled.",
  })
  @IsOptional()
  @IsUUID()
  sourceWhatsappMessageId?: string;
}
