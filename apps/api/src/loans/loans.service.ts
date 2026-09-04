import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  EntityManager,
  FindOptionsWhere,
  ILike,
  In,
  Repository,
} from 'typeorm';

import { ClientsService } from '../clients/clients.service';
import { PaginatedResult } from '../common/interfaces/paginatedResult.interface';
import {
  ConceptCalculationType,
  ConceptCategory,
} from '../interestConceptTypes/entities/interestConceptType.entity';
import { InterestConceptTypesService } from '../interestConceptTypes/interestConceptTypes.service';
import {
  CurrentUsuryRate,
  UsuryRateService,
} from '../usuryRates/usuryRates.service';
import { MessageLogStatus } from '../whatsapp/entities/messageLog.entity';
import { NewLoanReminderService } from '../whatsapp/newLoanReminder.service';

import {
  ConceptAssignment,
  generateAmortizationSchedule,
} from './amortization/generateSchedule';
import { CreateLoanDto } from './dto/createLoan.dto';
import { LoanConceptAssignmentDto } from './dto/loanConceptAssignment.dto';
import { UpdateLoanDto } from './dto/updateLoan.dto';
import { PreviewScheduleDto } from './dto/previewSchedule.dto';
import { QueryLoansDto } from './dto/queryLoans.dto';
import { RefinanceLoanDto } from './dto/refinanceLoan.dto';
import { addMonthsToDateString, addWeeksToDateString } from './dueDateSchedule';
import { Installment, InstallmentStatus } from './entities/installment.entity';
import { InstallmentFrequency, Loan, LoanStatus } from './entities/loan.entity';
import { LoanInstallmentConcept } from './entities/loanInstallmentConcept.entity';
import { Payment } from './entities/payment.entity';
import { PaymentImage } from './entities/paymentImage.entity';
import {
  enrichInstallment,
  InstallmentWithCalculated,
} from './installments/enrichInstallment';
import {
  calculatePayoff,
  PayoffInstallmentInput,
  PayoffQuote,
} from './payoff/calculatePayoff';

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;
const POSTGRES_UNIQUE_VIOLATION = '23505';
// Phase 25 (confirmed with the human, reunión 2026-08-25) — see
// getRefinanceQuote()'s own comment for the full explanation. Not the same
// "5" as MessageTemplate's upcomingDueReminderDays (Phase 9); kept as its
// own named constant specifically so the two are never accidentally
// conflated or refactored into sharing a value.
const REFINANCE_EARLY_MATURITY_WINDOW_DAYS = 5;

export interface PreviewedInstallment {
  installmentNumber: number;
  dueDate: string;
  principalPortion: number;
  amount: number;
  conceptBreakdown: {
    name: string;
    amount: number;
    category: ConceptCategory;
  }[];
}

export interface SchedulePreview {
  installments: PreviewedInstallment[];
}

// See docs/phases/PHASE_17_REFINANCING_RECALC.md "Resolved" — advisory
// data for pre-filling RefinanceLoanForm.tsx, not a new persisted concept.
export interface RefinanceQuote {
  payoff: PayoffQuote;
  suggestedPrincipalAmount: number;
  concepts: LoanConceptAssignmentDto[];
  // Phase 23 — same carry-over as concepts above, filtered to the loan's
  // assigned moratory concepts instead of corriente ones.
  moratoryConcepts: LoanConceptAssignmentDto[];
}

export interface LoanDetail extends Loan {
  installments: InstallmentWithCalculated[];
  // Computed reverse lookup, not a stored column — the loan this one was
  // later refinanced into, if any. See docs/phases/PHASE_6_REFINANCING.md.
  refinancedToLoanId: string | null;
  // Phase 31 — "saldo capital a la fecha". Pure remaining principal, with
  // NO interest folded in — deliberately `totalPrincipalOwed`, not
  // `totalDue`/`suggestedPrincipalAmount` (confirmed with the human,
  // 2026-08-31): those include accrued interest, which would misstate this
  // as owing more than the actual capital left. Reuses getPayoffQuote()
  // rather than a second implementation, per docs/phases/PHASE_17_REFINANCING_RECALC.md's
  // own precedent of never duplicating this math. `totalPrincipalOwed` is
  // unaffected by the refinance-only earlyMaturityWindowDays option (see
  // calculatePayoff.ts — principalApplied never depends on it), so the
  // plain getPayoffQuote() call here always agrees with what a refinance
  // quote would show for the same figure.
  currentPrincipalBalance: number;
}

// Phase 28 — getPayments()'s return shape: imageUrl replaced with
// imageUrls, sourced from payment_images (falling back to the deprecated
// imageUrl column for a pre-migration row, see Payment entity).
export interface PaymentWithImages extends Omit<Payment, 'imageUrl'> {
  imageUrls: string[];
}

// Added for the client's standalone "Préstamos" list screen (F-16/17),
// which is a different view from Clientes and needs to show who the loan
// belongs to plus at-a-glance collection status without opening the loan.
// None of these three fields were previously computed by findAll — see the
// aggregation added there.
// Omit<Loan, 'client'>, not Loan itself: the Loan entity's `client` field is
// a required ManyToOne relation, but summarize() below intentionally strips
// the raw relation out of the response and exposes clientFullName instead —
// keeping `extends Loan` here would make TS demand a `client: Client` on
// every returned row, which is exactly what we don't want to send back.
export interface LoanSummary extends Omit<Loan, 'client'> {
  clientFullName: string;
  // Sum of totalDue (amount + accrued interest) across this loan's
  // still-pending installments — same per-installment math as
  // enrichInstallment, just aggregated across the whole loan.
  outstandingBalance: number;
  // How many of this loan's installments are already paid, for a "3/12"
  // style display alongside totalInstallments.
  installmentsPaid: number;
  // The worst (maximum) overdueDays across this loan's pending
  // installments — 0 if none are overdue. A loan-level "días de mora" has
  // no single correct definition since overdue is tracked per installment
  // (docs/DATABASE.md); "how late is the most overdue cuota" is the one
  // that matches how collections actually prioritize follow-up.
  overdueDays: number;
  // The due date of the oldest still-pending installment — whether it's
  // already overdue or not. Deliberately a single field rather than
  // separate "last overdue" / "next upcoming" dates: a loan can have both
  // overdue AND not-yet-due installments pending at once (payments aren't
  // required in order — see InstallmentsService.registerPayment), so "the
  // next one to collect" is always the oldest pending one, whichever kind
  // it is. Pair with `overdueDays` to know which case you're looking at.
  // Null when there are no pending installments left (fully paid/cancelled).
  nextInstallmentDueDate: string | null;
  // Sum of totalDue (amount + accrued interest) across ONLY the installments
  // that are actually overdue (overdueDays > 0) — unlike `outstandingBalance`,
  // which includes every still-pending installment whether overdue or not.
  // Added for ClientDetailPage's "En mora" stat card: the client caught that
  // using outstandingBalance there showed the loan's whole remaining balance
  // instead of just what's actually late, e.g. a loan with 8 pending
  // installments and only 1 overdue was showing the sum of all 8. 0 when
  // nothing's overdue.
  overdueBalance: number;
}

