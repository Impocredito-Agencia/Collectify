import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNumber, IsUUID, Min } from 'class-validator';

import { ConceptCalculationType } from '../../interestConceptTypes/entities/interestConceptType.entity';

// Confirmed with the human: a loan's concepts are fixed for its whole
// term, set once at creation — never per-installment — since that's what
// makes the capital-fijo schedule well-defined (each concept's percentage
// applies uniformly to the declining balance every period; see
// generateSchedule.ts). See docs/phases/PHASE_14_INTEREST_CONCEPTS.md.
export class LoanConceptAssignmentDto {
  @ApiProperty({
    description: 'Must reference an active InterestConceptType.',
  })
  @IsUUID()
  conceptTypeId!: string;

  @ApiProperty({ enum: ConceptCalculationType })
  @IsEnum(ConceptCalculationType)
  calculationType!: ConceptCalculationType;

  @ApiProperty({
    description:
      "Percentage points (for percentage concepts, applied to the balance outstanding before this installment) or a fixed currency amount (for fixed_amount concepts). A percentage value admits up to 4 decimal places; a fixed_amount one, up to 2 — enforced in LoansService.assertConceptValuePrecision, not here, since it depends on the calculationType field above (see that method's own comment).",
    example: 2,
  })
  @IsNumber()
  @Min(0)
  value!: number;
}
