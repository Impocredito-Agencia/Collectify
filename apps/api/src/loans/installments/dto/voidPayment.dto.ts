import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

// Human report, 2026-09-09 — a mandatory reason, confirmed with the human:
// a payment can only be voided with an explicit explanation, so the
// payment history and the audit log always show why, not just that it
// happened.
export class VoidPaymentDto {
  @ApiProperty({
    example:
      'Se registró el monto completo por error; el cliente solo pagó una parte.',
  })
  @IsString()
  @IsNotEmpty()
  reason!: string;
}