interface PersistLoanParams {
  clientId: string;
  promissoryNoteNumber: string;
  principalAmount: number;
  interestRate: number;
  disbursedAt: string;
  installmentFrequency: InstallmentFrequency;
  totalInstallments: number;
  concepts: LoanConceptAssignmentDto[];
  // Phase 23 — must all reference concept types with category "moratorio";
  // never baked into the generated schedule, see resolveMoratoryConcepts.
  moratoryConcepts: LoanConceptAssignmentDto[];
  // Redesign, 2026-09-03 — the loan's own corriente/moratorio interest,
  // system-generated rather than a catalog pick (see
  // resolveConceptsWithInterest). Omitted means "use the current usury
  // ceiling"; never allowed above it either way.
  corrienteInterestRate?: number;
  moratoryInterestRate?: number;
  // Redesign, 2026-09-03 — the down payment ("cuota inicial") the client
  // negotiated up front is now a real, collectible installment: it's
  // stored as installmentNumber 1 with zero ordinary interest, due on its
  // own admin-chosen date (independent of the periodic schedule that
  // governs installment 2 onward), with mora still applying if it's
  // missed. Must be provided together or omitted together — validated in
  // assertDownPaymentIsValid. Replaces the old purely-informational
  // Loan.initialPayment (see docs/phases/PHASE_13_INITIAL_INSTALLMENT.md
  // for that superseded model).
  downPaymentAmount?: number;
  downPaymentDueDate?: string;
  description?: string | null;
  refinancedFromLoanId?: string | null;
  // Phase 26 — an existing Client's id, not a snapshot of their details;
  // see the Loan entity's coDebtorClientId comment. Must differ from
  // `clientId` above — validated in persistLoanWithInstallments.
  coDebtorClientId?: string | null;
  coDebtorRelationship?: string | null;
}

@Injectable()
export class LoansService {
  private readonly logger = new Logger(LoansService.name);

  constructor(
    @InjectRepository(Loan)
    private readonly loansRepository: Repository<Loan>,
    @InjectRepository(Installment)
    private readonly installmentsRepository: Repository<Installment>,
    @InjectRepository(Payment)
    private readonly paymentsRepository: Repository<Payment>,
    @InjectRepository(PaymentImage)
    private readonly paymentImagesRepository: Repository<PaymentImage>,
    @InjectRepository(LoanInstallmentConcept)
    private readonly loanInstallmentConceptsRepository: Repository<LoanInstallmentConcept>,
    private readonly interestConceptTypesService: InterestConceptTypesService,
    private readonly usuryRateService: UsuryRateService,
    private readonly newLoanReminderService: NewLoanReminderService,
    private readonly clientsService: ClientsService,
    private readonly dataSource: DataSource,
  ) {}

  // skipCreditCheck: false by default (the interactive "Crear préstamo"
  // flow, via LoansController). ClientLoanImportService is the one caller
  // that sets it true, for its "modo histórico" — bulk-loading a past
  // loan book shouldn't be blocked by a mora/cupo state that no longer
  // reflects reality (the loan already happened). "Modo normal" import
  // leaves this false, so it's rejected exactly like a manually-created
  // loan would be. Mirrors ClientsService.create's CreateClientOptions
  // pattern. Note this only ever touches the mora/cupo guard below — the
  // promissory-note-uniqueness and usury-rate checks always run regardless
  // of mode: both are hard blocks, per Phase 24
  // (docs/phases/PHASE_24_USURY_MANDATORY.md).
  async create(
    dto: CreateLoanDto,
    options: { skipCreditCheck?: boolean } = {},
  ): Promise<LoanDetail> {
    if (!options.skipCreditCheck) {
      await this.assertClientCanTakeNewLoan(dto.clientId, dto.principalAmount);
    }

    // Transactional — persistLoanWithInstallments is three sequential
    // saves (loan, then installments, then concept rows); without this, a
    // failure partway (e.g. a concept type deleted mid-request) would
    // leave an orphaned loan with no installments. See the same fix in
    // refinance(), which found this the hard way.
    const savedLoan = await this.dataSource.transaction((manager) =>
      this.persistLoanWithInstallments(
        {
          clientId: dto.clientId,
          promissoryNoteNumber: dto.promissoryNoteNumber,
          principalAmount: dto.principalAmount,
          interestRate: dto.interestRate,
          disbursedAt: dto.disbursedAt,
          installmentFrequency: dto.installmentFrequency,
          totalInstallments: dto.totalInstallments,
          concepts: dto.concepts,
          moratoryConcepts: dto.moratoryConcepts ?? [],
          corrienteInterestRate: dto.corrienteInterestRate,
          moratoryInterestRate: dto.moratoryInterestRate,
          downPaymentAmount: dto.downPaymentAmount,
          downPaymentDueDate: dto.downPaymentDueDate,
          description: dto.description,
          coDebtorClientId: dto.coDebtorClientId,
          coDebtorRelationship: dto.coDebtorRelationship,
        },
        manager,
      ),
    );

    await this.sendNewLoanMessageSafely(savedLoan.id);

    return this.findOne(savedLoan.id);
  }

  // Runs the same schedule generation as create()/refinance() without
  // persisting anything — lets the client show the admin what a loan's
  // installments will look like before they commit. See
  // docs/phasesClient/PHASE_14_INTEREST_CONCEPTS.md.
  async previewSchedule(dto: PreviewScheduleDto): Promise<SchedulePreview> {
    // Phase 24 — hard block here too, not just on create()/refinance(), so
    // what the admin previews always matches what a real submit would
    // persist (see docs/phases/PHASE_24_USURY_MANDATORY.md). The block
    // itself now happens inside resolveConceptsWithInterest, via
    // getCurrentUsuryRateOrThrow().
    const { concepts, moratoryConcepts } =
      await this.resolveConceptsWithInterest(
        dto.concepts,
        dto.moratoryConcepts ?? [],
        dto.corrienteInterestRate,
        dto.moratoryInterestRate,
      );
    const schedule = generateAmortizationSchedule(
      dto.principalAmount,
      dto.totalInstallments,
      concepts,
    );

    const installments = schedule.map((generated) => ({
      installmentNumber: generated.installmentNumber,
      dueDate: this.calculateDueDate(
        dto.disbursedAt,
        dto.installmentFrequency,
        generated.installmentNumber,
      ),
      principalPortion: generated.principalPortion,
      amount: generated.amount,
      // Moratory concepts always preview at amount 0 — nothing is overdue
      // in a hypothetical schedule. Shown purely so the admin can see which
      // ones they picked before committing. See docs/phases/PHASE_23_DYNAMIC_CHARGES.md.
      conceptBreakdown: [
        ...generated.concepts.map((concept) => ({
          name: concept.name,
          amount: concept.computedAmount,
          category: ConceptCategory.Corriente,
        })),
        ...moratoryConcepts.map((concept) => ({
          name: concept.name,
          amount: 0,
          category: ConceptCategory.Moratorio,
        })),
      ],
    }));

    return { installments };
  }

