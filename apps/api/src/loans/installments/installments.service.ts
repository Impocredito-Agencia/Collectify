import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  And,
  DataSource,
  EntityManager,
  Equal,
  FindOptionsWhere,
  In,
  LessThan,
  Repository,
} from 'typeorm';

import { PaginatedResult } from '../../common/interfaces/paginatedResult.interface';
import { PaymentConfirmationService } from '../../whatsapp/paymentConfirmation.service';
import { Installment, InstallmentStatus } from '../entities/installment.entity';
import { Loan, LoanStatus } from '../entities/loan.entity';
import { LoanInstallmentConcept } from '../entities/loanInstallmentConcept.entity';
import { Payment } from '../entities/payment.entity';
import { PaymentImage } from '../entities/paymentImage.entity';

import { CreatePaymentDto } from './dto/createPayment.dto';
import { QueryInstallmentsDto } from './dto/queryInstallments.dto';
import { BulkPaymentEntryDto } from './dto/registerBulkPayments.dto';
import { VoidPaymentDto } from './dto/voidPayment.dto';
import {
  enrichInstallment,
  InstallmentWithCalculated,
} from './enrichInstallment';
import { sumPaymentsByInstallmentId } from './paymentTotals';

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;

@Injectable()
export class InstallmentsService {
  private readonly logger = new Logger(InstallmentsService.name);

  constructor(
    @InjectRepository(Installment)
    private readonly installmentsRepository: Repository<Installment>,
    @InjectRepository(Payment)
    private readonly paymentsRepository: Repository<Payment>,
    @InjectRepository(Loan)
    private readonly loansRepository: Repository<Loan>,
    @InjectRepository(LoanInstallmentConcept)
    private readonly loanInstallmentConceptsRepository: Repository<LoanInstallmentConcept>,
    @InjectRepository(PaymentImage)
    private readonly paymentImagesRepository: Repository<PaymentImage>,
    private readonly dataSource: DataSource,
    private readonly paymentConfirmationService: PaymentConfirmationService,
  ) {}

