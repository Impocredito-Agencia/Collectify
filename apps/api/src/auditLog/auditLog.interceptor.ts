import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { In, Repository } from 'typeorm';

import { AuthenticatedUser } from '../auth/interfaces/authenticatedUser.interface';
import { Client } from '../clients/entities/client.entity';
import { formatPromissoryNoteLabel } from '../common/promissoryNoteLabel';
import { InterestConceptType } from '../interestConceptTypes/entities/interestConceptType.entity';
import { Installment } from '../loans/entities/installment.entity';
import { Loan } from '../loans/entities/loan.entity';
import { User } from '../users/entities/user.entity';
import { ReminderFamily } from '../whatsapp/reminderFamily';

import { AuditLogService } from './auditLog.service';
import { AUDIT_KEY, AuditMetadata } from './decorators/audit.decorator';

// Mirrors apps/client/src/features/messageTemplates/MessageTemplatesPage.tsx's
// own FAMILY_LABELS — kept as a separate copy rather than a shared package,
// same as every other Spanish label already hardcoded in this file (see
// formatClientLabel/formatCuotaGroupsLabel etc.).
const WHATSAPP_CRON_FAMILY_LABELS: Record<ReminderFamily, string> = {
  [ReminderFamily.Overdue]: 'Cuotas vencidas',
  [ReminderFamily.UpcomingDue]: 'Cuotas próximas a vencer',
  [ReminderFamily.NewLoan]: 'Nuevo pagaré / Refinanciación',
};

interface AuditableRequest {
  user?: AuthenticatedUser;
  params: Record<string, string>;
  body: unknown;
}

// Fields that must never be persisted into audit metadata in the clear,
// wherever they show up in a request body — e.g. CreateUserDto.password.
// This is a generic interceptor that captures whatever body a decorated
// endpoint receives, so redaction happens here once rather than trusting
// every future @Audit()-decorated endpoint to remember to scrub its own
// sensitive fields.
const REDACTED_FIELDS = new Set([
  'password',
  'newPassword',
  'currentPassword',
  'passwordHash',
]);
const REDACTED_PLACEHOLDER = '[redacted]';