  // Closes out the old loan, cancels whatever installments it still had
  // pending (excluded from active collection but kept as historical
  // record — the confirmed behavior, see docs/DATABASE.md "Refinancing"),
  // and opens a new loan in its place linked via refinancedFromLoanId.
  async refinance(id: string, dto: RefinanceLoanDto): Promise<LoanDetail> {
    const oldLoan = await this.findLoanOrThrow(id);
    if (oldLoan.status !== LoanStatus.Active) {
      throw new BadRequestException(
        `Loan ${id} cannot be refinanced because its status is '${oldLoan.status}' — only active loans can be refinanced`,
      );
    }

    // Phase 25 (confirmed with the human, reunión 2026-08-25): refinancing
    // with overdue installments is no longer rejected — the client no
    // longer has to be "current" first. The old block lived here; removed
    // entirely rather than left as a dead-code no-op, per the phase doc's
    // explicit "the block is removed entirely." What used to be rejected is
    // now handled by folding the overdue (and near-due, see
    // getRefinanceQuote's earlyMaturityWindowDays) installments' accrued
    // interest into the new principal instead — see getRefinanceQuote()
    // below. refinance() itself still just accepts whatever
    // principalAmount/concepts the admin actually submits, unchanged.

    // Transactional — closing out the old loan, cancelling its pending
    // installments, and creating the new one must all succeed or all roll
    // back. Previously these were three separate non-transactional steps:
    // if persistLoanWithInstallments failed partway (e.g. a duplicate
    // promissory note number), the old loan was left stuck as
    // 'refinanced' with its installments cancelled and no replacement
    // loan — a real incident found during manual QA (2026-08-18).
    const newLoan = await this.dataSource.transaction(async (manager) => {
      oldLoan.status = LoanStatus.Refinanced;
      await manager.getRepository(Loan).save(oldLoan);

      await manager
        .getRepository(Installment)
        .update(
          { loanId: id, status: InstallmentStatus.Pending },
          { status: InstallmentStatus.Cancelled },
        );

      return this.persistLoanWithInstallments(
        {
          clientId: oldLoan.clientId,
          promissoryNoteNumber: dto.promissoryNoteNumber,
          principalAmount: dto.principalAmount,
          interestRate: dto.interestRate,
          disbursedAt: dto.disbursedAt,
          installmentFrequency: dto.installmentFrequency,
          totalInstallments: dto.totalInstallments,
          concepts: dto.concepts,
          moratoryConcepts: dto.moratoryConcepts ?? [],
          corrienteInterestRate: dto.corrienteInterestRate,
          moratoryInterestRate: dto.moratoryInterestRate,
          downPaymentAmount: dto.downPaymentAmount,
          downPaymentDueDate: dto.downPaymentDueDate,
          description: dto.description,
          refinancedFromLoanId: id,
          // Carries over the old loan's co-debtor unchanged unless the dto
          // explicitly overrides a field — confirmed default behavior, see
          // RefinanceLoanDto and docs/phases/PHASE_26_CODEBTOR_CLIENT.md.
          // Distinguishes omitted (undefined — carry over) from explicit
          // null (deliberately clearing the co-debtor on this refinance) —
          // `??` alone can't tell those apart, since it treats both as
          // "fall back". QoL fix (2026-08-30): previously unchecking "tiene
          // codeudor" in the frontend silently had no effect, since the
          // field was simply omitted either way.
          coDebtorClientId:
            dto.coDebtorClientId === undefined
              ? oldLoan.coDebtorClientId
              : dto.coDebtorClientId,
          coDebtorRelationship:
            dto.coDebtorRelationship === undefined
              ? oldLoan.coDebtorRelationship
              : dto.coDebtorRelationship,
        },
        manager,
      );
    });

    await this.sendNewLoanMessageSafely(newLoan.id);

    return this.findOne(newLoan.id);
  }

  // Style cleanup (2026-09-03) — suggests the next pagaré number for
  // LoanForm/RefinanceLoanForm to pre-fill (still editable; the client
  // wants #0000-style padding going forward, not a hard lock — see
  // docs/GLOSSARY.md "Loan / Pagaré"). Takes the highest numeric part
  // across ALL loans, including soft-deleted ones (withDeleted, same as
  // assertPromissoryNoteNumberIsUnique below — a deleted loan's number is
  // still "used" and must never be handed out again), adds 1, and pads to
  // 4 digits. Deliberately ignores the ~1190 pre-existing loans' actual
  // formatting (some are "1", "124", "#743"...) — only the numeric value
  // matters here, via the same extractNumericPart used for the list sort.
  // Historical rows are NOT being reformatted (confirmed with the human);
  // this only shapes what gets suggested for new loans from today on.
  async getNextPromissoryNoteNumber(): Promise<{
    nextPromissoryNoteNumber: string;
  }> {
    const loans = await this.loansRepository.find({
      select: { promissoryNoteNumber: true },
      withDeleted: true,
    });

    const highest = loans.reduce<bigint>((max, loan) => {
      const numeric = extractNumericPart(loan.promissoryNoteNumber);
      return numeric !== null && numeric > max ? numeric : max;
    }, 0n);

    const next = (highest + 1n).toString().padStart(4, '0');
    return { nextPromissoryNoteNumber: `#${next}` };
  }

