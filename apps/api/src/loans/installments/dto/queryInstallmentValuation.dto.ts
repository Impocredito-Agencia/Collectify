import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMinSize, IsArray, IsDateString, IsUUID } from 'class-validator';

// Human request, 2026-11-05 — the register-payment dialogs show what each
// cuota owed on the payment's own date (see
// InstallmentsService.getValuationAsOf), not today.
export class QueryInstallmentValuationDto {
  @ApiProperty({
    example: '2026-10-20',
    description:
      'The day the payment was made (Bogotá calendar day). Cannot be later than today.',
  })
  @IsDateString()
  date!: string;

  @ApiProperty({
    type: String,
    example:
      '3f1c2a9e-1b2c-4d5e-8f90-123456789abc,4a2d3b0f-2c3d-4e5f-9a01-23456789abcd',
    description: 'Comma-separated installment ids.',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string'
      ? value
          .split(',')
          .map((id) => id.trim())
          .filter(Boolean)
      : value,
  )
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('all', { each: true })
  installmentIds!: string[];
}
