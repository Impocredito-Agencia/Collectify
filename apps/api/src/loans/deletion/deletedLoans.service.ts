import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository } from 'typeorm';

import { PaginatedResult } from '../../common/interfaces/paginatedResult.interface';
import { Installment } from '../entities/installment.entity';
import {
  InstallmentFrequency,
  Loan,
  LoanStatus,
} from '../entities/loan.entity';
import { Payment } from '../entities/payment.entity';
import { LoansService, PaymentWithImages } from '../loans.service';

import { QueryDeletedLoansDto } from './dto/queryDeletedLoans.dto';
import { DeletedInstallmentSnapshot } from './loanDeletionSnapshot';

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 50;

export interface DeletedLoanSummary {
  id: string;
  promissoryNoteNumber: string;
  clientId: string;
  clientFullName: string;
  principalAmount: number;
  totalInstallments: number;
  // The status it had when deleted (active, or refinanced for an earlier
  // loan deleted along with its chain).
  status: LoanStatus;
  deletedAt: Date;
  // Null for a loan deleted before Phase 35, or whose user was removed.
  deletedByFullName: string | null;
  deletionReason: string | null;
  // Whether it had any payment (they're all voided now) — such a loan
  // keeps its number reserved forever. In the list, true when any loan of
  // its chain had one.
  hadPayments: boolean;
  // The earlier loans of its refinance chain, deleted along with it, newest
  // first. The list shows a chain as this one row (its active head) rather
  // than one row per loan, so it doesn't read as several unrelated debts.
  refinancedLoans: { id: string; promissoryNoteNumber: string }[];
}

export interface DeletedLoanDetail extends DeletedLoanSummary {
  clientDocumentNumber: string | null;
  disbursedAt: string;
  installmentFrequency: InstallmentFrequency;
  description: string | null;
  // Cuotas with the figures frozen at deletion. For a loan deleted before
  // Phase 35 (no snapshot) they're rebuilt from the rows themselves, with
  // no mora — `hasFrozenFigures` tells the panel which one it got.
  installments: DeletedInstallmentSnapshot[];
  hasFrozenFigures: boolean;
  payments: PaymentWithImages[];
  // The other loans of its refinance chain that were deleted too.
  deletedTogether: { id: string; promissoryNoteNumber: string }[];
}

// Phase 35 — the read-only side of deletion: every authenticated user
// (admin or collector) can list and open a deleted pagaré, so nobody needs
// database access to answer "what happened to this pagaré". Nothing here
// writes.
@Injectable()
export class DeletedLoansService {
  constructor(
    @InjectRepository(Loan)
    private readonly loansRepository: Repository<Loan>,
    @InjectRepository(Installment)
    private readonly installmentsRepository: Repository<Installment>,
    @InjectRepository(Payment)
    private readonly paymentsRepository: Repository<Payment>,
    private readonly loansService: LoansService,
  ) {}

  async findAll(
    query: QueryDeletedLoansDto,
  ): Promise<PaginatedResult<DeletedLoanSummary>> {
    const page = query.page ?? DEFAULT_PAGE;
    const limit = query.limit ?? DEFAULT_PAGE_SIZE;

    const deleted = await this.loansRepository.find({
      where: {
        deletedAt: Not(IsNull()),
        ...(query.clientId ? { clientId: query.clientId } : {}),
      },
      relations: { client: true, deletedByUser: true },
      withDeleted: true,
      order: { deletedAt: 'DESC' },
    });

    const chains = groupIntoChains(deleted);

    const search = query.search?.trim().toLowerCase();
    const matching = search
      ? chains.filter(({ head, earlier }) =>
          [head, ...earlier].some(
            (loan) =>
              loan.promissoryNoteNumber.toLowerCase().includes(search) ||
              clientFullName(loan).toLowerCase().includes(search),
          ),
        )
      : chains;

    const pageChains = matching.slice((page - 1) * limit, page * limit);
    const loanIdsWithPayments = await this.findLoanIdsWithPayments(
      pageChains.flatMap(({ head, earlier }) =>
        [head, ...earlier].map((loan) => loan.id),
      ),
    );

    return {
      items: pageChains.map(({ head, earlier }) => ({
        ...toSummary(
          head,
          [head, ...earlier].some((loan) => loanIdsWithPayments.has(loan.id)),
        ),
        refinancedLoans: earlier.map(toChainLink),
      })),
      meta: {
        page,
        limit,
        total: matching.length,
        totalPages: Math.ceil(matching.length / limit),
      },
    };
  }

  async findOne(id: string): Promise<DeletedLoanDetail> {
    const loan = await this.loansRepository.findOne({
      where: { id, deletedAt: Not(IsNull()) },
      relations: { client: true, deletedByUser: true },
      withDeleted: true,
    });
    if (!loan) {
      throw new NotFoundException(`Deleted loan with id ${id} not found`);
    }

    const payments = await this.loansService.getDeletedLoanPayments(id);
    const installments = loan.deletionSnapshot
      ? loan.deletionSnapshot.installments
      : await this.rebuildInstallments(id);

    const deletedTogether = await this.findDeletedChain(loan);

    return {
      ...toSummary(loan, payments.length > 0),
      // Only the loans before this one: on an earlier loan of the chain the
      // later ones show up in `deletedTogether` instead.
      refinancedLoans: deletedTogether
        .filter((chainLoan) => chainLoan.isEarlier)
        .map(toChainLink),
      clientDocumentNumber: loan.client?.documentNumber ?? null,
      disbursedAt: loan.disbursedAt,
      installmentFrequency: loan.installmentFrequency,
      description: loan.description,
      installments,
      hasFrozenFigures: loan.deletionSnapshot !== null,
      payments,
      deletedTogether: deletedTogether.map(toChainLink),
    };
  }

