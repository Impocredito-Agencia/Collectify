import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { Audit } from '../auditLog/decorators/audit.decorator';
import { PaginatedResult } from '../common/interfaces/paginatedResult.interface';
import { RequireModule } from '../auth/decorators/requireModule.decorator';
import { AppModule } from '../users/entities/userModulePermission.entity';

import { CreateLoanDto } from './dto/createLoan.dto';
import { UpdateLoanDto } from './dto/updateLoan.dto';
import { PreviewScheduleDto } from './dto/previewSchedule.dto';
import { QueryLoansDto } from './dto/queryLoans.dto';
import { RefinanceLoanDto } from './dto/refinanceLoan.dto';
import { Loan } from './entities/loan.entity';
import {
  LoansService,
  LoanDetail,
  LoanSummary,
  PaymentWithImages,
  RefinanceQuote,
  SchedulePreview,
} from './loans.service';
import { PayoffQuote } from './payoff/calculatePayoff';

@ApiTags('loans')
@ApiBearerAuth()
@Controller('loans')
export class LoansController {
  constructor(private readonly loansService: LoansService) {}

  @Get()
  @ApiOperation({
    summary: 'List loans (paginated, filterable by client/status)',
    description:
      'Each row includes clientFullName, outstandingBalance, installmentsPaid, ' +
      'overdueDays, nextInstallmentDueDate, and overdueBalance — aggregated ' +
      "from the loan's installments, for the standalone Préstamos list " +
      'screen (does not require opening the loan). outstandingBalance sums ' +
      'every pending installment (overdue or not); overdueBalance sums ' +
      'only the overdue ones. search matches the client name or ' +
      'promissory note number.',
  })
  @ApiResponse({ status: 200, description: 'Returns a page of loans.' })
  findAll(
    @Query() query: QueryLoansDto,
  ): Promise<PaginatedResult<LoanSummary>> {
    return this.loansService.findAll(query);
  }