// Generic, interceptor-based audit trail — applied globally (registered as
// APP_INTERCEPTOR in auditLog.module.ts), not hand-added logging calls
// sprinkled through every service. Only endpoints decorated with @Audit()
// produce a log entry; everything else passes through untouched. See
// docs/phases/PHASE_11_AUDIT_LOG.md.
@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditLogInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly auditLogService: AuditLogService,
    // Read-only, and only for the one case resolveEntityLabel can't
    // avoid: client.addReference/updateReference/removeReference return
    // the ClientReference row, not the Client, so there's no client name
    // to read off the response — see resolveEntityLabel below. Every
    // other entityType builds its label from fields already present on
    // the handler's own response, no query needed.
    @InjectRepository(Client)
    private readonly clientsRepository: Repository<Client>,
    // Same reasoning, for loan.delete (Phase 30) — LoansService.remove()
    // returns void (204 No Content, same convention as
    // ClientsService.softDelete()), so there's no promissoryNoteNumber to
    // read off the response; this falls back to a withDeleted lookup by
    // params.id, mirroring the client fallback above.
    @InjectRepository(Loan)
    private readonly loansRepository: Repository<Loan>,
    // Same reasoning again, for user.delete (Phase 20 follow-up) — but
    // fetched BEFORE the handler runs, not after like the two above.
    // UsersService.remove() does a real SQL DELETE (confirmed with the
    // human, not a soft-delete), so by the time this interceptor's tap()
    // callback would run its post-response lookup, the row is gone for
    // good — a withDeleted-style fallback query would find nothing. See
    // intercept() below.
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    // Same reasoning again, for interestConceptType.delete (2026-09-03,
    // human report — this entityType had no @Audit at all until this
    // point). InterestConceptTypesService.remove() does a real SQL DELETE
    // (only allowed once deactivated and never used on a loan), so — same
    // as usersRepository above — this has to be fetched BEFORE the handler
    // runs, not after.
    @InjectRepository(InterestConceptType)
    private readonly interestConceptTypesRepository: Repository<InterestConceptType>,
    // Human report, 2026-09-04: "Registró un pago" entries only showed the
    // amount and date ("Pago de $ 110.667 el 2026-09-03"), with no way to
    // tell which loan/installment it was for. Payment's own response
    // carries only `installmentId` (see payment.entity.ts) — no
    // installmentNumber or promissoryNoteNumber — so resolveEntityLabel's
    // 'payment' case looks this up after the handler runs, same pattern as
    // the client/loan fallbacks above (not before, like user/
    // interestConceptType — payments are never hard-deleted).
    @InjectRepository(Installment)
    private readonly installmentsRepository: Repository<Installment>,
  ) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    const audit = this.reflector.get<AuditMetadata | undefined>(
      AUDIT_KEY,
      context.getHandler(),
    );
    if (!audit) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<AuditableRequest>();

    // Captured before next.handle() runs — see the constructor comment on
    // usersRepository for why this can't wait until after like
    // resolveEntityLabel's client/loan fallbacks do. Cheap enough to always
    // look up for every 'user'-entityType action (create has no params.id,
    // so this just stays null there), rather than special-casing only
    // user.delete.
    const preFetchedUser =
      audit.entityType === 'user' && request.params.id
        ? await this.usersRepository.findOneBy({ id: request.params.id })
        : null;
    const preFetchedInterestConceptType =
      audit.entityType === 'interestConceptType' && request.params.id
        ? await this.interestConceptTypesRepository.findOneBy({
            id: request.params.id,
          })
        : null;

    // tap's success callback only fires when the handler actually emits a
    // value — a thrown exception skips it entirely, so a failed request
    // (e.g. the loan creation guard rejecting a mora-blocked client)
    // never produces a misleading "success" log entry, with no extra
    // error-handling needed here.
    return next.handle().pipe(
      tap((response) => {
        // Fire-and-forget: a failed audit write must never fail the actual
        // request it's trying to record. Same principle as
        // sendNewLoanMessageSafely in loans.service.ts — log the error,
        // don't throw. Wrapped in an async IIFE (rather than awaited
        // directly in this tap callback) purely so resolveEntityLabel's
        // occasional DB lookup — see its comment — can be awaited before
        // the write, without blocking the response already flowing back
        // to the caller.
        void (async () => {
          const entityLabel = await this.resolveEntityLabel(
            audit.entityType,
            request.params,
            response,
            preFetchedUser,
            preFetchedInterestConceptType,
            request.body,
          );
          await this.auditLogService.record({
            actorUserId: request.user?.id ?? null,
            action: audit.action,
            entityType: audit.entityType,
            entityId: this.resolveEntityId(request.params, response),
            entityLabel,
            metadata: {
              params: request.params,
              body: this.redact(request.body),
            },
          });
        })().catch((error: unknown) => {
          this.logger.error(
            `Failed to write audit log entry for action "${audit.action}"`,
            error,
          );
        });
      }),
    );
  }

  // Builds the human-readable snapshot stored as AuditLog.entityLabel —
  // see that column's comment for why this is resolved once here rather
  // than left for the frontend to re-derive from a live record. Reads
  // straight off the handler's own response wherever possible (no extra
  // query); client.addReference/updateReference/removeReference (response
  // is the ClientReference row, no client name) and whatsappTicket.resolve
  // (response is just `{ sent: boolean }`, no client at all) fall through
  // to a lookup instead.
  private async resolveEntityLabel(
    entityType: string,
    params: Record<string, string>,
    response: unknown,
    preFetchedUser: User | null,
    preFetchedInterestConceptType: InterestConceptType | null,
    requestBody: unknown,
  ): Promise<string | null> {
    const entity = this.unwrapEntity(response);

    switch (entityType) {
      case 'client': {
        if (entity && typeof entity.firstName === 'string') {
          return this.formatClientLabel(entity);
        }
        if (params.id) {
          const client = await this.clientsRepository.findOne({
            where: { id: params.id },
            withDeleted: true,
          });
          return client
            ? this.formatClientLabel(
                client as unknown as Record<string, unknown>,
              )
            : null;
        }
        return null;
      }
      case 'loan': {
        if (entity && typeof entity.promissoryNoteNumber === 'string') {
          return `Pagaré ${formatPromissoryNoteLabel(entity.promissoryNoteNumber)}`;
        }
        if (params.id) {
          const loan = await this.loansRepository.findOne({
            where: { id: params.id },
            withDeleted: true,
          });
          return loan
            ? `Pagaré ${formatPromissoryNoteLabel(loan.promissoryNoteNumber)}`
            : null;
        }
        return null;
      }
      case 'payment': {
        // Bug fix, 2026-09-08 (human report) — payment.registerBulk's
        // response is a Payment[] array, not a single Payment, so the
        // single-payment branch below (which reads entity.amountPaid)
        // always fell through to `null`: "Registró un pago sobre varias
        // cuotas" had no entityLabel at all, giving no way to tell which
        // pagaré/cuotas a bulk action actually touched.
        if (Array.isArray(entity)) {
          return this.formatBulkPaymentLabel(entity);
        }

        if (!entity || typeof entity.amountPaid !== 'number') {
          return null;
        }
        const amount = this.formatCurrencyCop(entity.amountPaid);
        const dateSuffix =
          typeof entity.paidAt === 'string' ? ` el ${entity.paidAt}` : '';
        // Human report, 2026-09-09 — payment.void's response is the same
        // Payment shape as payment.register, now with deletedAt/voidReason
        // set (see InstallmentsService.voidPayment()). Distinguishing the
        // label here means the mandatory reason is visible straight from
        // Auditoría, not just buried in metadata.body.
        const base = entity.deletedAt
          ? `Pago de ${amount}${dateSuffix} ANULADO — motivo: ${typeof entity.voidReason === 'string' ? entity.voidReason : 'sin especificar'}`
          : `Pago de ${amount}${dateSuffix}`;
        // Added 2026-09-04 — see the installmentsRepository comment in the
        // constructor.
        const installmentId =
          typeof entity.installmentId === 'string'
            ? entity.installmentId
            : null;
        if (!installmentId) {
          return base;
        }
        const installment = await this.installmentsRepository.findOne({
          where: { id: installmentId },
          withDeleted: true,
          relations: { loan: true },
        });
        if (!installment) {
          return base;
        }
        return `${base} — cuota ${installment.installmentNumber} del pagaré ${formatPromissoryNoteLabel(installment.loan.promissoryNoteNumber)}`;
      }
      case 'user': {
        if (entity && typeof entity.fullName === 'string') {
          return typeof entity.email === 'string'
            ? `${entity.fullName} (${entity.email})`
            : entity.fullName;
        }
        // user.delete (Phase 20 follow-up): UsersController.remove()
        // returns void (204), and the row is genuinely gone by now (real
        // SQL DELETE) — preFetchedUser is the pre-handler snapshot from
        // intercept() above, the only place this data still existed.
        return preFetchedUser
          ? `${preFetchedUser.fullName} (${preFetchedUser.email})`
          : null;
      }
      case 'usuryRate': {
        if (!entity || typeof entity.ratePercentage !== 'number') {
          return null;
        }
        return typeof entity.effectiveMonth === 'string'
          ? `${entity.ratePercentage}% desde ${entity.effectiveMonth}`
          : `${entity.ratePercentage}%`;
      }
      // Human report, 2026-09-10 — docs/DATABASE.md's 2026-09-03 coverage
      // sweep had already flagged "cron pause/resume/reschedule" as
      // missing @Audit() entirely; this closes that specific gap (the
      // rest of that sweep's list — reply/close-conversation/manual
      // send-reminder/send-upcoming-due/message_logs.retry — stayed open,
      // close-conversation itself closed 2026-09-13, see 'whatsappTicket'
      // below).
      // Distinguishes pause vs. resume vs. reschedule off the response
      // shape alone, same convention as the 'payment' case above
      // (register vs. void) rather than branching on `entityType` +
      // `action` together: pause/resume both return `{ paused: boolean }`
      // (WhatsappCronService.pause/resume), reschedule returns the full
      // schedule-owner MessageTemplate (has cronExpression, no `paused`).
      case 'whatsappCron': {
        const family = params.family;
        const familyLabel =
          family && this.isReminderFamily(family)
            ? WHATSAPP_CRON_FAMILY_LABELS[family]
            : (family ?? 'desconocida');
        if (entity && typeof entity.paused === 'boolean') {
          return `${familyLabel} — ${entity.paused ? 'pausado' : 'reanudado'}`;
        }
        if (entity && typeof entity.cronExpression === 'string') {
          return `${familyLabel} — nuevo horario: ${entity.cronExpression}`;
        }
        return family ? familyLabel : null;
      }
      // Human report, 2026-09-13 — closes another item off the same
      // 2026-09-03 coverage sweep as 'whatsappCron' above:
      // close-conversation had no @Audit() at all. Its response is just
      // `{ sent: boolean }` (no client), so — unlike every case above,
      // which reads off the response — this looks the client up by the
      // phoneNumber the admin submitted, matching either their primary or
      // alternate number (same dual-match WhatsappWebhookService.
      // closeConversation itself uses).
      case 'whatsappTicket': {
        const phoneNumber =
          requestBody &&
          typeof requestBody === 'object' &&
          'phoneNumber' in requestBody &&
          typeof requestBody.phoneNumber === 'string'
            ? (requestBody as { phoneNumber: string }).phoneNumber
            : null;
        if (!phoneNumber) {
          return null;
        }
        const client = await this.clientsRepository.findOne({
          where: [{ phoneNumber }, { alternatePhoneNumber: phoneNumber }],
        });
        return client
          ? this.formatClientLabel(client as unknown as Record<string, unknown>)
          : phoneNumber;
      }
      case 'interestConceptType': {
        if (entity && typeof entity.name === 'string') {
          return entity.name;
        }
        // interestConceptType.delete: InterestConceptTypesController.remove()
        // returns void (204), and the row is genuinely gone by now (real
        // SQL DELETE) — preFetchedInterestConceptType is the pre-handler
        // snapshot from intercept() above, the only place this data still
        // existed. Same shape as the 'user' case above.
        return preFetchedInterestConceptType?.name ?? null;
      }
      default:
        // No labeling rule for this entityType yet — falls back to
        // showing just the (translated) entityType, same as before this
        // feature existed. Not a bug; just not extended yet.
        return null;
    }
  }

  // Bug fix, 2026-09-08 (human report) — see the 'payment' case above.
  // Batched (one query for every installment in the bulk request, not
  // N+1), same convention as findConceptsByInstallmentId/
  // sumPaymentsByInstallmentId elsewhere in the codebase.
  private async formatBulkPaymentLabel(
    payments: unknown[],
  ): Promise<string | null> {
    const validPayments = payments.filter(
      (payment): payment is Record<string, unknown> =>
        typeof payment === 'object' &&
        payment !== null &&
        typeof (payment as Record<string, unknown>).amountPaid === 'number',
    );
    if (validPayments.length === 0) {
      return null;
    }

    const totalAmount = validPayments.reduce(
      (sum, payment) => sum + (payment.amountPaid as number),
      0,
    );
    const base = `Pago de ${this.formatCurrencyCop(totalAmount)} en ${validPayments.length} cuotas`;

    const installmentIds = validPayments
      .map((payment) =>
        typeof payment.installmentId === 'string'
          ? payment.installmentId
          : null,
      )
      .filter((id): id is string => id !== null);
    if (installmentIds.length === 0) {
      return base;
    }

    const installments = await this.installmentsRepository.find({
      where: { id: In(installmentIds) },
      withDeleted: true,
      relations: { loan: true },
    });
    const installmentById = new Map(
      installments.map((installment) => [installment.id, installment]),
    );

    const orderedInstallments = installmentIds
      .map((id) => installmentById.get(id))
      .filter((installment): installment is Installment => !!installment);
    if (orderedInstallments.length === 0) {
      return base;
    }

    return `${base} — ${this.formatCuotaGroupsLabel(orderedInstallments)}`;
  }

  // Human report, 2026-09-09 — spelling out "cuota N del pagaré #X" once
  // per installment made a batch of 3+ cuotas unreadably long and forced
  // every other column in the audit table to shrink. Groups by loan
  // instead — one "cuota 4, 5 y 6 del pagaré #2" segment per pagaré
  // touched, in the order each loan first appears among the entries —
  // rather than one segment per installment. Groups (plural loans in the
  // same batch) are joined with "; " so they stay visually distinct from
  // the ", "/" y " Intl.ListFormat already uses inside each group's own
  // cuota list.
  private formatCuotaGroupsLabel(installments: Installment[]): string {
    const numbersByLoan = new Map<
      string,
      { promissoryNoteNumber: string; numbers: number[] }
    >();
    for (const installment of installments) {
      const loanId = installment.loan.id;
      const group = numbersByLoan.get(loanId);
      if (group) {
        group.numbers.push(installment.installmentNumber);
      } else {
        numbersByLoan.set(loanId, {
          promissoryNoteNumber: installment.loan.promissoryNoteNumber,
          numbers: [installment.installmentNumber],
        });
      }
    }

    return [...numbersByLoan.values()]
      .map(({ promissoryNoteNumber, numbers }) => {
        const sorted = [...numbers].sort((a, b) => a - b);
        const cuotaWord = sorted.length > 1 ? 'cuotas' : 'cuota';
        return `${cuotaWord} ${this.formatNumberList(sorted)} del pagaré ${formatPromissoryNoteLabel(promissoryNoteNumber)}`;
      })
      .join('; ');
  }

  // "4, 5 y 6" instead of a manual comma-join — Intl.ListFormat already
  // handles the "y" before the last item (and the 2-item "4 y 5" case)
  // correctly for Spanish, so this isn't reimplemented by hand.
  private formatNumberList(numbers: number[]): string {
    return new Intl.ListFormat('es', {
      style: 'long',
      type: 'conjunction',
    }).format(numbers.map(String));
  }

  private isReminderFamily(value: string): value is ReminderFamily {
    return (Object.values(ReminderFamily) as string[]).includes(value);
  }

  private formatClientLabel(client: Record<string, unknown>): string {
    const firstName =
      typeof client.firstName === 'string' ? client.firstName : '';
    const lastName = typeof client.lastName === 'string' ? client.lastName : '';
    const documentNumber =
      typeof client.documentNumber === 'string' ? client.documentNumber : null;
    const name = `${firstName} ${lastName}`.trim();
    return documentNumber ? `${name} (CC ${documentNumber})` : name;
  }

  private formatCurrencyCop(amount: number): string {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      maximumFractionDigits: 0,
    }).format(amount);
  }

  // Same raw-entity vs. ResponseInterceptor-wrapped ({ data: {...} })
  // ambiguity resolveEntityId already has to handle — see its comment.
  private unwrapEntity(response: unknown): Record<string, unknown> | null {
    if (typeof response !== 'object' || response === null) {
      return null;
    }
    const data = (response as Record<string, unknown>).data;
    if (typeof data === 'object' && data !== null) {
      return data as Record<string, unknown>;
    }
    return response as Record<string, unknown>;
  }

  // Prefers the id on whatever the handler actually returned — this is the
  // entity the action produced or affected, and for most endpoints that's
  // the same value as the route's own :id anyway (update/deactivate/
  // reactivate all return the same record they were called on).
  // It matters for the cases where it *isn't* the same: POST
  // /installments/:id/payments's :id is the INSTALLMENT, not the payment
  // being logged (entityType 'payment') — using the response's id avoids
  // logging the wrong entity there. Falls back to params.id only when the
  // response has no extractable id (e.g. a 204 No Content delete). Checked
  // defensively in both the raw-entity and ResponseInterceptor-wrapped
  // ({ data: {...} }) shapes: this interceptor's exact position relative
  // to ResponseInterceptor in the global chain isn't something to depend on.
  private resolveEntityId(
    params: Record<string, string>,
    response: unknown,
  ): string | null {
    const direct = this.extractId(response);
    if (direct) {
      return direct;
    }

    if (typeof response === 'object' && response !== null) {
      const data = (response as Record<string, unknown>).data;
      const nested = this.extractId(data);
      if (nested) {
        return nested;
      }
    }

    return params.id ?? null;
  }

  private extractId(value: unknown): string | null {
    if (typeof value !== 'object' || value === null) {
      return null;
    }
    const id = (value as Record<string, unknown>).id;
    return typeof id === 'string' ? id : null;
  }

  private redact(body: unknown): unknown {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return body;
    }
    return Object.fromEntries(
      Object.entries(body as Record<string, unknown>).map(([key, value]) => [
        key,
        REDACTED_FIELDS.has(key) ? REDACTED_PLACEHOLDER : value,
      ]),
    );
  }
}
