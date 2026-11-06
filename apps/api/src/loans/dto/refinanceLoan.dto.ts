import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsPhoneNumber,
  IsPositive,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import { normalizePhoneNumber } from '../../clients/normalizePhoneNumber';
import { InstallmentFrequency } from '../entities/loan.entity';

import { LoanConceptAssignmentDto } from './loanConceptAssignment.dto';

// The new loan created by a refinance is built the same way any other loan
// is (see CreateLoanDto) — its schedule is generated from principalAmount,
// totalInstallments, and concepts, as of Phase 14. clientId isn't accepted
// here: the new loan always belongs to the same client as the loan being
// refinanced.
//
// Redesign, 2026-09-06 (confirmed with the human) — promissoryNoteNumber is
// no longer accepted here. The new loan now always keeps the SAME
// promissory note number as the loan it replaces (a refinanced #0800 stays
// #0800) instead of getting a fresh one — LoansService.refinance() sets it
// server-side from the old loan's own number. See docs/DATABASE.md
// "Refinancing".
export class RefinanceLoanDto {
  @ApiProperty({
    example: 950000,
    description:
      'The exact renegotiated amount, entered by the admin — typically the old balance plus accrued interest, but not auto-calculated (this is a business decision — see docs/phases/PHASE_6_REFINANCING.md; docs/phases/PHASE_17_REFINANCING_RECALC.md may change this).',
  })
  @IsPositive()
  principalAmount!: number;

  @ApiProperty({ example: '2026-07-10' })
  @IsDateString()
  disbursedAt!: string;

  // See CreateLoanDto's identical field — same day-of-month bug fix,
  // 2026-09-09.
  @ApiPropertyOptional({ example: '2026-08-10' })
  @IsOptional()
  @IsDateString()
  firstInstallmentDueDate?: string;

  @ApiProperty({ enum: InstallmentFrequency })
  @IsEnum(InstallmentFrequency)
  installmentFrequency!: InstallmentFrequency;

  @ApiProperty({ example: 2 })
  @IsInt()
  @Min(1)
  totalInstallments!: number;

  @ApiProperty({
    type: [LoanConceptAssignmentDto],
    description:
      'Interest/fee concepts applied to every installment of the new loan for its whole term — see CreateLoanDto.',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LoanConceptAssignmentDto)
  concepts!: LoanConceptAssignmentDto[];

  @ApiPropertyOptional({
    type: [LoanConceptAssignmentDto],
    description:
      'Moratory concepts assigned to the new loan — see CreateLoanDto.',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LoanConceptAssignmentDto)
  moratoryConcepts?: LoanConceptAssignmentDto[];

  // See CreateLoanDto — same system-generated interest field.
  @ApiPropertyOptional({
    example: 2.1,
    description:
      'Corriente interest rate for the new loan. Defaults to, and is capped at, the current usury ceiling.',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  corrienteInterestRate?: number;

  @ApiPropertyOptional({
    example: 2.1,
    description:
      'Moratory interest rate for the new loan. Defaults to, and is capped at, the current usury ceiling.',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  moratoryInterestRate?: number;

  // See CreateLoanDto — same down-payment-as-real-installment redesign,
  // 2026-09-03. Unrelated to the loan being refinanced; applies only to
  // the new loan this refinance creates.
  @ApiPropertyOptional({
    example: 1000000,
    description:
      "The new loan's own down payment amount — see CreateLoanDto. Requires downPaymentDueDate.",
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  downPaymentAmount?: number;

  @ApiPropertyOptional({
    example: '2026-09-10',
    description:
      "Due date for the new loan's down payment installment — see CreateLoanDto. Requires downPaymentAmount.",
  })
  @IsOptional()
  @IsDateString()
  downPaymentDueDate?: string;

  // Human request, 2026-11-05 — see Loan.refinanceMoraWaivedAmount. Same
  // rules as a payment's mora waiver: whole pesos, moratory interest only,
  // capped at the refinance quote's maxMoraWaivable (validated in
  // LoansService.refinance against the server's own quote).
  @ApiPropertyOptional({
    example: 45000,
    description:
      "Accrued mora of the old loan forgiven in this refinance, in whole pesos. At most the refinance quote's maxMoraWaivable. Recorded on the new loan; principalAmount is still entered by the admin.",
  })
  @IsOptional()
  @IsInt()
  @IsPositive()
  moraWaivedAmount?: number;

  @ApiPropertyOptional({ example: 'Cliente refinancia y paga al día' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  moraWaiverReason?: string;

  @ApiPropertyOptional({
    example: 'Refinanciación del pagaré anterior',
    description:
      'Free-text concept/reason for the new loan — used in the "new loan" WhatsApp message, if set.',
  })
  @IsOptional()
  @IsString()
  description?: string;

  // --- Optional co-debtor (codeudor) for the new loan, Phase 26. Omit to
  // carry over the old loan's co-debtor unchanged (LoansService.refinance
  // defaults to that — coDebtorClientId + coDebtorRelationship both);
  // pass either field to override. Must not be the same client as the
  // loan's own client — enforced in LoansService. See
  // docs/phases/PHASE_26_CODEBTOR_CLIENT.md. ---

  @ApiPropertyOptional({
    description:
      "An existing client's id, picked as this loan's co-debtor. Omit to carry over the old " +
      "loan's co-debtor unchanged; send null explicitly to deliberately clear it on the new " +
      'loan instead of carrying it over.',
    nullable: true,
  })
  @IsOptional()
  @IsUUID()
  coDebtorClientId?: string | null;

  @ApiPropertyOptional({
    example: 'Hermano del deudor',
    description:
      "This loan's relationship between the debtor and the co-debtor — free text. Same " +
      'omit-to-carry-over/null-to-clear rule as coDebtorClientId.',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  coDebtorRelationship?: string | null;

  // --- Optional alternate contact for the new loan, human report
  // 2026-09-19. Same omit-to-carry-over/null-to-clear rule as
  // coDebtorClientId above — see Loan.alternateContactPhoneNumber. ---

  @ApiPropertyOptional({
    example: 'Hermana del deudor',
    description:
      "Alternate contact name for the new loan. Omit to carry over the old loan's alternate " +
      'contact unchanged; send null explicitly to clear it.',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  alternateContactName?: string | null;

  @ApiPropertyOptional({
    example: '+573009876543',
    nullable: true,
  })
  @IsOptional()
  @Transform(({ value }) =>
    value === null ? null : normalizePhoneNumber(value),
  )
  @IsPhoneNumber('CO')
  alternateContactPhoneNumber?: string | null;

  // Redesign, 2026-09-06 (confirmed with the human) — no longer a field
  // here at all. Unlike CreateLoanDto's isNewLoan (which distinguishes a
  // real new credit event from a historical/backfilled one being typed in
  // after the fact), a refinance can only ever be run against a loan
  // that's already active in the system today — it's always a real, live
  // event, so LoansService.refinance() now hardcodes isNewLoan: true and
  // always schedules the "new loan" WhatsApp message.
}