  // Joins `client` (for clientFullName) and, in a second query, this page's
  // installments (for outstandingBalance/installmentsPaid/overdueDays) —
  // two extra queries total, not one per loan, to back the standalone
  // "Préstamos" list (F-16/17), a different screen from Clientes that
  // needs to show whose loan it is and its collection status at a glance.
  //
  // Matches how the client already files physical pagarés — by
  // promissoryNoteNumber, ascending — instead of most-recently-created
  // first. Changed at the client's request; see
  // apps/client/docs/DESIGN_TOKENS.md "Known design/backend gaps".
  //
  // promissoryNoteNumber is a free-text column (it allows things like
  // "#743"), so a plain text sort compares it character by character, not
  // as a number — "101" sorts before "2" because '1' < '2' as characters.
  // Sorted by its numeric part instead (missing/non-numeric values last,
  // then a text sort as a stable tiebreaker) — done in application code
  // (fetch every match unpaginated, sort, then slice the page) rather than
  // a computed DB expression, same tradeoff as ClientsService.findAll's
  // name sort and fine at this business's scale.
  async findAll(query: QueryLoansDto): Promise<PaginatedResult<LoanSummary>> {
    const page = query.page ?? DEFAULT_PAGE;
    const limit = query.limit ?? DEFAULT_PAGE_SIZE;

    const matches = await this.loansRepository.find({
      where: this.buildFindAllWhere(query),
      relations: { client: true },
    });
    // TypeORM silently drops soft-deleted relations, so a loan whose client
    // was removed comes back with `client: null` despite the non-null type —
    // hide those rather than crash summarize() on a null client.
    const visible = matches.filter((loan) => loan.client !== null);
    const sorted = visible.sort(compareLoansByPromissoryNoteNumber);

    const total = sorted.length;
    const start = (page - 1) * limit;
    const loans = sorted.slice(start, start + limit);
    const items = await this.summarize(loans);

    return {
      items,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  private buildFindAllWhere(
    query: QueryLoansDto,
  ): FindOptionsWhere<Loan> | FindOptionsWhere<Loan>[] {
    const base: FindOptionsWhere<Loan> = {};
    if (query.clientId) {
      base.clientId = query.clientId;
    }
    if (query.status) {
      base.status = query.status;
    }

    if (!query.search) {
      return base;
    }

    const search = ILike(`%${query.search}%`);
    return [
      { ...base, client: { firstName: search } },
      { ...base, client: { lastName: search } },
      { ...base, promissoryNoteNumber: search },
    ];
  }

  private async summarize(loans: Loan[]): Promise<LoanSummary[]> {
    const loanIds = loans.map((loan) => loan.id);
    const installments = loanIds.length
      ? await this.installmentsRepository.find({
          where: { loanId: In(loanIds) },
        })
      : [];
    // Needed so a loan with moratory concepts assigned (Phase 23) reports
    // the same outstandingBalance/overdueBalance here as its detail view —
    // omitting this would silently fall back to the legacy interestRate
    // formula for the list screen only, disagreeing with GET /loans/:id.
    const conceptsByInstallmentId = await this.findConceptsByInstallmentId(
      installments.map((installment) => installment.id),
    );

    return loans.map((loan) => {
      const { client, ...loanFields } = loan;
      const enriched = installments
        .filter((installment) => installment.loanId === loan.id)
        .map((installment) =>
          enrichInstallment(
            installment,
            loan.interestRate,
            conceptsByInstallmentId.get(installment.id) ?? [],
          ),
        );

      return {
        ...loanFields,
        clientFullName: `${client.firstName} ${client.lastName}`,
        outstandingBalance: enriched
          .filter(
            (installment) => installment.status === InstallmentStatus.Pending,
          )
          .reduce((sum, installment) => sum + installment.totalDue, 0),
        installmentsPaid: enriched.filter(
          (installment) => installment.status === InstallmentStatus.Paid,
        ).length,
        overdueDays: enriched.reduce(
          (max, installment) => Math.max(max, installment.overdueDays),
          0,
        ),
        nextInstallmentDueDate: enriched
          .filter(
            (installment) => installment.status === InstallmentStatus.Pending,
          )
          .reduce<string | null>(
            (earliest, installment) =>
              !earliest || installment.dueDate < earliest
                ? installment.dueDate
                : earliest,
            null,
          ),
        overdueBalance: enriched
          .filter(
            (installment) =>
              installment.status === InstallmentStatus.Pending &&
              installment.overdueDays > 0,
          )
          .reduce((sum, installment) => sum + installment.totalDue, 0),
      };
    });
  }

  async findOne(id: string): Promise<LoanDetail> {
    const loan = await this.findLoanOrThrow(id);

    const installments = await this.installmentsRepository.find({
      where: { loanId: id },
      order: { installmentNumber: 'ASC' },
    });
    const conceptsByInstallmentId = await this.findConceptsByInstallmentId(
      installments.map((installment) => installment.id),
    );

    const refinancedTo = await this.loansRepository.findOne({
      where: { refinancedFromLoanId: id },
    });

    // Phase 26 — resolved via the relation, not a snapshot: findOneBy above
    // doesn't eager-load it, so it's fetched explicitly here, same pattern
    // as refinancedTo just above. withDeleted (findByIdIncludingDeleted)
    // so a loan whose co-debtor was later deactivated still renders
    // instead of breaking this endpoint.
    const coDebtorClient = loan.coDebtorClientId
      ? await this.clientsService.findByIdIncludingDeleted(
          loan.coDebtorClientId,
        )
      : null;

    // Phase 31 — see LoanDetail.currentPrincipalBalance's own comment for
    // why this is totalPrincipalOwed specifically. Computed inline from
    // `installments`/`conceptsByInstallmentId` already fetched above
    // (filtered to pending / moratorio respectively) rather than calling
    // getPayoffQuote(id) again, which would re-fetch the loan and its
    // concepts a second time for no reason — same calculatePayoff() engine
    // either way, just without the redundant round-trips.
    const pendingInstallments = installments.filter(
      (installment) => installment.status === InstallmentStatus.Pending,
    );
    const currentPrincipalBalance = calculatePayoff(
      pendingInstallments.map((installment) =>
        toPayoffInstallmentInput(
          installment,
          (conceptsByInstallmentId.get(installment.id) ?? []).filter(
            (concept) => concept.category === ConceptCategory.Moratorio,
          ),
        ),
      ),
      loan.interestRate,
    ).totalPrincipalOwed;

    return {
      ...loan,
      coDebtorClient,
      installments: installments.map((installment) =>
        enrichInstallment(
          installment,
          loan.interestRate,
          conceptsByInstallmentId.get(installment.id) ?? [],
        ),
      ),
      refinancedToLoanId: refinancedTo?.id ?? null,
      currentPrincipalBalance,
    };
  }

  // Groups a batch of installments' LoanInstallmentConcept rows by
  // installmentId in one query, for GET /loans/:id's per-installment
  // conceptBreakdown (docs/phases/PHASE_14_INTEREST_CONCEPTS.md).
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

  // Same grouping as findConceptsByInstallmentId, filtered to moratorio
  // rows only — used by the payoff/payoff-quote/refinance-quote call sites
  // below, which need calculatePayoff() to use the Phase 23 engine when a
  // loan has moratory concepts assigned, kept consistent with
  // enrichInstallment.ts's identical filtering.
  private async findMoratoryConceptsByInstallmentId(
    installmentIds: string[],
  ): Promise<Map<string, LoanInstallmentConcept[]>> {
    const byInstallmentId =
      await this.findConceptsByInstallmentId(installmentIds);
    const map = new Map<string, LoanInstallmentConcept[]>();
    for (const [installmentId, concepts] of byInstallmentId) {
      const moratory = concepts.filter(
        (concept) => concept.category === ConceptCategory.Moratorio,
      );
      if (moratory.length > 0) {
        map.set(installmentId, moratory);
      }
    }
    return map;
  }

  async update(id: string, dto: UpdateLoanDto): Promise<Loan> {
    const loan = await this.findLoanOrThrow(id);
    if (dto.coDebtorClientId !== undefined) {
      await this.assertCoDebtorIsValid(loan.clientId, dto.coDebtorClientId);
    }
    Object.assign(loan, dto);
    return this.loansRepository.save(loan);
  }

  // Phase 30 — lets an admin remove a loan created by mistake, but only
  // before it has any real financial history: once a single Payment
  // exists anywhere on the loan (any installment), deletion is refused —
  // confirmed with the human ("eliminar si no tiene pago registrado").
  // Soft, per this project's standard convention (no hard delete
  // anywhere in docs/DATABASE.md); cascades to the loan's own
  // installments explicitly, since TypeORM's softDelete() only stamps
  // the target table's own deleted_at — it does not cascade to relations
  // the way a real FK ON DELETE CASCADE would (same point docs/DATABASE.md
  // makes for client_references, deliberately choosing NOT to cascade
  // there; this case chooses to, per the phase brief).
  async remove(id: string): Promise<void> {
    await this.findLoanOrThrow(id);

    const installments = await this.installmentsRepository.find({
      where: { loanId: id },
      select: { id: true },
    });
    const installmentIds = installments.map((installment) => installment.id);

    if (installmentIds.length > 0) {
      const paymentCount = await this.paymentsRepository.count({
        where: { installmentId: In(installmentIds) },
      });
      if (paymentCount > 0) {
        throw new ConflictException(
          'No se puede eliminar un préstamo que ya tiene pagos registrados.',
        );
      }
    }

    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(Installment).softDelete({ loanId: id });
      await manager.getRepository(Loan).softDelete({ id });
    });
  }

