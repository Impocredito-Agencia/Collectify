import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPhoneNumber,
  IsPositive,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

import { normalizePhoneNumber } from '../../clients/normalizePhoneNumber';
import { InstallmentFrequency } from '../entities/loan.entity';

import { LoanConceptAssignmentDto } from './loanConceptAssignment.dto';

// As of Phase 14, installments are no longer hand-entered totals — the
// amortization schedule (loans/amortization/generateSchedule.ts) is
// generated from principalAmount, totalInstallments, and concepts. See
// docs/phases/PHASE_14_INTEREST_CONCEPTS.md.
export class CreateLoanDto {
  @ApiProperty()
  @IsUUID()
  clientId!: string;

  // Style cleanup (2026-09-03) — standardized to #0000 (zero-padded, min 4
  // digits) going forward, confirmed with the human. Only applies to new
  // loans created from now on; the ~1190 pre-existing loans are NOT being
  // reformatted, so they stay whatever shape they already had ("1", "124",
  // "#743"...) — see docs/GLOSSARY.md "Loan / Pagaré". \d{4,} (not a fixed
  // {4}) so the format keeps validating once the count eventually passes
  // 9999 and a 5th digit is needed — nothing to change here that day.
  @ApiProperty({ example: '#1191' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^#\d{4,}$/, {
    message: 'El número de pagaré debe tener el formato #0000.',
  })
  promissoryNoteNumber!: string;

  @ApiProperty({ example: 900000 })
  @IsPositive()
  principalAmount!: number;

  @ApiProperty({ example: '2026-07-09' })
  @IsDateString()
  disbursedAt!: string;

  // Bug fix, 2026-09-09 — the exact due date of the schedule's own
  // (unshifted) installment 1. Optional, but LoanForm always sends it: the
  // form only ever asks the admin for "fecha de la primera cuota" and
  // back-computes disbursedAt from it by subtracting one period, which
  // loses the true day-of-month whenever that period's month is shorter
  // (e.g. subtracting a month from a March 31 due date clamps disbursedAt
  // to Feb 28 — every installment then silently stuck on day 28, not just
  // the ones landing in a short month). Passing the original date here
  // lets the schedule anchor on it directly instead of re-deriving it from
  // the lossy disbursedAt. See LoansService.calculateDueDate.
  @ApiPropertyOptional({ example: '2026-08-09' })
  @IsOptional()
  @IsDateString()
  firstInstallmentDueDate?: string;

  @ApiProperty({ enum: InstallmentFrequency })
  @IsEnum(InstallmentFrequency)
  installmentFrequency!: InstallmentFrequency;

  @ApiProperty({ example: 12 })
  @IsInt()
  @Min(1)
  totalInstallments!: number;