  async findAll(
    query: QueryInstallmentsDto,
  ): Promise<PaginatedResult<InstallmentWithCalculated>> {
    const page = query.page ?? DEFAULT_PAGE;
    const limit = query.limit ?? DEFAULT_PAGE_SIZE;

    const where: FindOptionsWhere<Installment> = {};
    if (query.loanId) {
      where.loanId = query.loanId;
    }
    if (query.overdueOnly) {
      // Mirrors the previous two `andWhere` calls: status must be Pending
      // AND dueDate must be in the past. If an explicit status filter is
      // also given, both conditions apply — And() preserves that (a status
      // other than 'pending' combined with overdueOnly matches nothing,
      // same as the old chained andWhere clauses would).
      where.status = query.status
        ? And(Equal(query.status), Equal(InstallmentStatus.Pending))
        : InstallmentStatus.Pending;
      where.dueDate = LessThan(new Date().toISOString().slice(0, 10));
    } else if (query.status) {
      where.status = query.status;
    }

    // Removed, 2026-09-09 — relations: { loan: true } used to be loaded
    // here purely to read loan.interestRate for enrichInstallment(), which
    // no longer takes that parameter (see enrichInstallment.ts's own
    // note). Nothing else in this method touches the loan relation.
    const [items, total] = await this.installmentsRepository.findAndCount({
      where,
      order: { dueDate: 'ASC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    const conceptsByInstallmentId = await this.findConceptsByInstallmentId(
      items.map((installment) => installment.id),
    );
    // Bug fix, 2026-09-07 — see enrichInstallment.ts's `totalPaid` param and
    // docs/DATABASE.md's note of this date: without this, a partially paid
    // Pending installment reported its full original totalDue here, as if
    // nothing had been paid on it yet.
    const totalPaidByInstallmentId = await sumPaymentsByInstallmentId(
      this.paymentsRepository,
      items.map((installment) => installment.id),
    );

    return {
      items: items.map((installment) =>
        enrichInstallment(
          installment,
          conceptsByInstallmentId.get(installment.id) ?? [],
          totalPaidByInstallmentId.get(installment.id) ?? 0,
        ),
      ),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  // Groups a page of installments' LoanInstallmentConcept rows by
  // installmentId in one query — see LoansService's identical helper for
  // GET /loans/:id (docs/phases/PHASE_14_INTEREST_CONCEPTS.md).
  private async findConceptsByInstallmentId(
    installmentIds: string[],
  ): Promise<Map<string, LoanInstallmentConcept[]>> {
    const map = new Map<string, LoanInstallmentConcept[]>();
    if (installmentIds.length === 0) {
      return map;
    }

    const concepts = await this.loanInstallmentConceptsRepository.find({
      where: { installmentId: In(installmentIds) },
    });
    for (const concept of concepts) {
      const existing = map.get(concept.installmentId) ?? [];
      existing.push(concept);
      map.set(concept.installmentId, existing);
    }
    return map;
  }

  async registerPayment(
    installmentId: string,
    dto: CreatePaymentDto,
  ): Promise<Payment> {
    const installment = await this.installmentsRepository.findOne({
      where: { id: installmentId },
    });
    if (!installment) {
      throw new NotFoundException(
        `Installment with id ${installmentId} not found`,
      );
    }

    // Phase 32 — a defense-in-depth rule, not just a UI-disabled button: an
    // installment can't be paid while an earlier-numbered installment on
    // the same loan is still pending, even via a direct API call. Only
    // meaningful when this installment itself is still Pending — an
    // already-Paid/Cancelled installment never reaches this branch, but see
    // the balance-ceiling check right below for why it still can't accept a
    // new payment either.
    if (installment.status === InstallmentStatus.Pending) {
      await this.assertNoEarlierPendingInstallment(
        installment,
        this.installmentsRepository,
      );
    }

    // Bug fix, 2026-09-07 (human report, préstamo #0920) — nothing used to
    // stop a payment from exceeding what was actually still owed on this
    // installment: a first partial payment left a real balance of $50.000,
    // but the dialog re-offered the cuota's full original amount as the
    // default (enrichInstallment.totalDue didn't net out prior payments —
    // now fixed, see that function's `totalPaid` param), and neither this
    // service nor CreatePaymentDto capped the amount at all. A second
    // payment for the full $850.000 went through on top of the first,
    // marking the loan "Pagado" with $800.000 paid that was never actually
    // owed. Confirmed with the human: reject the excess outright rather
    // than silently accepting it — how the cobrador should record a
    // genuine excess handed over in person (apply it to the next
    // installment, hand back change, etc.) is a separate, not-yet-decided
    // question, deliberately not guessed at here. This also means an
    // installment that's already Paid or Cancelled (remainingBalance
    // resolves to 0 for both, see enrichInstallment's non-Pending
    // short-circuit) can no longer silently accept an extra payment record
    // either — a deliberate tightening of the old Phase 32 behavior, not an
    // oversight.
    const totalPaidBefore = await this.sumPayments(
      installmentId,
      this.paymentsRepository,
    );
    const remainingBalance = await this.resolveRemainingBalance(
      installment,
      totalPaidBefore,
      this.loanInstallmentConceptsRepository,
    );
    const maxPayable = Math.ceil(remainingBalance);
    if (dto.amountPaid > maxPayable) {
      throw new BadRequestException(
        `El monto del pago ($${dto.amountPaid}) supera el saldo pendiente de esta cuota ($${maxPayable}). Registra como máximo ese valor.`,
      );
    }

    const payment = this.paymentsRepository.create({
      installmentId,
      amountPaid: dto.amountPaid,
      paidAt: dto.paidAt,
      observation: dto.observation ?? null,
      // imageUrl is deprecated as of Phase 28 — no longer written for new
      // payments, see payment.entity.ts. Photos go through payment_images
      // below instead.
      imageUrl: null,
    });
    const savedPayment = await this.paymentsRepository.save(payment);
    await this.savePaymentImages(
      savedPayment.id,
      dto.imageUrls,
      this.paymentImagesRepository,
    );

    if (installment.status === InstallmentStatus.Pending) {
      // Bug fix, 2026-09-08 (human decision, following the #0920 payment-cap
      // fix above) — used to compare totalPaid against installment.amount
      // alone, so a cobrador could close a cuota (and stop it from ever
      // accruing further mora, since a non-Pending installment always
      // reports totalDue/interest/overdueDays as 0 — see
      // enrichInstallment.ts) while forgiving whatever moratory interest was
      // already accrued, without any explicit decision to waive it. That
      // rule traces back to the very first Phase 4 spec ("if accumulated
      // payments cover the installment amount, mark it paid") — written
      // before moratory interest was even a live, separately-tracked
      // concept, and never revisited. Now requires the installment's real
      // remaining balance (capital + accrued mora, same formula the
      // register-payment dialog shows) to reach 0 before closing it — mora
      // is never optional/negotiable via a partial payment anymore. Reuses
      // resolveRemainingBalance (already clamped at 0 by
      // enrichInstallment's totalDue) rather than re-deriving the threshold
      // separately, so this can never disagree with what totalPaidBefore
      // above's max-payable ceiling already enforced.
      const totalPaidAfter = await this.sumPayments(
        installmentId,
        this.paymentsRepository,
      );
      const remainingBalanceAfter = await this.resolveRemainingBalance(
        installment,
        totalPaidAfter,
        this.loanInstallmentConceptsRepository,
      );
      if (remainingBalanceAfter <= 0) {
        await this.installmentsRepository.update(
          { id: installmentId },
          { status: InstallmentStatus.Paid },
        );
        const paidInFull = await this.cascadeLoanStatusIfFullyPaid(
          installment.loanId,
          this.installmentsRepository,
          this.loansRepository,
        );
        await this.sendPaymentConfirmationSafely(installmentId);
        if (paidInFull) {
          await this.sendPaidInFullSafely(installment.loanId);
        }
      }
    }

    return savedPayment;
  }

  // Phase 28 — pays several installments in one action, one amount entered
  // individually per installment (confirmed with the human, not a single
  // total split across them). Requires FULL payment of every installment in
  // the batch — a batch entry that wouldn't fully settle its installment
  // rejects the whole request before anything is persisted, per the same
  // confirmed rule; partial payment stays on the single-installment flow
  // above, which already supports it. All-or-nothing: wrapped in one
  // transaction, same precedent as LoansService.refinance() — a failure on
  // any entry rolls back every row already created earlier in this request.
  async registerBulkPayments(
    entries: BulkPaymentEntryDto[],
  ): Promise<Payment[]> {
    const paidInFullLoanIds = new Set<string>();

    const savedPayments = await this.dataSource.transaction(
      async (manager: EntityManager) => {
        const installmentsRepository = manager.getRepository(Installment);
        const paymentsRepository = manager.getRepository(Payment);
        const loansRepository = manager.getRepository(Loan);
        const paymentImagesRepository = manager.getRepository(PaymentImage);

        const savedPayments: Payment[] = [];
        const loanIdsToCascade = new Set<string>();

        // Phase 32 — process in installment_number order (not submission
        // order) so the sequential-payment rule below can't false-positive
        // against an earlier installment that's ALSO part of this same
        // batch: by the time that earlier entry's turn comes up, it's
        // already been marked Paid within this transaction, so the query
        // sees it correctly. Only a lookup pass (installmentNumber only) —
        // the full fetch + status/amount checks below stay per-entry, same
        // as before, so a bad entry still rolls back the whole batch.
        const installmentsForSorting = await installmentsRepository.find({
          where: { id: In(entries.map((entry) => entry.installmentId)) },
          select: { id: true, installmentNumber: true },
        });
        const installmentNumberById = new Map(
          installmentsForSorting.map((installment) => [
            installment.id,
            installment.installmentNumber,
          ]),
        );
        const sortedEntries = [...entries].sort(
          (a, b) =>
            (installmentNumberById.get(a.installmentId) ?? 0) -
            (installmentNumberById.get(b.installmentId) ?? 0),
        );

        const loanInstallmentConceptsRepository = manager.getRepository(
          LoanInstallmentConcept,
        );

        for (const entry of sortedEntries) {
          const installment = await installmentsRepository.findOne({
            where: { id: entry.installmentId },
          });
          if (!installment) {
            throw new NotFoundException(
              `Installment with id ${entry.installmentId} not found`,
            );
          }
          if (installment.status !== InstallmentStatus.Pending) {
            throw new BadRequestException(
              `Installment ${installment.installmentNumber} (id ${installment.id}) is not pending — it cannot be paid again.`,
            );
          }
          await this.assertNoEarlierPendingInstallment(
            installment,
            installmentsRepository,
          );

          const totalPaidBefore = await this.sumPayments(
            entry.installmentId,
            paymentsRepository,
          );
          // Bug fix, 2026-09-07/08 — floor and ceiling are now the SAME
          // figure: the installment's real remaining balance (capital +
          // accrued mora, via resolveRemainingBalance, same formula the
          // register-payment dialog shows). Previously the floor only
          // required covering installment.amount (capital alone) — see
          // registerPayment's identical 2026-09-08 fix for why that let a
          // bulk payment close a cuota while forgiving its mora with no
          // explicit decision to do so. A bulk entry must now match
          // maxPayable exactly: less than that doesn't fully settle the
          // cuota (bulk payments require full settlement, per Phase 28 —
          // use the single-installment flow for a partial payment), more
          // than that exceeds what's actually owed (the #0920 bug).
          const remainingBalance = await this.resolveRemainingBalance(
            installment,
            totalPaidBefore,
            loanInstallmentConceptsRepository,
          );
          const maxPayable = Math.ceil(remainingBalance);
          if (entry.amountPaid < maxPayable) {
            throw new BadRequestException(
              `El monto para la cuota ${installment.installmentNumber} (id ${installment.id}) no cubre su saldo pendiente total, capital más mora ($${maxPayable}) — un pago por lotes debe saldar cada cuota por completo. Usa el flujo de pago individual para un abono parcial.`,
            );
          }
          if (entry.amountPaid > maxPayable) {
            throw new BadRequestException(
              `El monto para la cuota ${installment.installmentNumber} (id ${installment.id}) supera su saldo pendiente ($${maxPayable}).`,
            );
          }

          const payment = paymentsRepository.create({
            installmentId: entry.installmentId,
            amountPaid: entry.amountPaid,
            paidAt: entry.paidAt,
            observation: entry.observation ?? null,
            imageUrl: null,
          });
          const savedPayment = await paymentsRepository.save(payment);
          await this.savePaymentImages(
            savedPayment.id,
            entry.imageUrls,
            paymentImagesRepository,
          );
          savedPayments.push(savedPayment);

          await installmentsRepository.update(
            { id: entry.installmentId },
            { status: InstallmentStatus.Paid },
          );
          loanIdsToCascade.add(installment.loanId);
        }

        for (const loanId of loanIdsToCascade) {
          const paidInFull = await this.cascadeLoanStatusIfFullyPaid(
            loanId,
            installmentsRepository,
            loansRepository,
          );
          if (paidInFull) {
            paidInFullLoanIds.add(loanId);
          }
        }

        return savedPayments;
      },
    );

    // Fired only after the transaction has actually committed — see
    // sendPaymentConfirmationSafely's doc comment. Every entry in a bulk
    // payment always fully settles its installment (enforced above), so
    // every one of them gets a confirmation, not just some.
    for (const payment of savedPayments) {
      await this.sendPaymentConfirmationSafely(payment.installmentId);
    }
    for (const loanId of paidInFullLoanIds) {
      await this.sendPaidInFullSafely(loanId);
    }

    return savedPayments;
  }

  // Human report, 2026-09-09 — admin-only correction for a payment
  // registered by mistake (e.g. the full balance entered when the client
  // had only paid part of it, silently closing a cuota that should have
  // stayed pending). Soft-deletes the payment (see Payment.voidReason's
  // own comment for why this reuses deletedAt rather than a separate
  // voidedAt column) and, if that payment is what had closed its
  // installment, reopens it — recomputed via resolveRemainingBalance with
  // the voided row already excluded (every payment query does that by
  // default) AND the installment's status temporarily treated as Pending
  // for that one call, since enrichInstallment otherwise short-circuits
  // totalDue to 0 for any installment that's still marked Paid at the
  // moment this runs (see resolveRemainingBalance's call site below).
  // Reopening a loan that had cascaded to Paid mirrors
  // cascadeLoanStatusIfFullyPaid in reverse. Wrapped in a transaction —
  // same precedent as registerBulkPayments — so a failure partway never
  // leaves the payment voided but the installment/loan status stale.
  async voidPayment(paymentId: string, dto: VoidPaymentDto): Promise<Payment> {
    return this.dataSource.transaction(async (manager: EntityManager) => {
      const paymentsRepository = manager.getRepository(Payment);
      const installmentsRepository = manager.getRepository(Installment);
      const loanInstallmentConceptsRepository = manager.getRepository(
        LoanInstallmentConcept,
      );

      const payment = await paymentsRepository.findOne({
        where: { id: paymentId },
        withDeleted: true,
        relations: { installment: { loan: true } },
      });
      if (!payment) {
        throw new NotFoundException(`Payment with id ${paymentId} not found`);
      }
      if (payment.deletedAt) {
        throw new BadRequestException('This payment was already voided.');
      }

      // Set together, in one save — not via the repository's own
      // .softDelete() shorthand, which would touch only deletedAt and
      // require a second write for voidReason. Loading the full entity
      // first (rather than a bare update-by-id) is what lets the response
      // — and the audit log entry built from it — carry the installment
      // relation resolveEntityLabel already knows how to read.
      payment.deletedAt = new Date();
      payment.voidReason = dto.reason;
      const savedPayment = await paymentsRepository.save(payment);

      const installment = payment.installment;
      // A Pending installment has nothing to reopen (this just stops
      // counting toward its balance, same as any other query). A
      // Cancelled one (superseded by a refinance) stays Cancelled — its
      // debt moved to the new loan, reopening it here would be wrong.
      if (installment.status === InstallmentStatus.Paid) {
        const totalPaidAfterVoid = await this.sumPayments(
          installment.id,
          paymentsRepository,
        );
        // enrichInstallment short-circuits totalDue to 0 for any
        // non-Pending installment (see its own comment — "a paid
        // installment owes nothing further"), which is exactly what we
        // must NOT get here: the question is what this installment WOULD
        // owe if it were still open, now that the voided payment no longer
        // counts toward it. Passing a Pending copy is what makes
        // resolveRemainingBalance actually run the real overdueDays/mora
        // calculation instead of trivially returning 0 every time.
        const remainingBalance = await this.resolveRemainingBalance(
          { ...installment, status: InstallmentStatus.Pending },
          totalPaidAfterVoid,
          loanInstallmentConceptsRepository,
        );
        if (remainingBalance > 0) {
          await installmentsRepository.update(
            { id: installment.id },
            { status: InstallmentStatus.Pending },
          );
          await manager
            .getRepository(Loan)
            .update(
              { id: installment.loanId, status: LoanStatus.Paid },
              { status: LoanStatus.Active },
            );
        }
      }

      return savedPayment;
    });
  }

  // Phase 32 — shared by registerPayment and registerBulkPayments. Takes
  // the repository as a parameter (rather than always using
  // this.installmentsRepository) so the bulk path can pass the
  // transactional repository and see status updates already made earlier
  // in the same transaction (see the sort-by-installmentNumber comment
  // above registerBulkPayments' loop).
  private async assertNoEarlierPendingInstallment(
    installment: Installment,
    installmentsRepository: Repository<Installment>,
  ): Promise<void> {
    const earlierPending = await installmentsRepository.find({
      where: {
        loanId: installment.loanId,
        installmentNumber: LessThan(installment.installmentNumber),
        status: InstallmentStatus.Pending,
      },
      order: { installmentNumber: 'ASC' },
      take: 1,
    });
    if (earlierPending.length > 0) {
      throw new BadRequestException(
        `Installment ${installment.installmentNumber} cannot be paid — installment ${earlierPending[0].installmentNumber} on the same loan is still pending.`,
      );
    }
  }

  // Bug fix, 2026-09-07 — shared by registerPayment and registerBulkPayments
  // (same parameter-injection reasoning as assertNoEarlierPendingInstallment
  // above): the actual amount still owed on `installment` right now — its
  // live totalDue (nominal amount + accrued moratory interest, same formula
  // GET /loans/:id uses) minus whatever has already been paid on it — which
  // is the hard ceiling a new payment against it can never exceed.
  private async resolveRemainingBalance(
    installment: Installment,
    totalPaid: number,
    loanInstallmentConceptsRepository: Repository<LoanInstallmentConcept>,
  ): Promise<number> {
    const concepts = await loanInstallmentConceptsRepository.find({
      where: { installmentId: installment.id },
    });
    return enrichInstallment(installment, concepts, totalPaid).totalDue;
  }

  private async savePaymentImages(
    paymentId: string,
    imageUrls: string[] | undefined,
    paymentImagesRepository: Repository<PaymentImage>,
  ): Promise<void> {
    if (!imageUrls || imageUrls.length === 0) {
      return;
    }
    const images = imageUrls.map((imageUrl) =>
      paymentImagesRepository.create({ paymentId, imageUrl }),
    );
    await paymentImagesRepository.save(images);
  }

  private async sumPayments(
    installmentId: string,
    paymentsRepository: Repository<Payment>,
  ): Promise<number> {
    const payments = await paymentsRepository.find({
      where: { installmentId },
      select: { amountPaid: true },
    });

    return payments.reduce((sum, payment) => sum + payment.amountPaid, 0);
  }

  // Returns whether this call is what just fully paid off the loan — lets
  // callers fire PaymentConfirmationService.sendPaidInFull exactly once,
  // right when it happens, per docs/phases/PHASE_33_MESSAGE_TEMPLATES_V2.md.
  private async cascadeLoanStatusIfFullyPaid(
    loanId: string,
    installmentsRepository: Repository<Installment>,
    loansRepository: Repository<Loan>,
  ): Promise<boolean> {
    const installments = await installmentsRepository.find({
      where: { loanId },
    });
    const allPaid =
      installments.length > 0 &&
      installments.every(
        (installment) => installment.status === InstallmentStatus.Paid,
      );

    if (!allPaid) {
      return false;
    }

    const result = await loansRepository.update(
      { id: loanId, status: LoanStatus.Active },
      { status: LoanStatus.Paid },
    );
    return (result.affected ?? 0) > 0;
  }

  // Never lets a messaging failure affect the payment that was just
  // registered — same principle as LoansService.sendNewLoanMessageSafely.
  // See docs/phases/PHASE_33_MESSAGE_TEMPLATES_V2.md.
  private async sendPaymentConfirmationSafely(
    installmentId: string,
  ): Promise<void> {
    try {
      await this.paymentConfirmationService.sendPaymentConfirmation(
        installmentId,
      );
    } catch (error) {
      this.logger.error(
        `Failed to send payment confirmation WhatsApp message for installment ${installmentId}`,
        error,
      );
    }
  }

  private async sendPaidInFullSafely(loanId: string): Promise<void> {
    try {
      await this.paymentConfirmationService.sendPaidInFull(loanId);
    } catch (error) {
      this.logger.error(
        `Failed to send paid-in-full WhatsApp message for loan ${loanId}`,
        error,
      );
    }
  }
}