  // How much it costs to close this loan out today, per
  // docs/phases/PHASE_16_EARLY_PAYOFF.md — never blindly sums remaining
  // installment totals; a not-yet-due installment contributes only
  // principal, at face value, with zero interest (Colombian Civil Code
  // Art. 1653, confirmed with the human). Read-only, safe to call on any
  // loan regardless of status (an already-paid/refinanced loan simply has
  // no pending installments, so the quote comes back empty).
  async getPayoffQuote(id: string): Promise<PayoffQuote> {
    const loan = await this.findLoanOrThrow(id);
    const pending = await this.findPendingInstallments(id);
    const moratoryByInstallmentId =
      await this.findMoratoryConceptsByInstallmentId(
        pending.map((installment) => installment.id),
      );
    return calculatePayoff(
      pending.map((installment) =>
        toPayoffInstallmentInput(
          installment,
          moratoryByInstallmentId.get(installment.id) ?? [],
        ),
      ),
      loan.interestRate,
    );
  }

  // Separate, explicit flow from registerPayment (confirmed with the
  // human — see the phase doc's "Resolved" point 5): always settles the
  // loan for its FULL quoted amount, closing it out entirely. Registers
  // one real Payment row per still-pending installment, so the payoff
  // leaves the same kind of historical record an ordinary payment would.
  async payoff(id: string): Promise<LoanDetail> {
    const loan = await this.findLoanOrThrow(id);
    if (loan.status !== LoanStatus.Active) {
      throw new BadRequestException(
        `Loan ${id} cannot be paid off because its status is '${loan.status}' — only active loans can be paid off this way`,
      );
    }

    const pending = await this.findPendingInstallments(id);
    const moratoryByInstallmentId =
      await this.findMoratoryConceptsByInstallmentId(
        pending.map((installment) => installment.id),
      );
    const quote = calculatePayoff(
      pending.map((installment) =>
        toPayoffInstallmentInput(
          installment,
          moratoryByInstallmentId.get(installment.id) ?? [],
        ),
      ),
      loan.interestRate,
    );

    const paidAt = new Date().toISOString().slice(0, 10);
    const payments = quote.installments.map((breakdown) =>
      this.paymentsRepository.create({
        installmentId: breakdown.installmentId,
        amountPaid: breakdown.totalDue,
        paidAt,
        observation: 'Liquidación anticipada',
        imageUrl: null,
      }),
    );
    if (payments.length > 0) {
      await this.paymentsRepository.save(payments);
    }

    await this.installmentsRepository.update(
      { loanId: id, status: InstallmentStatus.Pending },
      { status: InstallmentStatus.Paid },
    );
    await this.loansRepository.update({ id }, { status: LoanStatus.Paid });

    return this.findOne(id);
  }

  private findPendingInstallments(loanId: string): Promise<Installment[]> {
    return this.installmentsRepository.find({
      where: { loanId, status: InstallmentStatus.Pending },
      order: { installmentNumber: 'ASC' },
    });
  }

  // Suggests what to pre-fill when refinancing — per
  // docs/phases/PHASE_17_REFINANCING_RECALC.md "Resolved", this reopens
  // Phase 6's manual-entry decision but keeps the field editable, so this
  // is advisory only: refinance() itself still accepts whatever
  // principalAmount/concepts the admin actually submits, unchanged.
  // suggestedPrincipalAmount reuses Phase 16's calculatePayoff() directly
  // (the exact same figure a payoff quote for this loan would show) rather
  // than a separate formula, so the two can never silently disagree on
  // "what the client currently owes." Concepts are carried over from the
  // loan's first installment — the representative baseline, since
  // per-installment overrides are an expected-to-be-rare case with no
  // well-defined mapping onto a new loan's possibly-different installment
  // count — excluding any whose catalog type was since deleted (no valid
  // id left to resubmit).
  //
  // Phase 25 (confirmed with the human, reunión 2026-08-25): unlike a real
  // payoff quote, this one passes earlyMaturityWindowDays so an
  // installment due within the next REFINANCE_EARLY_MATURITY_WINDOW_DAYS
  // days — not yet actually overdue — also has its corriente interest
  // folded into suggestedPrincipalAmount ("de la cuarta cuota entran los
  // intereses al capital también, así no haya llegado a su fecha de
  // vencimiento como tal"). Its moratory interest stays 0, since it isn't
  // actually in mora yet — calculatePayoff() enforces that on its own, see
  // that function's own comment. This window is intentionally scoped to
  // refinancing only: getPayoffQuote()/payoff() (the real early-payoff
  // endpoints, Phase 16) must keep omitting this option so a client asking
  // "what do I owe if I pay off today" is never shown a not-yet-due cuota's
  // interest.
  async getRefinanceQuote(id: string): Promise<RefinanceQuote> {
    const loan = await this.findLoanOrThrow(id);
    const pending = await this.findPendingInstallments(id);
    const moratoryByInstallmentId =
      await this.findMoratoryConceptsByInstallmentId(
        pending.map((installment) => installment.id),
      );
    const payoff = calculatePayoff(
      pending.map((installment) =>
        toPayoffInstallmentInput(
          installment,
          moratoryByInstallmentId.get(installment.id) ?? [],
        ),
      ),
      loan.interestRate,
      new Date(),
      { earlyMaturityWindowDays: REFINANCE_EARLY_MATURITY_WINDOW_DAYS },
    );

    const firstInstallment = await this.installmentsRepository.findOne({
      where: { loanId: id },
      order: { installmentNumber: 'ASC' },
    });
    const concepts = firstInstallment
      ? await this.loanInstallmentConceptsRepository.find({
          where: { installmentId: firstInstallment.id },
        })
      : [];
    const toAssignmentDto = (
      concept: LoanInstallmentConcept,
    ): LoanConceptAssignmentDto => ({
      conceptTypeId: concept.interestConceptTypeId as string,
      calculationType: concept.calculationType,
      value: concept.value,
    });

    return {
      payoff,
      suggestedPrincipalAmount: payoff.totalDue,
      concepts: concepts
        .filter(
          (concept) =>
            concept.interestConceptTypeId !== null &&
            concept.category === ConceptCategory.Corriente,
        )
        .map(toAssignmentDto),
      moratoryConcepts: concepts
        .filter(
          (concept) =>
            concept.interestConceptTypeId !== null &&
            concept.category === ConceptCategory.Moratorio,
        )
        .map(toAssignmentDto),
    };
  }

  // Added for the loan detail screen's "Historial de pagos" (F-19) — there
  // was previously no way to list a loan's payments at all, only register
  // one (POST /installments/:id/payments). Payments are stored per
  // installment (docs/DATABASE.md), so this joins across every installment
  // that belongs to this loan. Ordered oldest-first, matching the Figma
  // numbered list (#1, #2, #3...).
  async getPayments(loanId: string): Promise<PaymentWithImages[]> {
    await this.findLoanOrThrow(loanId);

    const installments = await this.installmentsRepository.find({
      where: { loanId },
      select: ['id'],
    });
    const installmentIds = installments.map((installment) => installment.id);
    if (installmentIds.length === 0) {
      return [];
    }

    const payments = await this.paymentsRepository.find({
      where: { installmentId: In(installmentIds) },
      order: { paidAt: 'ASC' },
    });
    const imageUrlsByPaymentId = await this.findImageUrlsByPaymentId(
      payments.map((payment) => payment.id),
    );

    return payments.map(({ imageUrl, ...payment }) => ({
      ...payment,
      // Phase 28 — payment_images is the real source now; imageUrl is only
      // a fallback for a pre-migration row that somehow still has nothing
      // in payment_images (the migration itself backfills every existing
      // one, so this should be rare in practice). See PaymentImage entity.
      imageUrls:
        imageUrlsByPaymentId.get(payment.id) ?? (imageUrl ? [imageUrl] : []),
    }));
  }