  private async findLoanIdsWithPayments(
    loanIds: string[],
  ): Promise<Set<string>> {
    if (loanIds.length === 0) {
      return new Set();
    }
    const installments = await this.installmentsRepository.find({
      where: { loanId: In(loanIds) },
      select: { id: true, loanId: true },
      withDeleted: true,
    });
    if (installments.length === 0) {
      return new Set();
    }
    const payments = await this.paymentsRepository.find({
      where: {
        installmentId: In(installments.map((installment) => installment.id)),
      },
      select: { installmentId: true },
      withDeleted: true,
    });
    const paidInstallmentIds = new Set(
      payments.map((payment) => payment.installmentId),
    );
    return new Set(
      installments
        .filter((installment) => paidInstallmentIds.has(installment.id))
        .map((installment) => installment.loanId),
    );
  }

  // A loan deleted before Phase 35 has no snapshot: its rows are shown as
  // they are, with no mora (it was never frozen, and recalculating it today
  // would make it keep growing).
  private async rebuildInstallments(
    loanId: string,
  ): Promise<DeletedInstallmentSnapshot[]> {
    const installments = await this.installmentsRepository.find({
      where: { loanId },
      order: { installmentNumber: 'ASC' },
      withDeleted: true,
    });
    return installments.map((installment) => ({
      installmentNumber: installment.installmentNumber,
      isDownPayment: installment.isDownPayment,
      dueDate: installment.dueDate,
      amount: installment.amount,
      principalPortion: installment.principalPortion,
      status: installment.status,
      overdueDays: 0,
      interest: 0,
      totalPaid: 0,
      totalDue: 0,
      conceptBreakdown: [],
    }));
  }

  // Walks the refinance links both ways and keeps the loans that were
  // deleted too — a chain is only ever deleted whole, from its active head.
  private async findDeletedChain(
    loan: Loan,
  ): Promise<
    { id: string; promissoryNoteNumber: string; isEarlier: boolean }[]
  > {
    const related: { loan: Loan; isEarlier: boolean }[] = [];
    const seen = new Set([loan.id]);

    let previousId = loan.refinancedFromLoanId;
    while (previousId && !seen.has(previousId)) {
      const previous = await this.loansRepository.findOne({
        where: { id: previousId },
        withDeleted: true,
      });
      if (!previous) {
        break;
      }
      seen.add(previous.id);
      related.push({ loan: previous, isEarlier: true });
      previousId = previous.refinancedFromLoanId;
    }

    let currentId = loan.id;
    for (;;) {
      const next = await this.loansRepository.findOne({
        where: { refinancedFromLoanId: currentId },
        withDeleted: true,
      });
      if (!next || seen.has(next.id)) {
        break;
      }
      seen.add(next.id);
      related.push({ loan: next, isEarlier: false });
      currentId = next.id;
    }

    return related
      .filter(({ loan: chainLoan }) => chainLoan.deletedAt !== null)
      .map(({ loan: chainLoan, isEarlier }) => ({
        ...toChainLink(chainLoan),
        isEarlier,
      }));
  }
}

interface DeletedChain {
  head: Loan;
  // Newest first.
  earlier: Loan[];
}

// A chain is only ever deleted whole, from its active head, so every
// deleted loan that another deleted loan was refinanced from belongs to
// that loan's chain. Keeps `deleted`'s order (newest deletion first).
function groupIntoChains(deleted: Loan[]): DeletedChain[] {
  const byId = new Map(deleted.map((loan) => [loan.id, loan]));
  const refinancedIntoAnother = new Set(
    deleted
      .map((loan) => loan.refinancedFromLoanId)
      .filter((id): id is string => id !== null && byId.has(id)),
  );

  return deleted
    .filter((loan) => !refinancedIntoAnother.has(loan.id))
    .map((head) => {
      const earlier: Loan[] = [];
      const seen = new Set([head.id]);
      let previous = head.refinancedFromLoanId
        ? byId.get(head.refinancedFromLoanId)
        : undefined;
      while (previous && !seen.has(previous.id)) {
        seen.add(previous.id);
        earlier.push(previous);
        previous = previous.refinancedFromLoanId
          ? byId.get(previous.refinancedFromLoanId)
          : undefined;
      }
      return { head, earlier };
    });
}

function toChainLink(loan: { id: string; promissoryNoteNumber: string }): {
  id: string;
  promissoryNoteNumber: string;
} {
  return { id: loan.id, promissoryNoteNumber: loan.promissoryNoteNumber };
}

function clientFullName(loan: Loan): string {
  return loan.client ? `${loan.client.firstName} ${loan.client.lastName}` : '';
}

function toSummary(
  loan: Loan,
  hadPayments: boolean,
): Omit<DeletedLoanSummary, 'refinancedLoans'> {
  return {
    id: loan.id,
    promissoryNoteNumber: loan.promissoryNoteNumber,
    clientId: loan.clientId,
    clientFullName: clientFullName(loan),
    principalAmount: loan.principalAmount,
    totalInstallments: loan.totalInstallments,
    status: loan.status,
    // Always set: every query here filters on deletedAt IS NOT NULL.
    deletedAt: loan.deletedAt as Date,
    deletedByFullName: loan.deletedByUser?.fullName ?? null,
    deletionReason: loan.deletionReason,
    hadPayments,
  };
}