  // Style cleanup (2026-09-03) — must come before @Get(':id') below, or
  // Nest would try to resolve "next-promissory-note-number" as an :id
  // and 404/500 instead of matching this route. Same permission as
  // creating a loan (@RequireModule(AppModule.Loans)) since suggesting a
  // number only makes sense as part of that flow.
  @Get('next-promissory-note-number')
  @RequireModule(AppModule.Loans)
  @ApiOperation({
    summary: 'Suggest the next pagaré number for LoanForm to pre-fill',
    description:
      'Highest numeric part found across every loan (including soft-deleted ones, so a ' +
      "deleted loan's number is never reused) plus 1, formatted #0000-padded. Purely a " +
      'suggestion — the field stays editable and is still validated/uniqueness-checked ' +
      'on submit like any other value. See docs/GLOSSARY.md "Loan / Pagaré".',
  })
  @ApiResponse({ status: 200, description: 'Returns the suggested number.' })
  getNextPromissoryNoteNumber(): Promise<{ nextPromissoryNoteNumber: string }> {
    return this.loansService.getNextPromissoryNoteNumber();
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get a loan with its installments',
    description:
      'overdueDays, interest, and totalDue on each installment are calculated on read, never stored. ' +
      'principalPortion and conceptBreakdown (name + amount per interest/fee concept) were computed ' +
      'once at schedule generation time and are read back as stored — see ' +
      'docs/phases/PHASE_14_INTEREST_CONCEPTS.md. ' +
      'refinancedToLoanId is a computed reverse lookup — the loan this one was later refinanced into, if any. ' +
      'As of Phase 26, coDebtorClient is resolved from coDebtorClientId on read (null when the loan has ' +
      'no co-debtor) — resolved with withDeleted so a loan whose co-debtor was later deactivated still ' +
      'renders instead of breaking. See docs/phases/PHASE_26_CODEBTOR_CLIENT.md. ' +
      'As of Phase 31, currentPrincipalBalance ("saldo capital a la fecha") is the pure remaining ' +
      'principal across still-pending installments, with no accrued interest folded in — same ' +
      'totalPrincipalOwed figure a payoff quote would show, safe to read regardless of loan status.',
  })
  @ApiResponse({
    status: 200,
    description: 'Returns the loan and its installments.',
  })
  @ApiResponse({ status: 404, description: 'Loan not found.' })
  findOne(@Param('id') id: string): Promise<LoanDetail> {
    return this.loansService.findOne(id);
  }

  // Phase 23 — was admin-only (@Roles(UserRole.Admin)); relaxed to
  // @RequireModule so a collector granted the `loans` module can create a
  // loan too, per the client's explicit ask ("los cobradores... sí deben
  // poder crear el crédito"). See docs/phases/PHASE_23_DYNAMIC_CHARGES.md
  // "Permissions" for the full reasoning, including why
  // preview-schedule/GET interest-concept-types below are handled
  // differently.
  @Post()
  @RequireModule(AppModule.Loans)
  @Audit('loan.create', 'loan')
  @ApiOperation({
    summary:
      'Create a loan and generate its installments (admin or granted the loans module)',
    description:
      "The installment schedule is generated automatically from principalAmount, totalInstallments, and concepts (optional fees picked from the InterestConceptTypes catalog). Principal is capital fijo (constant per installment); each concept's true declining-balance value is averaged across the loan and rounded to the nearest $1,000, so every installment — including the last — carries the same flat total (\"cuota con interés\", matching the client's own Excel) — see docs/phases/PHASE_14_INTEREST_CONCEPTS.md. concepts/moratoryConcepts are for optional fees only; they cannot vary per installment. corrienteInterestRate/moratoryInterestRate (system-generated, not a catalog pick) set this loan's own interest: both default to, and are capped at, the current calendar month's usury rate (see GET /usury-rates/current) — a loan cannot be created without that rate on file. Due dates are auto-generated from disbursedAt + installmentFrequency. As of Phase 26, coDebtorClientId optionally links an existing client as co-debtor — it must differ from this loan's own clientId and must reference an existing, active client, or the request is rejected. See docs/phases/PHASE_26_CODEBTOR_CLIENT.md.",
  })
  @ApiResponse({
    status: 201,
    description: 'Returns the created loan and its installments.',
  })
  @ApiResponse({
    status: 400,
    description:
      'The client is mora-blocked (an installment more than 30 days overdue), the ' +
      "principal exceeds the client's available cupo, the current month's usury rate " +
      'has not been entered yet, or coDebtorClientId is invalid (same as clientId, or ' +
      'does not reference an existing, active client) — see the error message for which one applies.',
  })
  @ApiResponse({
    status: 404,
    description: 'A concept references an unknown concept type id.',
  })
  @ApiResponse({
    status: 409,
    description: 'Promissory note number already in use.',
  })
  create(@Body() dto: CreateLoanDto): Promise<LoanDetail> {
    return this.loansService.create(dto);
  }

  // Deliberately open to any authenticated user — same as GET
  // /interest-concept-types, and for the same reason (Phase 23): this is a
  // stateless calculator that touches no client data and persists nothing
  // (confirmed 2026-08-18 for the standalone /cotizador screen, which calls
  // this exact endpoint). "Collectors shouldn't see the amortizador" is
  // implemented as a frontend-only UI decision in LoanForm.tsx, not a
  // backend restriction — see docs/phases/PHASE_23_DYNAMIC_CHARGES.md
  // "Permissions".
  @Post('preview-schedule')
  @ApiOperation({
    summary:
      'Preview the generated installment schedule without creating a loan',
    description:
      "Runs the same amortization generation as POST /loans, for review before committing — including the same Phase 24 hard block (no usury rate on file), so what's previewed always matches what a real submit would persist. See docs/phases/PHASE_24_USURY_MANDATORY.md.",
  })
  @ApiResponse({ status: 201, description: 'Returns the previewed schedule.' })
  @ApiResponse({
    status: 400,
    description: "The current month's usury rate has not been entered yet.",
  })
  @ApiResponse({
    status: 404,
    description: 'A concept references an unknown concept type id.',
  })
  previewSchedule(@Body() dto: PreviewScheduleDto): Promise<SchedulePreview> {
    return this.loansService.previewSchedule(dto);
  }

  @Patch(':id')
  @RequireModule(AppModule.Loans)
  @Audit('loan.update', 'loan')
  @ApiOperation({
    summary:
      "Update a loan's description or co-debtor (admin or granted the loans module)",
    description:
      'As of Phase 26, coDebtorClientId and coDebtorRelationship are also editable here — ' +
      'coDebtorClientId is re-validated with the same rules as loan creation (must differ from ' +
      "the loan's own clientId and must reference an existing, active client) whenever it is " +
      'included in the request. See docs/phases/PHASE_26_CODEBTOR_CLIENT.md. ' +
      '2026-09-04: interestRate and a brief moratoryConcepts field were tried here and then ' +
      "deliberately removed the same day (client feedback) — a loan's numbers (principal, " +
      'schedule, interestRate, every concept) are fixed at creation; anything wrong there ' +
      'requires POST /loans/:id/refinance instead, which regenerates the schedule and notifies ' +
      'the client. Only description is safe to patch silently, since it has no bearing on what ' +
      'the client owes.',
  })
  @ApiResponse({ status: 200, description: 'The loan was updated.' })
  @ApiResponse({
    status: 400,
    description:
      "coDebtorClientId is invalid (same as the loan's own clientId, or does not reference an " +
      'existing, active client).',
  })
  @ApiResponse({ status: 404, description: 'Loan not found.' })
  update(@Param('id') id: string, @Body() dto: UpdateLoanDto): Promise<Loan> {
    return this.loansService.update(id, dto);
  }

  @Get(':id/payoff-quote')
  @ApiOperation({
    summary: 'Quote how much it costs to close this loan out today',
    description:
      "Never blindly sums remaining installment totals — implements the confirmed imputación rule (Colombian Civil Code Art. 1653, see docs/phases/PHASE_16_EARLY_PAYOFF.md). A matured installment (due today or already overdue) contributes its Phase 14 concept charges plus any moratory interest as 'interest', and its principalPortion as 'principal'. A not-yet-due installment contributes ONLY its principalPortion, at face value, with zero interest — no interest is ever charged for a period that hasn't happened yet. An initial installment (Phase 13) contributes only principal, never interest. On top of that, interestTrueUp (2026-09-23) adds the interest already caused to date that the flat, averaged cuotas hadn't collected yet (balance-proportional interest of every matured installment minus what was actually charged on them, minus interest already collected on paid-ahead cuotas; never negative) — included in totalInterestOwed and totalDue, not attributed to any single installment. Read-only; safe to call regardless of the loan's status. Each installment also carries a conceptBreakdown (style cleanup, 2026-09-04): one entry per corriente/moratorio concept actually charged, empty for a not-yet-due installment, purely descriptive alongside the existing interestApplied/principalApplied/totalDue totals (never changes them).",
  })
  @ApiResponse({ status: 200, description: 'Returns the payoff quote.' })
  @ApiResponse({ status: 404, description: 'Loan not found.' })
  getPayoffQuote(@Param('id') id: string): Promise<PayoffQuote> {
    return this.loansService.getPayoffQuote(id);
  }

  @Post(':id/payoff')
  @RequireModule(AppModule.Loans)
  @Audit('loan.payoff', 'loan')
  @ApiOperation({
    summary:
      'Settle the loan today for its full payoff quote, closing it out (admin or granted the loans module)',
    description:
      "A separate, explicit flow from registering an ordinary payment — POST /installments/:id/payments and its one-payment-per-installment behavior are completely untouched. Always settles the FULL amount from GET /loans/:id/payoff-quote; there is no partial early payoff. Registers one real Payment row per still-pending installment (observation: 'Liquidación anticipada'; the quote's interestTrueUp rides on the first pending installment's payment so the payments still sum to the quoted total), marks every installment and the loan 'paid'.",
  })
  @ApiResponse({ status: 200, description: 'The loan was paid off.' })
  @ApiResponse({
    status: 400,
    description: 'The loan is not active (already paid or refinanced).',
  })
  @ApiResponse({ status: 404, description: 'Loan not found.' })
  payoff(@Param('id') id: string): Promise<LoanDetail> {
    return this.loansService.payoff(id);
  }

  @Get(':id/payments')
  @ApiOperation({
    summary: "List a loan's payment history, oldest first",
    description:
      'Joins across every installment belonging to this loan — payments are ' +
      'stored per installment, not per loan (docs/DATABASE.md). Each payment ' +
      'includes imageUrls (Phase 28) — a payment can carry more than one ' +
      'receipt photo.',
  })
  @ApiResponse({ status: 200, description: "Returns the loan's payments." })
  @ApiResponse({ status: 404, description: 'Loan not found.' })
  getPayments(@Param('id') id: string): Promise<PaymentWithImages[]> {
    return this.loansService.getPayments(id);
  }

  @Get(':id/refinance-quote')
  @ApiOperation({
    summary:
      'Suggest a new principal and carried-over concepts for refinancing this loan',
    description:
      "Reopens docs/phases/PHASE_6_REFINANCING.md's manual-entry decision, per " +
      'docs/phases/PHASE_17_REFINANCING_RECALC.md — advisory only, POST /loans/:id/refinance ' +
      'still accepts whatever principalAmount/concepts are actually submitted, unchanged. ' +
      "suggestedPrincipalAmount reuses GET /loans/:id/payoff-quote's totalDue calculation, plus " +
      '(per docs/phases/PHASE_25_REFINANCE_OVERDUE.md) an installment due within the next 5 days ' +
      'also has its corriente interest folded in early, even though it is not yet actually ' +
      'overdue, and the same interestTrueUp as the payoff quote is included in totalDue — ' +
      'earlyWindowInterest reports how much of totalInterestOwed is there ONLY because of that 5-day window (0 when no installment is inside it), so the UI can show it apart from interest that formally ran — ' +
      'overdue — its moratory interest stays 0 since no mora has accrued yet. ' +
      "concepts carries over the old loan's first installment's concepts, " +
      'excluding any whose catalog type was since deleted.',
  })
  @ApiResponse({ status: 200, description: 'Returns the refinance quote.' })
  @ApiResponse({ status: 404, description: 'Loan not found.' })
  getRefinanceQuote(@Param('id') id: string): Promise<RefinanceQuote> {
    return this.loansService.getRefinanceQuote(id);
  }

  @Post(':id/refinance')
  @RequireModule(AppModule.Loans)
  @Audit('loan.refinance', 'loan')
  @ApiOperation({
    summary:
      'Refinance a loan: close it out and open a new one (admin or granted the loans module)',
    description:
      "Sets the old loan's status to 'refinanced' and cancels whatever installments it still had " +
      "pending (marked 'cancelled' — excluded from active collection/reminders, kept as historical " +
      'record). Creates a new loan linked back via refinancedFromLoanId, with its own promissory ' +
      'note number and a schedule generated the same way as loan creation (principalAmount, ' +
      'totalInstallments, and concepts — see POST /loans). principalAmount and concepts are still ' +
      'exactly what the admin submits — see GET /loans/:id/refinance-quote for a suggested ' +
      'starting point, per docs/phases/PHASE_17_REFINANCING_RECALC.md. As of ' +
      'docs/phases/PHASE_25_REFINANCE_OVERDUE.md, a loan with overdue installments can be ' +
      'refinanced freely — the old "client must be current first" rejection is gone. Instead, ' +
      "GET /loans/:id/refinance-quote's suggestedPrincipalAmount already folds in the overdue " +
      "(and near-due) installments' accrued corriente and moratory interest, so refinancing no " +
      'longer requires settling them separately first. As of Phase 24, the same hard block ' +
      '(no usury rate on file) as POST /loans applies here too — see ' +
      'docs/phases/PHASE_24_USURY_MANDATORY.md. As of Phase 26, the new loan carries over the old ' +
      "loan's co-debtor (coDebtorClientId + coDebtorRelationship) by default; passing either field " +
      'in the request overrides it, validated with the same rules as POST /loans. See ' +
      'docs/phases/PHASE_26_CODEBTOR_CLIENT.md.',
  })
  @ApiResponse({
    status: 201,
    description: 'Returns the new loan and its installments.',
  })
  @ApiResponse({
    status: 400,
    description:
      "The loan is not active (already paid or already refinanced), the current month's " +
      "usury rate has not been entered yet, or coDebtorClientId is invalid (same as the loan's " +
      'own clientId, or does not reference an existing, active client) — see the description above.',
  })
  @ApiResponse({ status: 404, description: 'Loan not found.' })
  @ApiResponse({
    status: 409,
    description: 'Promissory note number already in use.',
  })
  refinance(
    @Param('id') id: string,
    @Body() dto: RefinanceLoanDto,
  ): Promise<LoanDetail> {
    return this.loansService.refinance(id, dto);
  }

  @Delete(':id')
  @RequireModule(AppModule.Loans)
  @HttpCode(HttpStatus.NO_CONTENT)
  @Audit('loan.delete', 'loan')
  @ApiOperation({
    summary:
      'Delete a loan created by mistake (admin or granted the loans module)',
    description:
      "Only allowed while none of the loan's installments have any registered payment — " +
      'once a payment exists anywhere on the loan, deletion is refused and the loan must be ' +
      "handled some other way (e.g. refinanced) instead. Soft-delete, cascading to the loan's " +
      'own installments, per docs/phases/PHASE_30_LOAN_CORRECTION.md.',
  })
  @ApiResponse({ status: 204, description: 'The loan was deleted.' })
  @ApiResponse({
    status: 404,
    description: 'Loan not found.',
  })
  @ApiResponse({
    status: 409,
    description: 'The loan already has at least one registered payment.',
  })
  remove(@Param('id') id: string): Promise<void> {
    return this.loansService.remove(id);
  }
}