  // Groups a page of payments' PaymentImage rows by paymentId in one query
  // — same bulk-fetch-by-parent-ids pattern as findConceptsByInstallmentId
  // above.
  private async findImageUrlsByPaymentId(
    paymentIds: string[],
  ): Promise<Map<string, string[]>> {
    const map = new Map<string, string[]>();
    if (paymentIds.length === 0) {
      return map;
    }

    const images = await this.paymentImagesRepository.find({
      where: { paymentId: In(paymentIds) },
      order: { createdAt: 'ASC' },
    });
    for (const image of images) {
      const existing = map.get(image.paymentId) ?? [];
      existing.push(image.imageUrl);
      map.set(image.paymentId, existing);
    }
    return map;
  }

  // Phase 10 cupo/mora-block guard — only on create(), not refinance(): the
  // phase brief scopes this to new-loan creation specifically (refinancing
  // restructures existing exposure rather than adding new exposure, and
  // isn't mentioned in docs/phases/PHASE_10_CLIENT_CAPACITY.md's guard
  // scope). Two distinct rejection reasons, checked and reported
  // separately, per that doc: mora-block first, since it applies regardless
  // of how much cupo is left.
  private async assertClientCanTakeNewLoan(
    clientId: string,
    principalAmount: number,
  ): Promise<void> {
    const isMoraBlocked = await this.clientsService.hasMoraBlock(clientId);
    if (isMoraBlocked) {
      throw new BadRequestException(
        'This client has at least one installment more than 30 days ' +
          'overdue and cannot be given a new loan until it is resolved.',
      );
    }

    const { creditAvailable } =
      await this.clientsService.getCreditUsage(clientId);
    if (creditAvailable !== null && principalAmount > creditAvailable) {
      throw new BadRequestException(
        `This loan's principal (${principalAmount}) exceeds the client's ` +
          `available cupo (${creditAvailable}).`,
      );
    }
  }

  // Phase 26 — validates coDebtorClientId before it's ever saved, both for
  // a new loan (persistLoanWithInstallments) and an edit (update()).
  // Two confirmed rules (2026-08-30): (1) a client cannot be both debtor
  // and co-debtor on the same loan, and (2) the co-debtor must be an
  // existing, active client — clientsService.findOne() already throws
  // NotFoundException for a missing or soft-deleted id, which this
  // re-throws as a 400 (a bad reference inside the request body reads
  // better as a validation error than a 404, which conventionally refers
  // to the URL's own resource). No-op when coDebtorClientId is absent — a
  // loan with no co-debtor is the normal case, unaffected.
  private async assertCoDebtorIsValid(
    clientId: string,
    coDebtorClientId: string | null | undefined,
  ): Promise<void> {
    if (!coDebtorClientId) {
      return;
    }
    if (coDebtorClientId === clientId) {
      throw new BadRequestException(
        'A client cannot be both the debtor and the co-debtor on the same loan.',
      );
    }
    try {
      await this.clientsService.findOne(coDebtorClientId);
    } catch {
      throw new BadRequestException(
        `coDebtorClientId ${coDebtorClientId} does not reference an existing, active client.`,
      );
    }
  }

  // Phase 24 — replaces the old warning-only buildUsuryWarning: a loan
  // cannot be created/refinanced/previewed at all without the current
  // calendar month's certified rate on file (confirmed with the human,
  // "no se puede crear un crédito sin que se haya agregado la tasa de
  // usura" — see docs/phases/PHASE_24_USURY_MANDATORY.md). isStale means
  // the most recent row is from a prior month — same hard block as no
  // rate existing at all.
  private async getCurrentUsuryRateOrThrow(): Promise<CurrentUsuryRate> {
    const currentRate = await this.usuryRateService.getCurrentRate();
    if (currentRate === null || currentRate.isStale) {
      throw new BadRequestException(
        "This month's usury rate has not been entered yet — a loan cannot be created or refinanced until it is. See POST /usury-rates.",
      );
    }
    return currentRate;
  }

  // Shared by create() and refinance() — both need a loan row plus its
  // generated installments (and each installment's concept breakdown),
  // differing only in whether refinancedFromLoanId is set. As of Phase 14
  // the schedule is generated, not hand-entered — see
  // docs/phases/PHASE_14_INTEREST_CONCEPTS.md.
  private async persistLoanWithInstallments(
    params: PersistLoanParams,
    manager: EntityManager,
  ): Promise<Loan> {
    const loansRepository = manager.getRepository(Loan);
    const installmentsRepository = manager.getRepository(Installment);
    const loanInstallmentConceptsRepository = manager.getRepository(
      LoanInstallmentConcept,
    );

    await this.assertPromissoryNoteNumberIsUnique(
      params.promissoryNoteNumber,
      loansRepository,
    );
    await this.assertCoDebtorIsValid(params.clientId, params.coDebtorClientId);
    this.assertDownPaymentIsValid(
      params.downPaymentAmount,
      params.downPaymentDueDate,
      params.disbursedAt,
      params.installmentFrequency,
    );
    const hasDownPayment = params.downPaymentAmount != null;

    const { concepts, moratoryConcepts } =
      await this.resolveConceptsWithInterest(
        params.concepts,
        params.moratoryConcepts,
        params.corrienteInterestRate,
        params.moratoryInterestRate,
      );
    const schedule = generateAmortizationSchedule(
      params.principalAmount,
      params.totalInstallments,
      concepts,
    );

    const loan = loansRepository.create({
      clientId: params.clientId,
      promissoryNoteNumber: params.promissoryNoteNumber,
      principalAmount: params.principalAmount,
      interestRate: params.interestRate,
      disbursedAt: params.disbursedAt,
      installmentFrequency: params.installmentFrequency,
      // +1 to count the down payment installment alongside the
      // amortization schedule's own totalInstallments — the stored figure
      // must match how many Installment rows are actually created below,
      // since it drives things like LoanSummary's "3/12" progress display.
      totalInstallments: params.totalInstallments + (hasDownPayment ? 1 : 0),
      status: LoanStatus.Active,
      description: params.description ?? null,
      refinancedFromLoanId: params.refinancedFromLoanId ?? null,
      coDebtorClientId: params.coDebtorClientId ?? null,
      coDebtorRelationship: params.coDebtorRelationship ?? null,
    });

    let savedLoan: Loan;
    try {
      savedLoan = await loansRepository.save(loan);
    } catch (error) {
      throw this.mapUniqueViolation(error);
    }

    // Down payment (if any) is always installmentNumber 1, interest-free,
    // due on its own admin-chosen date. Schedule-generated installments
    // keep using their own unshifted generated.installmentNumber for the
    // due-date formula (disbursedAt was computed by the frontend as
    // "second installment's date minus one period", so calculateDueDate(…,
    // 1) already lands on the right date) — only the number actually
    // *stored* is offset by +1, to make room for the down payment ahead of
    // them. scheduleIndex tracks each descriptor's position in `schedule`
    // (null for the down payment) so concept rows below can be built from
    // the right entry after this prepend, instead of assuming a naive 1:1
    // index alignment between installments and schedule.
    const installmentDescriptors: {
      installmentNumber: number;
      amount: number;
      principalPortion: number;
      dueDate: string;
      isDownPayment: boolean;
      scheduleIndex: number | null;
    }[] = [];
    if (hasDownPayment) {
      installmentDescriptors.push({
        installmentNumber: 1,
        amount: params.downPaymentAmount!,
        principalPortion: params.downPaymentAmount!,
        dueDate: params.downPaymentDueDate!,
        isDownPayment: true,
        scheduleIndex: null,
      });
    }
    schedule.forEach((generated, index) => {
      installmentDescriptors.push({
        installmentNumber:
          generated.installmentNumber + (hasDownPayment ? 1 : 0),
        amount: generated.amount,
        principalPortion: generated.principalPortion,
        dueDate: this.calculateDueDate(
          params.disbursedAt,
          params.installmentFrequency,
          generated.installmentNumber,
        ),
        isDownPayment: false,
        scheduleIndex: index,
      });
    });

    const installments = installmentDescriptors.map((descriptor) =>
      installmentsRepository.create({
        loanId: savedLoan.id,
        installmentNumber: descriptor.installmentNumber,
        amount: descriptor.amount,
        principalPortion: descriptor.principalPortion,
        dueDate: descriptor.dueDate,
        isDownPayment: descriptor.isDownPayment,
        status: InstallmentStatus.Pending,
      }),
    );
    const savedInstallments = await installmentsRepository.save(installments);

    const conceptRows = savedInstallments.flatMap((installment, index) => {
      const descriptor = installmentDescriptors[index];
      return [
        // The down payment (scheduleIndex null) never gets corriente
        // concepts — it's interest-free by construction.
        ...(descriptor.scheduleIndex !== null
          ? schedule[descriptor.scheduleIndex].concepts.map((concept) =>
              loanInstallmentConceptsRepository.create({
                installmentId: installment.id,
                interestConceptTypeId: concept.conceptTypeId,
                nameSnapshot: concept.name,
                calculationType: concept.calculationType,
                category: ConceptCategory.Corriente,
                value: concept.value,
                computedAmount: concept.computedAmount,
              }),
            )
          : []),
        // computedAmount is always 0 for a moratorio row — it's a pure
        // assignment record, never baked into installment.amount. The real
        // charge is computed live once the installment is overdue, see
        // enrichInstallment.ts. Applies to the down payment too (mora
        // still applies if it's missed — confirmed with the human,
        // 2026-09-03). See docs/phases/PHASE_23_DYNAMIC_CHARGES.md.
        ...moratoryConcepts.map((concept) =>
          loanInstallmentConceptsRepository.create({
            installmentId: installment.id,
            interestConceptTypeId: concept.conceptTypeId,
            nameSnapshot: concept.name,
            calculationType: concept.calculationType,
            category: ConceptCategory.Moratorio,
            value: concept.value,
            computedAmount: 0,
          }),
        ),
      ];
    });
    if (conceptRows.length > 0) {
      await loanInstallmentConceptsRepository.save(conceptRows);
    }

    return savedLoan;
  }

