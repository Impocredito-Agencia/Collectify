import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsNumber, Min } from 'class-validator';

export class CreateUsuryRateDto {
  @ApiProperty({
    example: '2026-08-01',
    description:
      'Any date within the certified month — normalized to the first day of that month. Rejected if a rate for that month already exists.',
  })
  @IsDateString()
  effectiveMonth!: string;

  // Bug fix, 2026-09-03 — was ratePercentage (the monthly figure, typed by
  // hand after the admin computed it themselves). Now the admin enters the
  // raw ANNUAL rate exactly as the Superintendencia publishes it; the
  // service derives and stores the monthly effective rate automatically
  // (UsuryRateService.setRate → convertAnnualToMonthlyRate). See
  // docs/GLOSSARY.md "Usury rate ceiling" and the entity's own comments.
  @ApiProperty({
    example: 29.24,
    description:
      "The month's certified annual usury ceiling ('interés bancario corriente'), exactly as published by the Superintendencia Financiera — e.g. 29.24 for \"29,24%\". The API derives and stores the equivalent monthly effective rate automatically; it is not entered directly.",
  })
  @IsNumber()
  @Min(0)
  annualRatePercentage!: number;
}
