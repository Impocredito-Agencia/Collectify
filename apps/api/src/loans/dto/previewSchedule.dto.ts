import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

import { InstallmentFrequency } from '../entities/loan.entity';

import { LoanConceptAssignmentDto } from './loanConceptAssignment.dto';

// Same shape as the schedule-relevant subset of CreateLoanDto — no
// clientId/promissoryNoteNumber, since nothing is persisted here.
export class PreviewScheduleDto {
  @ApiProperty({ example: 900000 })
  @IsPositive()
  principalAmount!: number;

  @ApiProperty({ example: '2026-07-09' })
  @IsDateString()
  disbursedAt!: string;

  @ApiProperty({ enum: InstallmentFrequency })
  @IsEnum(InstallmentFrequency)
  installmentFrequency!: InstallmentFrequency;

  @ApiProperty({ example: 12 })
  @IsInt()
  @Min(1)
  totalInstallments!: number;

  @ApiProperty({ type: [LoanConceptAssignmentDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LoanConceptAssignmentDto)
  concepts!: LoanConceptAssignmentDto[];

  @ApiPropertyOptional({
    type: [LoanConceptAssignmentDto],
    description:
      "Moratory concepts to preview (Phase 23) — shown in each installment's conceptBreakdown at amount 0, since nothing is overdue in a preview. See CreateLoanDto.",
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LoanConceptAssignmentDto)
  moratoryConcepts?: LoanConceptAssignmentDto[];

  // See CreateLoanDto — same system-generated interest field, previewed
  // the same way a real create would resolve it.
  @ApiPropertyOptional({ example: 2.1 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  corrienteInterestRate?: number;

  @ApiPropertyOptional({ example: 2.1 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  moratoryInterestRate?: number;
}