  // Redesign, 2026-09-03 — validates the down payment pair before it's
  // ever saved, same "both or neither" convention as assertCoDebtorIsValid.
  // The due-date check compares against calculateDueDate(disbursedAt,
  // frequency, 1) — i.e. the schedule's own first (unshifted) installment
  // date, which is what installment 2 (the first interest-bearing one)
  // ends up on once the down payment occupies slot 1. Plain string
  // comparison is safe: both are 'YYYY-MM-DD', same convention used
  // elsewhere for dueDate comparisons (see dueDateSchedule.ts).
  private assertDownPaymentIsValid(
    downPaymentAmount: number | undefined,
    downPaymentDueDate: string | undefined,
    disbursedAt: string,
    installmentFrequency: InstallmentFrequency,
  ): void {
    if (downPaymentAmount == null && downPaymentDueDate == null) {
      return;
    }
    if (downPaymentAmount == null || downPaymentDueDate == null) {
      throw new BadRequestException(
        'downPaymentAmount and downPaymentDueDate must be provided together, or both omitted.',
      );
    }

    const secondInstallmentDueDate = this.calculateDueDate(
      disbursedAt,
      installmentFrequency,
      1,
    );
    if (downPaymentDueDate >= secondInstallmentDueDate) {
      throw new BadRequestException(
        `downPaymentDueDate (${downPaymentDueDate}) must be before the second installment's due date (${secondInstallmentDueDate}).`,
      );
    }
  }

  // Resolves each referenced concept type's current name from the catalog
  // (snapshotted onto LoanInstallmentConcept — an edit to the catalog entry
  // later must never change an already-generated schedule, confirmed with
  // the human). Concepts are the same for every installment of a loan —
  // set once at creation, not overridable per installment. See
  // generateSchedule.ts's own comment for the capital-fijo amortization
  // this feeds into (docs/phases/PHASE_14_INTEREST_CONCEPTS.md's original
  // context — since reversed, 2026-09-04).
  private async resolveConcepts(
    concepts: LoanConceptAssignmentDto[],
  ): Promise<ConceptAssignment[]> {
    const distinctConceptTypeIds = new Set(
      concepts.map((concept) => concept.conceptTypeId),
    );

    const typeById = new Map<
      string,
      {
        name: string;
        fixedAmountDistribution: ConceptAssignment['fixedAmountDistribution'];
      }
    >();
    for (const conceptTypeId of distinctConceptTypeIds) {
      const conceptType =
        await this.interestConceptTypesService.findOneOrThrow(conceptTypeId);
      if (conceptType.category !== ConceptCategory.Corriente) {
        throw new BadRequestException(
          `Concept type "${conceptType.name}" is category "${conceptType.category}", not "corriente" — it cannot be assigned as an ordinary concept. Use moratoryConcepts instead.`,
        );
      }
      typeById.set(conceptTypeId, {
        name: conceptType.name,
        fixedAmountDistribution:
          conceptType.fixedAmountDistribution ?? undefined,
      });
    }

    // These are optional catalog fees (Phase 14) — no usury-ceiling
    // enforcement here. The ceiling only bounds the system-generated
    // interest field, see resolveConceptsWithInterest.
    const resolved = concepts.map((concept) => ({
      conceptTypeId: concept.conceptTypeId,
      name: typeById.get(concept.conceptTypeId)?.name ?? '',
      calculationType: concept.calculationType,
      value: concept.value,
      fixedAmountDistribution: typeById.get(concept.conceptTypeId)
        ?.fixedAmountDistribution,
    }));
    return resolved;
  }

  // Phase 23 — mirrors resolveConcepts above, but for moratory concepts:
  // validates every referenced type is category "moratorio" and skips
  // fixedAmountDistribution entirely (meaningless here — a moratory
  // fixed_amount concept is always charged once, flat, on the overdue
  // installment, confirmed with the human, see
  // docs/phases/PHASE_23_DYNAMIC_CHARGES.md).
  private async resolveMoratoryConcepts(
    concepts: LoanConceptAssignmentDto[],
  ): Promise<ConceptAssignment[]> {
    const distinctConceptTypeIds = new Set(
      concepts.map((concept) => concept.conceptTypeId),
    );

    const nameByConceptTypeId = new Map<string, string>();
    for (const conceptTypeId of distinctConceptTypeIds) {
      const conceptType =
        await this.interestConceptTypesService.findOneOrThrow(conceptTypeId);
      if (conceptType.category !== ConceptCategory.Moratorio) {
        throw new BadRequestException(
          `Concept type "${conceptType.name}" is category "${conceptType.category}", not "moratorio" — it cannot be assigned as a moratory concept. Use concepts instead.`,
        );
      }
      nameByConceptTypeId.set(conceptTypeId, conceptType.name);
    }

    const resolved = concepts.map((concept) => ({
      conceptTypeId: concept.conceptTypeId,
      name: nameByConceptTypeId.get(concept.conceptTypeId) ?? '',
      calculationType: concept.calculationType,
      value: concept.value,
    }));
    return resolved;
  }