  @ApiProperty({
    type: [LoanConceptAssignmentDto],
    description:
      'Interest/fee concepts applied to every installment for the whole term of the loan. Can be empty for an interest-free financing plan.',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LoanConceptAssignmentDto)
  concepts!: LoanConceptAssignmentDto[];

  @ApiPropertyOptional({
    type: [LoanConceptAssignmentDto],
    description:
      'Moratory concepts assigned to this loan (Phase 23) — each referenced concept type must have category "moratorio". Unlike concepts above, these are never baked into the installment amount or computed at generation time: they only take effect once an installment is actually overdue, computed live on read. This field only adds catalog concepts ON TOP of the system-generated "Intereses moratorios" concept every loan always gets (see LoansService.resolveConceptsWithInterest) — omit or leave empty for a loan with no additional moratory catalog concepts.',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LoanConceptAssignmentDto)
  moratoryConcepts?: LoanConceptAssignmentDto[];

  // Redesign, 2026-09-03 — the loan's own corriente/moratorio interest,
  // system-generated (not a catalog pick, see LoansService.
  // resolveConceptsWithInterest). Omit to default to the current usury
  // ceiling; either way it can never exceed that ceiling.
  @ApiPropertyOptional({
    example: 2.1,
    description:
      'Corriente interest rate for this loan. Defaults to, and is capped at, the current usury ceiling.',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  corrienteInterestRate?: number;

  @ApiPropertyOptional({
    example: 2.1,
    description:
      'Moratory interest rate for this loan. Defaults to, and is capped at, the current usury ceiling.',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  moratoryInterestRate?: number;

  // Redesign, 2026-09-03 — the previous "cuota inicial" (initialPayment)
  // was purely informational and never affected the schedule, which didn't
  // match how it's actually used: a real down payment negotiated up front,
  // collectible on its own date, interest-free, with the rest of the
  // capital financed normally from installment 2 onward. Replaced with
  // this pair of fields; must be provided together or omitted together
  // (enforced in LoansService, same convention as coDebtorClientId/
  // coDebtorRelationship above) — see loans.service.ts persistLoanWithInstallments.
  @ApiPropertyOptional({
    example: 1000000,
    description:
      "Down payment amount, collected as the loan's own installment 1 with zero ordinary interest. Requires downPaymentDueDate. Omit if there is no down payment.",
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  downPaymentAmount?: number;

  @ApiPropertyOptional({
    example: '2026-09-10',
    description:
      "Due date for the down payment installment, freely chosen and independent of the periodic schedule — must be before the second installment's due date. Requires downPaymentAmount.",
  })
  @IsOptional()
  @IsDateString()
  downPaymentDueDate?: string;

  // Required (2026-09-04, client request) — this is the product the client
  // acquired with the loan (a phone, a TV, a computer...), and it's sent
  // verbatim as the "Detalle del producto" placeholder in the automatic
  // "new loan" WhatsApp message (see newLoanTemplateSelection.ts). Used to
  // be optional with a "No especificado" fallback when blank
  // (descriptionOrFallback, added 2026-09-03) — that fallback is now dead
  // for new loans but stays in place, since it still protects the message
  // send against any pre-existing loan in the DB with a null/empty
  // description from before this field was required.
  @ApiProperty({
    example:
      'Compra de Apple MacBook Air M5 color silver blue, 512GB, 16GB de ram',
    description:
      'The product acquired with this loan — sent verbatim as the "Detalle del producto" placeholder in the automatic "new loan" WhatsApp message.',
  })
  @IsString()
  @IsNotEmpty()
  description!: string;

  // --- Optional co-debtor (codeudor), Phase 26 — at most one per loan,
  // an existing Client picked by id rather than typed by hand (replaces
  // Phase 21's flat co_debtor_* fields). Must not be the same client as
  // this loan's own `clientId` — enforced in LoansService, not here (a
  // cross-field DTO check needs the DTO's own values, which
  // coDebtorClientId alone can't express against clientId cleanly with a
  // single decorator). See docs/phases/PHASE_26_CODEBTOR_CLIENT.md. ---

  @ApiPropertyOptional({
    description:
      "An existing client's id, picked (not typed) as this loan's co-debtor. Must differ from " +
      'clientId above — a client cannot be both debtor and co-debtor on the same loan.',
  })
  @IsOptional()
  @IsUUID()
  coDebtorClientId?: string;

  @ApiPropertyOptional({
    example: 'Hermano del deudor',
    description:
      "This loan's relationship between the debtor and the co-debtor — free text, not a property " +
      'of the co-debtor Client record itself.',
  })
  @IsOptional()
  @IsString()
  coDebtorRelationship?: string;

  // Added 2026-09-06 — see Loan.isNewLoan. Defaults to false ("es viejo")
  // when omitted, so a historical/backfilled loan never needs this set
  // explicitly to behave safely. Stale note corrected 2026-09-18 (human
  // report): this comment used to say LoanForm.tsx always sends `true`
  // — that was only ever true for the brief window when its checkbox was
  // removed, between the two reverts documented in docs/DATABASE.md
  // ("Reverted, 2026-09-06 — new-loan/refinance messages back to
  // synchronous send") and Loan.isNewLoan's own comment (restored
  // 2026-09-09). Every loan created through that form during that window
  // is stuck with isNewLoan: true in the database regardless of what the
  // current code does — see migration
  // SetIsNewLoanFalseForExistingLoans. This field stays optional so any
  // other caller of create() that never sets it explicitly keeps
  // explicitly keeps defaulting to false unaffected.
  @ApiPropertyOptional({
    default: false,
    description:
      'Whether this is a genuinely new credit event that should get the "new loan" WhatsApp ' +
      'message, sent synchronously right after the loan is created, as opposed to a ' +
      'historical/backfilled loan being entered after the fact. Defaults to false (no ' +
      'message) when omitted.',
  })
  @IsOptional()
  @IsBoolean()
  isNewLoan?: boolean;

  // --- Optional alternate contact, human report 2026-09-19 — a rare,
  // per-loan exception: when set, every WhatsApp message about THIS loan
  // (reminders, confirmations, self-service replies) goes to this contact
  // instead of the client's own number(s). Must be provided together or
  // omitted together, same "both or neither" convention as
  // downPaymentAmount/downPaymentDueDate above — enforced in
  // LoansService. ---

  @ApiPropertyOptional({
    example: 'Hermana del deudor',
    description:
      'Name of an alternate contact who should receive every WhatsApp message about this ' +
      'loan instead of the client. Requires alternateContactPhoneNumber. Omit for the ' +
      'normal case (messages go to the client).',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  alternateContactName?: string;

  @ApiPropertyOptional({ example: '+573009876543' })
  @IsOptional()
  @Transform(({ value }) => normalizePhoneNumber(value))
  @IsPhoneNumber('CO')
  alternateContactPhoneNumber?: string;
}
