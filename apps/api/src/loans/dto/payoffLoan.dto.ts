import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString, IsUrl } from 'class-validator';

// Body of POST /loans/:id/payoff. Every field is optional — a payoff with an
// empty body behaves exactly as it did before this DTO existed.
export class PayoffLoanDto {
  // Human report, 2026-09-25 — "Liquidar anticipadamente" had no way to
  // attach the payment receipt, unlike an ordinary or bulk payment. Same
  // contract as CreatePaymentDto.imageUrls: URLs already uploaded to the
  // external image host, never image bytes.
  @ApiPropertyOptional({
    type: [String],
    description:
      'URLs of the payment receipt photos, already uploaded to the external image host. The same photos are attached to every payment the payoff registers (one per pending installment). The api does not accept or process image bytes directly.',
  })
  @IsOptional()
  @IsArray()
  @IsUrl({}, { each: true })
  imageUrls?: string[];

  // Human report, 2026-10-21 — "no permite añadir detalle o concepto, para
  // explicar la razón, motivo, o forma de pago". Same free-text field an
  // ordinary payment already takes (CreatePaymentDto.observation); appended
  // after the fixed "Liquidación anticipada" label on every payment the
  // payoff registers, so those rows stay identifiable as a payoff.
  @ApiPropertyOptional({
    example: 'Pagó con transferencia Bancolombia, vendió la moto',
    description:
      "Free-text detail about the payoff (reason, motive, payment method). Appended to the fixed 'Liquidación anticipada' observation of every payment the payoff registers. Blank or whitespace-only is treated as absent.",
  })
  @IsOptional()
  @IsString()
  observation?: string;
}
