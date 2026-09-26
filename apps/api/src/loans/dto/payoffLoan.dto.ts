import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsOptional, IsUrl } from 'class-validator';

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
}
