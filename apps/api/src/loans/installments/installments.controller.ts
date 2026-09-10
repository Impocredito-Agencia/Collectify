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
import { Roles } from '../../auth/decorators/roles.decorator';
import { PaginatedResult } from '../../common/interfaces/paginatedResult.interface';
import { UserRole } from '../../users/entities/user.entity';
import { Payment } from '../entities/payment.entity';

import { CreatePaymentDto } from './dto/createPayment.dto';
import { QueryInstallmentsDto } from './dto/queryInstallments.dto';
import { RegisterBulkPaymentsDto } from './dto/registerBulkPayments.dto';
import { VoidPaymentDto } from './dto/voidPayment.dto';
import { InstallmentWithCalculated } from './enrichInstallment';
import { InstallmentsService } from './installments.service';

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
}
