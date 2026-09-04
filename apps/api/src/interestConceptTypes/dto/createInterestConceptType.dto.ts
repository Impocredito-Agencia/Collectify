import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateIf,
} from 'class-validator';

import {
  ConceptCalculationType,
  ConceptCategory,
  FixedAmountDistribution,
} from '../entities/interestConceptType.entity';

export class CreateInterestConceptTypeDto {
  @ApiProperty({ example: 'Gastos de cobranza' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({ enum: ConceptCalculationType })
  @IsEnum(ConceptCalculationType)
  defaultCalculationType!: ConceptCalculationType;

  @ApiProperty({
    enum: ConceptCategory,
    description:
      'Which side of the concept engine this type belongs to — corriente (ordinary cost, priced at loan generation) or moratorio (overdue-only, computed live on read). See docs/phases/PHASE_23_DYNAMIC_CHARGES.md.',
  })
  @IsEnum(ConceptCategory)
  category!: ConceptCategory;

  @ApiPropertyOptional({
    enum: FixedAmountDistribution,
    description:
      'Required when defaultCalculationType is fixed_amount and category is corriente — no silent default (confirmed with the human). Ignored for percentage concepts and for moratorio concepts (a moratorio fixed_amount concept is always charged once, flat, on the overdue installment).',
  })
  @ValidateIf(
    (dto: CreateInterestConceptTypeDto) =>
      dto.defaultCalculationType === ConceptCalculationType.FixedAmount &&
      dto.category === ConceptCategory.Corriente,
  )
  @IsEnum(FixedAmountDistribution)
  fixedAmountDistribution?: FixedAmountDistribution;

  @ApiPropertyOptional({
    description:
      'Suggested starting value (percentage points, or a fixed currency amount, depending on defaultCalculationType). Always overridable per installment when applying this type to a loan.',
    example: 3,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  defaultValue?: number;
}
