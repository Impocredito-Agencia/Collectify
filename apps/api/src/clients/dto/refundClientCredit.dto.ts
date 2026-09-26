import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';

// Human request, 2026-09-26 — "devolver al cliente": hand back part or all
// of a client's saldo a favor in cash. See ClientCreditBalanceService.refund.
export class RefundClientCreditDto {
  @ApiProperty({ example: 50000 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount!: number;

  @ApiPropertyOptional({
    example: 'El cliente pidió que se le devolviera el excedente',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
