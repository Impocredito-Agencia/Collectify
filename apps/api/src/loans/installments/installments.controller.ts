import {
  Body,
  Controller,
  Get,
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

import { Audit } from '../../auditLog/decorators/audit.decorator';
import { CurrentUser } from '../../auth/decorators/currentUser.decorator';
import { RequireModule } from '../../auth/decorators/requireModule.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import { PaginatedResult } from '../../common/interfaces/paginatedResult.interface';
import { AppModule } from '../../users/entities/userModulePermission.entity';
import { UserRole } from '../../users/entities/user.entity';
import { Installment } from '../entities/installment.entity';
import { Payment } from '../entities/payment.entity';

import { ApplyClientCreditDto } from './dto/applyClientCredit.dto';
import { CreatePaymentDto } from './dto/createPayment.dto';
import { QueryInstallmentValuationDto } from './dto/queryInstallmentValuation.dto';
import { QueryInstallmentsDto } from './dto/queryInstallments.dto';
import { RegisterBulkPaymentsDto } from './dto/registerBulkPayments.dto';
import { UpdateInstallmentDueDateDto } from './dto/updateInstallmentDueDate.dto';
import { VoidPaymentDto } from './dto/voidPayment.dto';
import { InstallmentWithCalculated } from './enrichInstallment';
import {
  InstallmentsService,
  InstallmentValuation,
} from './installments.service';

import type { AuthenticatedUser } from '../../auth/interfaces/authenticatedUser.interface';

@ApiTags('installments')
@ApiBearerAuth()
@Controller('installments')
export class InstallmentsController {
  constructor(private readonly installmentsService: InstallmentsService) {}

  @Get()
  @ApiOperation({
    summary: 'List installments (filterable by loan/status/overdue-only)',
    description:
      'Each installment includes principalPortion and conceptBreakdown ' +
      '(name + amount per interest/fee concept), computed once at schedule ' +
      'generation time — see docs/phases/PHASE_14_INTEREST_CONCEPTS.md.',
  })
  @ApiResponse({ status: 200, description: 'Returns a page of installments.' })
  findAll(
    @Query() query: QueryInstallmentsDto,
  ): Promise<PaginatedResult<InstallmentWithCalculated>> {
    return this.installmentsService.findAll(query);
  }

  // Declared before any ':id' route so 'valuation' is never read as an id.
  @Get('valuation')
  @ApiOperation({
    summary: 'Value installments as they stood on a payment date',
    description:
      "What each installment owed at the end of `date` (Bogotá): overdue days, mora and remaining balance, net of every payment already registered on it. If an installment already has a payment dated after `date`, it is valued on that later payment's day instead (it can't be settled before a payment counted toward it) — `valuationDate` says which day was used. Same valuation POST /installments/:id/payments and /payments/bulk apply to a payment with that paidAt.",
  })
  @ApiResponse({
    status: 200,
    description: 'One valuation per installment found.',
  })
  @ApiResponse({
    status: 400,
    description: 'date missing, malformed, or later than today.',
  })
  getValuation(
    @Query() query: QueryInstallmentValuationDto,
  ): Promise<InstallmentValuation[]> {
    return this.installmentsService.getValuationAsOf(
      query.installmentIds,
      query.date,
    );
  }

  // Declared before ':id/payments' — a literal 'payments/bulk' segment
  // pair never actually collides with the ':id/payments' param route
  // (the second segment there must be literally "payments", which "bulk"
  // isn't), but literal routes are still declared ahead of param routes
  // here for clarity.
  @Post('payments/bulk')
  @Audit('payment.registerBulk', 'payment')
  @ApiOperation({
    summary: 'Register payments against several installments in one action',
    description:
      'Each entry is the same shape as POST /installments/:id/payments, just repeated — the amount is entered individually per installment, never split from a single total (confirmed with the human). Requires FULL payment of every installment in the batch; a partial payment stays on the single-installment endpoint, which already supports it. All-or-nothing: wrapped in one transaction, so a rejected entry rolls back every payment already created earlier in the same request. See docs/phases/PHASE_28_MULTI_INSTALLMENT_PAYMENT.md.',
  })
  @ApiResponse({
    status: 201,
    description: 'Every payment in the batch was recorded.',
  })
  @ApiResponse({
    status: 400,
    description:
      "An installment isn't pending, an entry's amount doesn't fully cover its installment's remaining balance, or an entry would pay an installment while an earlier-numbered installment on the same loan is still pending (Phase 32).",
  })
  @ApiResponse({ status: 404, description: 'An installment was not found.' })
  registerBulkPayments(
    @CurrentUser() _currentUser: AuthenticatedUser,
    @Body() dto: RegisterBulkPaymentsDto,
  ): Promise<Payment[]> {
    return this.installmentsService.registerBulkPayments(dto.payments);
  }

  @Post(':id/payments')
  @Audit('payment.register', 'payment')
  @ApiOperation({
    summary: 'Register a payment against an installment',
    description:
      'Accepts optional imageUrls for the deposit receipt photos (a payment can carry more than one, as of Phase 28). The api does not handle image uploads — each URL must already point to an externally hosted image (see docs/phases/PHASE_12_PAYMENT_ATTACHMENTS.md); the client is responsible for uploading the files and passing back the resulting URLs.',
  })
  @ApiResponse({ status: 201, description: 'The payment was recorded.' })
  @ApiResponse({
    status: 400,
    description:
      'An earlier-numbered installment on the same loan is still pending (Phase 32) — this installment cannot be paid out of order.',
  })
  @ApiResponse({ status: 404, description: 'Installment not found.' })
  registerPayment(
    @Param('id') id: string,
    // Previously uncaptured entirely (see docs/phases/PHASE_11_AUDIT_LOG.md
    // "Scope decisions") — now available for AuditLogInterceptor to read
    // off the request. Not passed to the service: the audit log entry
    // itself is the record of who registered this payment, per that same
    // note, rather than a denormalized column on Payment. Placed before
    // `dto` (not after) so it stays exempt from
    // @typescript-eslint/no-unused-vars' default `args: 'after-used'`
    // option — same reason `_data` precedes `ctx` in
    // currentUser.decorator.ts and `_context` precedes `next` in
    // response.interceptor.ts. Param order has no functional effect on
    // NestJS route binding, which matches by decorator, not position.
    @CurrentUser() _currentUser: AuthenticatedUser,
    @Body() dto: CreatePaymentDto,
  ): Promise<Payment> {
    return this.installmentsService.registerPayment(id, dto);
  }

  // Human report, 2026-09-14 — the explicit, operator-initiated half of
  // saldo a favor: applying an already-generated client credit to a
  // pending installment. Never automatic — see
  // InstallmentsService.applyCreditToInstallment's own comment.
  @Post(':id/apply-credit')
  @Audit('payment.applyCredit', 'payment')
  @ApiOperation({
    summary: "Apply part of a client's saldo a favor to a pending installment",
    description:
      'Creates a real Payment against the installment (fundedByCredit: true) for the ' +
      "given amount, deducted from the client's credit balance. Rejected if the " +
      "amount exceeds the client's available credit, or the installment doesn't " +
      'belong to that client.',
  })
  @ApiResponse({ status: 201, description: 'The credit was applied.' })
  @ApiResponse({
    status: 400,
    description:
      "The amount exceeds the client's available credit, or the installment doesn't belong to this client.",
  })
  @ApiResponse({ status: 404, description: 'Installment not found.' })
  applyCredit(
    @Param('id') id: string,
    @CurrentUser() _currentUser: AuthenticatedUser,
    @Body() dto: ApplyClientCreditDto,
  ): Promise<Payment> {
    return this.installmentsService.applyCreditToInstallment(
      dto.clientId,
      id,
      dto.amount,
    );
  }

  // Human report, 2026-09-09 — admin-only correction for a payment
  // registered by mistake. @Roles(UserRole.Admin), not @RequireModule: the
  // human was explicit this is stricter than the general "loans" module
  // grant collectors can otherwise have — see docs/GLOSSARY.md "Module
  // permission"'s Usuarios precedent for the same "always admin-only,
  // regardless of module grants" pattern.
  @Patch('payments/:id/void')
  @Roles(UserRole.Admin)
  @Audit('payment.void', 'payment')
  @ApiOperation({
    summary: 'Void (annul) a previously registered payment — admin only',
    description:
      'Soft-deletes the payment. If it had closed its installment, the installment (and the loan, if it had cascaded to Paid) reopens so the real remaining balance shows again everywhere. Requires a reason, recorded on the payment and captured in the audit log.',
  })
  @ApiResponse({ status: 200, description: 'The payment was voided.' })
  @ApiResponse({
    status: 400,
    description: 'The payment was already voided.',
  })
  @ApiResponse({ status: 404, description: 'Payment not found.' })
  voidPayment(
    @Param('id') id: string,
    @CurrentUser() _currentUser: AuthenticatedUser,
    @Body() dto: VoidPaymentDto,
  ): Promise<Payment> {
    return this.installmentsService.voidPayment(id, dto);
  }

  // Human report, 2026-09-22 — a narrow exception to "a loan's schedule is
  // fixed at creation" (see UpdateLoanDto's own comment): moves ONE
  // pending installment's collection date, nothing about what it owes.
  // Same permission level as PATCH /loans/:id (any other loan-modifying
  // action) rather than voidPayment's stricter admin-only gate above —
  // this doesn't touch money, just when it's collected.
  @Patch(':id/due-date')
  @RequireModule(AppModule.Loans)
  @Audit('installment.updateDueDate', 'installment')
  @ApiOperation({
    summary:
      "Move a single pending installment's due date (admin or granted the loans module)",
    description:
      "Only the date changes — amount, principalPortion, and every concept stay exactly as generated. The new date can't cross an adjacent still-pending installment's own due date (keeps the schedule in installmentNumber order). See InstallmentsService.alignDueDay for moving every pending installment of a loan at once.",
  })
  @ApiResponse({ status: 200, description: 'The due date was updated.' })
  @ApiResponse({
    status: 400,
    description:
      'The installment is not pending, or the new date crosses an adjacent installment.',
  })
  @ApiResponse({ status: 404, description: 'Installment not found.' })
  updateDueDate(
    @Param('id') id: string,
    @Body() dto: UpdateInstallmentDueDateDto,
  ): Promise<Installment> {
    return this.installmentsService.updateDueDate(id, dto);
  }
}
