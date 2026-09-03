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
import {
  enrichInstallment,
  InstallmentWithCalculated,
} from './enrichInstallment';

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

    const [items, total] = await this.installmentsRepository.findAndCount({
      where,
      relations: { loan: true },
      order: { dueDate: 'ASC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    const conceptsByInstallmentId = await this.findConceptsByInstallmentId(
      items.map((installment) => installment.id),
    );

    return {
      items: items.map((installment) =>
        enrichInstallment(
          installment,
          installment.loan.interestRate,
          conceptsByInstallmentId.get(installment.id) ?? [],
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
    const installment = await this.installmentsRepository.findOneBy({
      id: installmentId,
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
    // already-Paid/Cancelled installment accepting an extra payment record
    // (see the no-op branch below) isn't "skipping ahead" of anything.
    if (installment.status === InstallmentStatus.Pending) {
      await this.assertNoEarlierPendingInstallment(
        installment,
        this.installmentsRepository,
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
      const totalPaid = await this.sumPayments(
        installmentId,
        this.paymentsRepository,
      );
      if (totalPaid >= installment.amount) {
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

        for (const entry of sortedEntries) {
          const installment = await installmentsRepository.findOneBy({
            id: entry.installmentId,
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
          const totalPaidAfter = totalPaidBefore + entry.amountPaid;
          if (totalPaidAfter < installment.amount) {
            throw new BadRequestException(
              `The amount for installment ${installment.installmentNumber} (id ${installment.id}) does not cover its remaining balance — a bulk payment must fully settle every selected installment. Use the single-installment flow for a partial payment.`,
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