  // Redesign, 2026-09-03 — the loan's own corriente/moratorio interest is
  // no longer picked from the catalog; it's built here directly from the
  // request's corrienteInterestRate/moratoryInterestRate (defaulting to,
  // and capped at, the current usury ceiling — "editable solo hacia
  // abajo", confirmed with the human). Wraps resolveConcepts/
  // resolveMoratoryConcepts, which still resolve any optional catalog
  // fees the admin picked on top.
  private async resolveConceptsWithInterest(
    concepts: LoanConceptAssignmentDto[],
    moratoryConcepts: LoanConceptAssignmentDto[],
    corrienteInterestRate: number | undefined,
    moratoryInterestRate: number | undefined,
  ): Promise<{
    concepts: ConceptAssignment[];
    moratoryConcepts: ConceptAssignment[];
  }> {
    const currentRate = await this.getCurrentUsuryRateOrThrow();

    const corriente = this.buildInterestConceptAssignment(
      this.resolveInterestRate(
        corrienteInterestRate,
        currentRate.ratePercentage,
        'intereses corrientes',
      ),
      'Intereses corrientes',
    );
    const moratorio = this.buildInterestConceptAssignment(
      this.resolveInterestRate(
        moratoryInterestRate,
        currentRate.ratePercentage,
        'intereses moratorios',
      ),
      'Intereses moratorios',
    );

    const resolvedConcepts = await this.resolveConcepts(concepts);
    const resolvedMoratoryConcepts =
      await this.resolveMoratoryConcepts(moratoryConcepts);

    return {
      concepts: [corriente, ...resolvedConcepts],
      moratoryConcepts: [moratorio, ...resolvedMoratoryConcepts],
    };
  }

  // conceptTypeId: null marks this as system-generated, not a catalog
  // pick — see LoanInstallmentConcept.interestConceptTypeId and
  // InterestConceptType's class comment.
  private buildInterestConceptAssignment(
    rate: number,
    name: string,
  ): ConceptAssignment {
    return {
      conceptTypeId: null,
      name,
      calculationType: ConceptCalculationType.Percentage,
      value: rate,
    };
  }

  private resolveInterestRate(
    requested: number | undefined,
    ceiling: number,
    label: string,
  ): number {
    const rate = requested ?? ceiling;
    this.assertInterestRateWithinCeiling(rate, ceiling, label);
    return rate;
  }

  // Small float tolerance — ceiling and requested rate both come through
  // decimal DB/DTO round-tripping.
  private assertInterestRateWithinCeiling(
    rate: number,
    ceiling: number,
    label: string,
  ): void {
    const EPSILON = 0.0001;
    if (rate > ceiling + EPSILON) {
      throw new BadRequestException(
        `La tasa de ${label} (${rate}%) no puede superar la tasa de usura vigente (${ceiling}%).`,
      );
    }
  }

  // A failed/skipped "new loan" WhatsApp message must never fail the loan
  // creation itself — same principle as the rest of the whatsapp module
  // (messaging failures are a business outcome, logged, not an application
  // error). See docs/phases/PHASE_9_MESSAGE_TYPES.md.
  //
  // Only a genuinely Sent result marks newLoanMessageSentAt — a Failed
  // result (WhatsAppService itself reported failure, no exception thrown)
  // must leave it null, so the Phase 18 retry cron picks the loan back up.
  // See docs/phases/PHASE_18_MESSAGE_AUDIENCES.md.
  private async sendNewLoanMessageSafely(loanId: string): Promise<void> {
    try {
      const messageLog =
        await this.newLoanReminderService.sendNewLoanMessage(loanId);
      if (messageLog.status === MessageLogStatus.Sent) {
        await this.loansRepository.update(
          { id: loanId },
          { newLoanMessageSentAt: new Date() },
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to send new-loan WhatsApp message for loan ${loanId}`,
        error,
      );
    }
  }

  private async findLoanOrThrow(id: string): Promise<Loan> {
    const loan = await this.loansRepository.findOneBy({ id });
    if (!loan) {
      throw new NotFoundException(`Loan with id ${id} not found`);
    }
    return loan;
  }

  private async assertPromissoryNoteNumberIsUnique(
    promissoryNoteNumber: string,
    loansRepository: Repository<Loan>,
  ): Promise<void> {
    const existing = await loansRepository.findOne({
      where: { promissoryNoteNumber },
      withDeleted: true,
    });
    if (existing) {
      throw new ConflictException(
        `A loan with promissory note number ${promissoryNoteNumber} already exists`,
      );
    }
  }

  private calculateDueDate(
    disbursedAt: string,
    frequency: InstallmentFrequency,
    installmentNumber: number,
  ): string {
    return frequency === InstallmentFrequency.Monthly
      ? addMonthsToDateString(disbursedAt, installmentNumber)
      : addWeeksToDateString(disbursedAt, installmentNumber * 2);
  }

  private mapUniqueViolation(error: unknown): unknown {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === POSTGRES_UNIQUE_VIOLATION
    ) {
      return new ConflictException(
        'A loan with this promissory note number already exists',
      );
    }
    return error;
  }
}

function toPayoffInstallmentInput(
  installment: Installment,
  moratoryConcepts: LoanInstallmentConcept[] = [],
): PayoffInstallmentInput {
  return {
    installmentId: installment.id,
    installmentNumber: installment.installmentNumber,
    amount: installment.amount,
    principalPortion: installment.principalPortion,
    dueDate: installment.dueDate,
    moratoryConcepts: moratoryConcepts.map((concept) => ({
      name: concept.nameSnapshot,
      calculationType: concept.calculationType,
      value: concept.value,
    })),
  };
}

// Mirrors NULLIF(regexp_replace(promissory_note_number, '\D', '', 'g'),
// '')::bigint from the previous SQL-level sort: strip everything but
// digits, null when nothing's left. BigInt (not parseInt) to match
// Postgres's bigint precision for unusually long numbers.
function extractNumericPart(promissoryNoteNumber: string): bigint | null {
  const digits = promissoryNoteNumber.replace(/\D/g, '');
  return digits === '' ? null : BigInt(digits);
}

// NULLS LAST for the numeric part, then a plain text compare as the
// tiebreaker — same two-level ORDER BY as the previous query builder.
function compareLoansByPromissoryNoteNumber(a: Loan, b: Loan): number {
  const numericA = extractNumericPart(a.promissoryNoteNumber);
  const numericB = extractNumericPart(b.promissoryNoteNumber);

  if (numericA === null && numericB !== null) {
    return 1;
  }
  if (numericA !== null && numericB === null) {
    return -1;
  }
  if (numericA !== null && numericB !== null && numericA !== numericB) {
    return numericA < numericB ? -1 : 1;
  }

  if (a.promissoryNoteNumber < b.promissoryNoteNumber) {
    return -1;
  }
  if (a.promissoryNoteNumber > b.promissoryNoteNumber) {
    return 1;
  }
  return 0;
}
