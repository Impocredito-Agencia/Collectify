import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  EntityManager,
  FindOptionsWhere,
  ILike,
  In,
  Repository,
} from 'typeorm';

import { ClientCreditBalanceService } from '../clients/clientCreditBalance.service';
import { ClientsService } from '../clients/clients.service';
import { PaginatedResult } from '../common/interfaces/paginatedResult.interface';
import { countDecimalPlaces } from '../common/numberPrecision';
import { Configuration } from '../config/configuration';
import {
  ConceptCalculationType,
  ConceptCategory,
} from '../interestConceptTypes/entities/interestConceptType.entity';
import { InterestConceptTypesService } from '../interestConceptTypes/interestConceptTypes.service';
import {
  CurrentUsuryRate,
  UsuryRateService,
} from '../usuryRates/usuryRates.service';
import { WhatsappInboundMessage } from '../whatsapp/entities/whatsappInboundMessage.entity';
import {
  ConceptAssignment,
  generateAmortizationSchedule,
} from './amortization/generateSchedule';
import { AdjustPendingInstallmentsDto } from './dto/adjustPendingInstallments.dto';
import { CreateLoanDto } from './dto/createLoan.dto';
import { LoanConceptAssignmentDto } from './dto/loanConceptAssignment.dto';
import { UpdateLoanDto } from './dto/updateLoan.dto';
import { PreviewScheduleDto } from './dto/previewSchedule.dto';
import { PayoffLoanDto } from './dto/payoffLoan.dto';
import { LoanSortColumn, QueryLoansDto } from './dto/queryLoans.dto';
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
import { isInstallmentAdjustmentAllowed } from './installmentAdjustment';
import {
  calculateDaysUntilDue,
  calculateOverdueDays,
} from './installments/installmentCalculations';
import { sumPaymentsByInstallmentId } from './installments/paymentTotals';
import {
  calculateInterestTrueUpBreakdown,
  InterestTrueUpBreakdown,
} from './payoff/calculateInterestTrueUp';
import {
  calculatePayoff,
  PayoffInstallmentInput,
  PayoffQuote,
} from './payoff/calculatePayoff';
import {
  comparePromissoryNoteNumbers,
  extractNumericPart,
} from './promissoryNoteNumberSort';

const DEFAULT_PAGE = 1;
// How many loans findAll() summarizes at a time when it has to order the
// whole list by a computed column (see LoansService.findAll).
const SORT_SUMMARY_CHUNK_SIZE = 200;
// 50, matching clients.service.ts's DEFAULT_PAGE_SIZE — see the same note
// in dashboard.service.ts (style cleanup 2026-09-05).
const DEFAULT_PAGE_SIZE = 50;
const POSTGRES_UNIQUE_VIOLATION = '23505';
// Phase 25 (confirmed with the human, reunión 2026-08-25), extended
// 2026-09-26 to cover early payoff too — see getRefinanceQuote()'s own
// comment. Not the same "5" as MessageTemplate's upcomingDueReminderDays
// (Phase 9); kept as its own named constant specifically so the two are
// never accidentally conflated or refactored into sharing a value.
//
// Corrected, 2026-09-30 (human correction) — the original implementation
// counted these 5 days backward from dueDate ("matured once due within the
// next 5 days"). The client's actual rule counts forward from when the
// installment's PERIOD STARTED instead (the previous installment's dueDate,
// or the loan's disbursedAt for the first one — see
// buildPeriodStartDates below): once this many days have passed since then,
// the cuota's corriente interest is treated as fully caused, even though it
// may not be due for weeks. The old backward-counting version left a cliff
// at day 6: paying off 6+ days before a cuota fell due skipped that cuota's
// interest completely, which was exactly the loophole this rule exists to
// close ("si un cliente paga todo faltando 6 días, se libraría de esos
// intereses"). Worked example: a cuota due October 5th, whose previous
// cuota was due September 5th, has its interest treated as fully caused
// from September 10th onward — not just the 5 days right before October 5.
// Renamed from EARLY_MATURITY_WINDOW_DAYS to match (was named after the old,
// wrong "before maturity" framing). Still shared by both routes, so
// liquidating and refinancing the same loan on the same day cost the same
// interest — with the rule on one route only, the cheaper route would be
// the one to pick, defeating its own purpose.
const INTEREST_ACCRUAL_GRACE_DAYS = 5;

// Human request, 2026-09-30 (paraphrased) — the certified usury ceiling is
// a decimal figure that changes month to month (e.g. 2.1176% for October
// 2026), which made every loan's corriente/moratory concepts carry extra
// decimals the client had to factor into hand-calculated cargos
// adicionales. A round, whole-number default removes that friction for the
// common case, while every field stays exactly as editable as before —
// nothing here changes what the admin CAN type, only what the field starts
// with when left untouched.
//
// Math.min in resolveInterestRate below, not a plain substitution — this
// is a hard legal ceiling (cobrar por encima de la tasa de usura es delito,
// Art. 305 Código Penal), so the default can never be allowed to outrank
// the certified rate. On a month where the certified rate itself is below
// this value, Math.min silently falls back to that lower, real ceiling
// instead of overshooting it — a mathematical guarantee (the minimum of
// two numbers can never exceed either one), not a conditional that could
// be coded wrong. assertInterestRateWithinCeiling below re-checks the
// final resolved rate regardless of where it came from, as a second,
// independent backstop against the same mistake.
const DEFAULT_INTEREST_RATE_PERCENTAGE = 2;

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
  // Part of payoff.totalInterestOwed that is only there because of
  // INTEREST_ACCRUAL_GRACE_DAYS (an installment not yet due, treated as
  // already caused because enough days have passed since its period
  // started) — i.e. what the quote would NOT include without that rule.
  // 0 when no installment is matured this way.
  earlyWindowInterest: number;
  // Which pending installments are matured this way — not yet actually
  // due, but caught by INTEREST_ACCRUAL_GRACE_DAYS — lets the UI name them
  // in its explanation.
  earlyWindowInstallmentNumbers: number[];
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
  // unaffected by the interestAccrualGraceDays option (see
  // calculatePayoff.ts — principalApplied never depends on it), so this
  // agrees with what a payoff or refinance quote shows for the same figure
  // whether or not that option is applied.
  currentPrincipalBalance: number;
  // Human request, 2026-09-25 — whether PATCH
  // /loans/:id/installments/amount-adjustment would accept this loan right
  // now (see LoansConfig). Lets the admin panel show the action only on
  // the pagarés it's actually unlocked for.
  canAdjustPendingInstallments: boolean;
}

// Phase 28 — getPayments()'s return shape: imageUrl replaced with
// imageUrls, sourced from payment_images (falling back to the deprecated
// imageUrl column for a pre-migration row, see Payment entity).
export interface PaymentWithImages extends Omit<Payment, 'imageUrl'> {
  imageUrls: string[];
  // Human request, 2026-09-26 — the saldo a favor this payment generated
  // that is still standing (an excess the client handed over), and the
  // saldo a favor it spent (a payment funded by credit). What voiding it
  // would take back / give back — see ClientCreditBalanceService.
  creditGeneratedAmount: number;
  creditSpentAmount: number;
  // Human request, 2026-09-29 — the WhatsApp message whose comprobante
  // this payment was registered from ("Registrar pago con este
  // comprobante", see WhatsappInboundMessage.paymentId), so the loan's
  // payment history can link back to that conversation. Null for a
  // payment registered any other way.
  sourceWhatsappMessage: SourceWhatsappMessage | null;
}

export interface SourceWhatsappMessage {
  id: string;
  clientId: string | null;
  receivedAt: Date;
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
  disbursedAt: string;
  // Bug fix, 2026-09-09 — the exact due date of the schedule's own
  // (unshifted) installment 1, as entered by the admin on LoanForm/
  // RefinanceLoanForm. When provided, calculateDueDate() anchors every
  // installment's date on this value directly instead of re-deriving it
  // from disbursedAt + one period. Necessary because disbursedAt itself
  // is back-computed on the frontend as "firstInstallmentDueDate minus
  // one period" (computeDisbursedAt()), which is lossy whenever that
  // period's month is shorter than the target day — e.g. subtracting a
  // month from a March 31 due date clamps disbursedAt to Feb 28, and Feb
  // 28 can never recover the original 31 when a month is added back. The
  // installment day-of-month then stayed stuck at whatever the clamp
  // produced for every subsequent installment too — not just the ones
  // actually landing in a short month. Optional: LoanImportService's
  // disbursedAt is a real historical date (not back-computed from a due
  // date), so its existing disbursedAt-only generation is unaffected. See
  // dueDateSchedule.ts's addMonthsToDateString for the clamping this
  // works around.
  firstInstallmentDueDate?: string;
  installmentFrequency: InstallmentFrequency;
  totalInstallments: number;
  concepts: LoanConceptAssignmentDto[];
  // Phase 23 — must all reference concept types with category "moratorio";
  // never baked into the generated schedule, see resolveMoratoryConcepts.
  moratoryConcepts: LoanConceptAssignmentDto[];
  // Redesign, 2026-09-03 — the loan's own corriente/moratorio interest,
  // system-generated rather than a catalog pick (see
  // resolveConceptsWithInterest). Omitted means "use
  // DEFAULT_INTEREST_RATE_PERCENTAGE, or the current usury ceiling if that
  // ceiling is itself lower"; never allowed above the ceiling either way.
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
  // See CreateLoanDto.isNewLoan. Defaults to false in persistLoanWithInstallments.
  isNewLoan?: boolean;
  // Human report, 2026-09-19 — see Loan.alternateContactPhoneNumber's own
  // comment. Must be provided together or omitted together — validated in
  // assertAlternateContactIsValid.
  alternateContactName?: string | null;
  alternateContactPhoneNumber?: string | null;
  // Redesign, 2026-09-06 (confirmed with the human) — set only by
  // refinance(), which passes the OLD loan's own promissoryNoteNumber
  // straight through as this new loan's number (see its own comment).
  // That number, by construction, always already exists on at least the
  // loan being refinanced — assertPromissoryNoteNumberIsUnique would
  // therefore always reject it if run. Skipping the check here is safe
  // specifically BECAUSE the number isn't being chosen/typed by anyone; a
  // genuinely new loan (create()) never sets this and always goes through
  // the full strict check, which continues to permanently block reusing
  // any historical (paid/refinanced) number — only a refinance of that
  // exact loan may carry its number forward.
  skipPromissoryNoteNumberUniquenessCheck?: boolean;
}

@Injectable()
export class LoansService {
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
    @InjectRepository(WhatsappInboundMessage)
    private readonly whatsappInboundMessagesRepository: Repository<WhatsappInboundMessage>,
    private readonly interestConceptTypesService: InterestConceptTypesService,
    private readonly usuryRateService: UsuryRateService,
    private readonly clientsService: ClientsService,
    private readonly clientCreditBalanceService: ClientCreditBalanceService,
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService<Configuration, true>,
  ) {}

  // Changed, 2026-09-09 (client decision) — mora is no longer a hard
  // block on new-loan creation, only cupo is; see
  // assertClientCanTakeNewLoan's own comment for why. That removed the
  // only reason a caller ever needed to skip this guard (the temporary
  // LOAN_IMPORT_SKIP_CREDIT_CHECK toggle from 2026-09-08, gone as of this
  // change — see docs/DATABASE.md's note of this date), so create() no
  // longer takes an options bag at all: the guard always runs.
  async create(dto: CreateLoanDto): Promise<LoanDetail> {
    await this.assertClientCanTakeNewLoan(dto.clientId, dto.principalAmount);

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
          disbursedAt: dto.disbursedAt,
          firstInstallmentDueDate: dto.firstInstallmentDueDate,
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
          isNewLoan: dto.isNewLoan,
          alternateContactName: dto.alternateContactName,
          alternateContactPhoneNumber: dto.alternateContactPhoneNumber,
        },
        manager,
      ),
    );

    // Restored, 2026-09-09 (confirmed with the human) — no longer sent
    // synchronously here. A loan created with isNewLoan: true is picked up
    // by the scheduled "new loan" cron sweep
    // (NewLoanReminderService.runPendingLoanNotifications) instead, so it
    // fires at the admin-configured schedule rather than immediately — see
    // WhatsappCronService's NewLoan family. isNewLoan defaults to false on
    // both the DTO and the LoanForm checkbox, so a historical/backfilled
    // loan never gets swept unless explicitly marked otherwise.

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
        dto.firstInstallmentDueDate,
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
    // getRefinanceQuote's interestAccrualGraceDays) installments' accrued
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
          // Business change, 2026-09-06 (confirmed with the human) — the
          // new loan REPLACES the old one under the same pagaré number,
          // instead of getting a new one of its own; no longer accepts a
          // client-supplied number — see RefinanceLoanDto's own comment for
          // the removed field. skipPromissoryNoteNumberUniquenessCheck is
          // required here: this number always already exists (on oldLoan,
          // and possibly earlier loans in the same refinancing chain too),
          // so the normal strict check — which the human specifically asked
          // to keep unchanged for genuinely new loans — would always reject
          // it. See PersistLoanParams' own comment on that flag.
          promissoryNoteNumber: oldLoan.promissoryNoteNumber,
          skipPromissoryNoteNumberUniquenessCheck: true,
          principalAmount: dto.principalAmount,
          disbursedAt: dto.disbursedAt,
          firstInstallmentDueDate: dto.firstInstallmentDueDate,
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
          // Human report, 2026-09-19 — carries over the old loan's
          // alternate contact unchanged unless the dto explicitly
          // overrides it, same distinguish-omitted-from-null convention
          // as coDebtorClientId/coDebtorRelationship above.
          alternateContactName:
            dto.alternateContactName === undefined
              ? oldLoan.alternateContactName
              : dto.alternateContactName,
          alternateContactPhoneNumber:
            dto.alternateContactPhoneNumber === undefined
              ? oldLoan.alternateContactPhoneNumber
              : dto.alternateContactPhoneNumber,
          // Redesign, 2026-09-06 (confirmed with the human) — always true,
          // no longer dto-driven. Unlike create(), a refinance is never a
          // historical/backfilled event being typed in after the fact: it
          // can only be run against a loan that's already active in the
          // system today, so it's always a real, live event that should
          // notify the client. The "isNewLoan" concept (distinguishing a
          // real event from a backfill) only makes sense for create() —
          // see RefinanceLoanDto's own comment for the removed field.
          isNewLoan: true,
        },
        manager,
      );
    });

    // See the identical comment in create() — no longer sent
    // synchronously. A refinance's isNewLoan is hardcoded true above, so
    // it's always picked up by the next "new loan" cron sweep run.

    return this.findOne(newLoan.id);
  }

  // Style cleanup (2026-09-03) — suggests the next pagaré number for
  // LoanForm to pre-fill (still editable; the client wants #0000-style
  // padding going forward, not a hard lock — see docs/GLOSSARY.md
  // "Loan / Pagaré"). No longer used by RefinanceLoanForm as of the
  // 2026-09-06 redesign — a refinance now keeps the old loan's own number
  // instead of getting a new one, so there's nothing left to suggest there.
  // Takes the highest numeric part
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

    const direction = query.sortDirection === 'desc' ? -1 : 1;
    const sortBy: LoanSortColumn = query.sortBy ?? 'promissoryNoteNumber';
    const start = (page - 1) * limit;

    // Ordering is applied to the WHOLE result before the page is cut, so
    // page 1 of a descending sort really holds the last rows of the list
    // (human report, 2026-09-25 — the sort used to run client-side over just
    // the loaded page). Ties always fall back to pagaré number ascending,
    // whatever the direction, so the order is stable.
    if (
      sortBy === 'outstandingBalance' ||
      sortBy === 'overdueDays' ||
      sortBy === 'status'
    ) {
      // These columns only exist once installments are read and enriched, so
      // ordering by them means summarizing every match, not just one page.
      // Done in chunks — summarize() batches its installment/concept/payment
      // lookups with IN (...) lists, and a chunk keeps those to a size
      // Postgres handles comfortably however many loans match. Only paid
      // when the admin actually sorts by one of these three columns.
      const summaries: LoanSummary[] = [];
      for (let i = 0; i < visible.length; i += SORT_SUMMARY_CHUNK_SIZE) {
        summaries.push(
          ...(await this.summarize(
            visible.slice(i, i + SORT_SUMMARY_CHUNK_SIZE),
          )),
        );
      }
      summaries.sort(
        (a, b) =>
          direction * compareLoanSummariesByColumn(a, b, sortBy) ||
          comparePromissoryNoteNumbers(
            a.promissoryNoteNumber,
            b.promissoryNoteNumber,
          ),
      );
      return {
        items: summaries.slice(start, start + limit),
        meta: {
          page,
          limit,
          total: summaries.length,
          totalPages: Math.ceil(summaries.length / limit),
        },
      };
    }

    visible.sort(
      (a, b) =>
        direction *
          (sortBy === 'clientFullName'
            ? compareClientFullNames(a, b)
            : compareLoansByPromissoryNoteNumber(a, b)) ||
        compareLoansByPromissoryNoteNumber(a, b),
    );
    const total = visible.length;
    const items = await this.summarize(visible.slice(start, start + limit));

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
    // Needed so this reports the exact same outstandingBalance/
    // overdueBalance as the loan's own detail view (GET /loans/:id).
    const conceptsByInstallmentId = await this.findConceptsByInstallmentId(
      installments.map((installment) => installment.id),
    );
    // Bug fix, 2026-09-07 — see enrichInstallment.ts's `totalPaid` param and
    // docs/DATABASE.md's note of this date: without this, outstandingBalance/
    // overdueBalance here counted a partially paid Pending installment's
    // FULL original totalDue, overstating what's actually still outstanding
    // on the loans list and (via summarize()'s other caller) the Dashboard.
    const totalPaidByInstallmentId = await sumPaymentsByInstallmentId(
      this.paymentsRepository,
      installments.map((installment) => installment.id),
    );

    return loans.map((loan) => {
      const { client, ...loanFields } = loan;
      const enriched = installments
        .filter((installment) => installment.loanId === loan.id)
        .map((installment) =>
          enrichInstallment(
            installment,
            conceptsByInstallmentId.get(installment.id) ?? [],
            totalPaidByInstallmentId.get(installment.id) ?? 0,
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
    // Bug fix, 2026-09-07 — see summarize()'s identical addition above and
    // enrichInstallment.ts's `totalPaid` param: this is what the
    // register-payment dialog's displayed/pre-filled "Saldo" reads (via
    // installments[].totalDue below) — without it, a second payment could
    // exceed what was truly left on an already-partially-paid installment
    // (préstamo #0920's bug).
    const totalPaidByInstallmentId = await sumPaymentsByInstallmentId(
      this.paymentsRepository,
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
    // (installments filtered to pending; conceptsByInstallmentId passed
    // through as-is — toPayoffInstallmentInput does its own
    // corriente/moratorio split now) rather than calling getPayoffQuote(id)
    // again, which would re-fetch the loan and its concepts a second time
    // for no reason — same calculatePayoff() engine either way, just
    // without the redundant round-trips.
    const pendingInstallments = installments.filter(
      (installment) => installment.status === InstallmentStatus.Pending,
    );
    // periodStartDate has no bearing on totalPrincipalOwed (see
    // calculatePayoff.ts's own note — principalApplied never depends on
    // maturity) but the field is required on every PayoffInstallmentInput,
    // so it's still computed correctly here rather than faked.
    const periodStartDates = buildPeriodStartDates(
      installments,
      loan.disbursedAt,
    );
    const currentPrincipalBalance = calculatePayoff(
      pendingInstallments.map((installment) =>
        toPayoffInstallmentInput(
          installment,
          conceptsByInstallmentId.get(installment.id) ?? [],
          totalPaidByInstallmentId.get(installment.id) ?? 0,
          periodStartDates.get(installment.installmentNumber) ??
            loan.disbursedAt,
        ),
      ),
    ).totalPrincipalOwed;

    return {
      ...loan,
      coDebtorClient,
      installments: installments.map((installment) =>
        enrichInstallment(
          installment,
          conceptsByInstallmentId.get(installment.id) ?? [],
          totalPaidByInstallmentId.get(installment.id) ?? 0,
        ),
      ),
      refinancedToLoanId: refinancedTo?.id ?? null,
      currentPrincipalBalance,
      canAdjustPendingInstallments: this.canAdjustPendingInstallments(loan),
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

  async update(id: string, dto: UpdateLoanDto): Promise<Loan> {
    const loan = await this.findLoanOrThrow(id);
    if (dto.coDebtorClientId !== undefined) {
      await this.assertCoDebtorIsValid(loan.clientId, dto.coDebtorClientId);
    }
    Object.assign(loan, dto);
    // Human report, 2026-09-19 — validated against the loan's RESULTING
    // state (post-merge), not just the two fields on this one dto in
    // isolation: a PATCH setting only alternateContactPhoneNumber while
    // alternateContactName was already set from an earlier request must
    // still pass, and one clearing only alternateContactName while a
    // phone number stays on the loan must still be caught.
    this.assertAlternateContactIsValid(
      loan.alternateContactName,
      loan.alternateContactPhoneNumber,
    );
    return this.loansRepository.save(loan);
  }

  // Human request, 2026-09-25 — see LoansConfig's comment. Adds the same
  // amount to every still-pending installment, as capital: `amount` and
  // `principalPortion` move together (so the cuota's concepts — its
  // interest — are untouched), and the loan's principalAmount grows by the
  // total added so it keeps matching the sum of its installments' capital.
  // Deliberately sends nothing: no WhatsApp, no isNewLoan flip — the
  // clients these loans belong to already know their real cuota. Paid and
  // cancelled installments are never touched.
  async adjustPendingInstallments(
    id: string,
    dto: AdjustPendingInstallmentsDto,
  ): Promise<LoanDetail> {
    const loan = await this.findLoanOrThrow(id);
    if (!this.canAdjustPendingInstallments(loan)) {
      throw new ForbiddenException(
        'Adjusting installment amounts is not enabled for this loan.',
      );
    }

    await this.dataSource.transaction(async (manager: EntityManager) => {
      const installmentsRepository = manager.getRepository(Installment);
      const pending = await installmentsRepository.find({
        where: { loanId: id, status: InstallmentStatus.Pending },
        order: { installmentNumber: 'ASC' },
      });
      if (pending.length === 0) {
        throw new BadRequestException(
          'This loan has no pending installments to adjust.',
        );
      }

      const payments = await manager.getRepository(Payment).find({
        where: {
          installmentId: In(pending.map((installment) => installment.id)),
        },
        select: {
          installmentId: true,
          amountPaid: true,
          moraWaivedAmount: true,
        },
      });
      const cashPaidByInstallmentId = new Map<string, number>();
      const totalPaidByInstallmentId = new Map<string, number>();
      for (const payment of payments) {
        cashPaidByInstallmentId.set(
          payment.installmentId,
          (cashPaidByInstallmentId.get(payment.installmentId) ?? 0) +
            payment.amountPaid,
        );
        totalPaidByInstallmentId.set(
          payment.installmentId,
          (totalPaidByInstallmentId.get(payment.installmentId) ?? 0) +
            payment.amountPaid +
            (payment.moraWaivedAmount ?? 0),
        );
      }

      for (const installment of pending) {
        const nextAmount = installment.amount + dto.amountPerInstallment;
        const nextPrincipalPortion =
          installment.principalPortion === null
            ? null
            : installment.principalPortion + dto.amountPerInstallment;
        // Human request, 2026-10-19 — a lowered cuota whose payments
        // (cash plus any mora waived with them) already cover its corrected
        // amount is closed as Paid instead of rejected: the client paid the
        // real cuota, and the mora shown only existed because the cuota was
        // loaded too high. Cash beyond the corrected amount is still
        // rejected — that would be a real overpayment with nowhere to go.
        const cashPaid = cashPaidByInstallmentId.get(installment.id) ?? 0;
        const totalPaid = totalPaidByInstallmentId.get(installment.id) ?? 0;
        if (
          cashPaid > nextAmount ||
          (nextPrincipalPortion !== null && nextPrincipalPortion < 0)
        ) {
          throw new BadRequestException(
            `Installment ${installment.installmentNumber} cannot be lowered by that much.`,
          );
        }
        installment.amount = nextAmount;
        installment.principalPortion = nextPrincipalPortion;
        if (dto.amountPerInstallment < 0 && totalPaid >= nextAmount) {
          installment.status = InstallmentStatus.Paid;
        }
      }
      await installmentsRepository.save(pending);

      // An active loan only has pending and paid installments, so settling
      // every pending one pays the loan off — silently, like the rest of
      // this adjustment.
      const settledEveryPending = pending.every(
        (installment) => installment.status === InstallmentStatus.Paid,
      );
      await manager.getRepository(Loan).update(
        { id },
        {
          principalAmount:
            loan.principalAmount + dto.amountPerInstallment * pending.length,
          ...(settledEveryPending && { status: LoanStatus.Paid }),
        },
      );
    });

    return this.findOne(id);
  }

  private canAdjustPendingInstallments(loan: Loan): boolean {
    return (
      loan.status === LoanStatus.Active &&
      isInstallmentAdjustmentAllowed(
        loan.promissoryNoteNumber,
        this.configService.get('loans', { infer: true }),
      )
    );
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
  // Art. 1653, confirmed with the human) — EXCEPT one whose period started
  // at least INTEREST_ACCRUAL_GRACE_DAYS days ago, which is treated as
  // already matured and carries its interest too (human decision,
  // 2026-09-26: the same rule refinancing has used since Phase 25, so both
  // routes charge the same; corrected 2026-09-30, see that constant's own
  // comment). Read-only, safe to call on any loan regardless of status (an
  // already-paid/refinanced loan simply has no pending installments, so the
  // quote comes back empty).
  async getPayoffQuote(id: string): Promise<PayoffQuote> {
    const loan = await this.findLoanOrThrow(id);
    const installments = await this.installmentsRepository.find({
      where: { loanId: id },
      order: { installmentNumber: 'ASC' },
    });
    const pending = installments.filter(
      (installment) => installment.status === InstallmentStatus.Pending,
    );
    const conceptsByInstallmentId = await this.findConceptsByInstallmentId(
      installments.map((installment) => installment.id),
    );
    // Bug fix, 2026-09-15 — see PayoffInstallmentInput.totalPaid's own
    // comment: without this, a Pending installment with a prior partial
    // payment was quoted at its full nominal cost all over again.
    const totalPaidByInstallmentId = await sumPaymentsByInstallmentId(
      this.paymentsRepository,
      pending.map((installment) => installment.id),
    );
    const periodStartDates = buildPeriodStartDates(
      installments,
      loan.disbursedAt,
    );
    const today = new Date();
    return calculatePayoff(
      pending.map((installment) =>
        toPayoffInstallmentInput(
          installment,
          conceptsByInstallmentId.get(installment.id) ?? [],
          totalPaidByInstallmentId.get(installment.id) ?? 0,
          periodStartDates.get(installment.installmentNumber) ??
            loan.disbursedAt,
        ),
      ),
      today,
      {
        interestAccrualGraceDays: INTEREST_ACCRUAL_GRACE_DAYS,
        ...trueUpOptions(
          this.computeInterestTrueUp(
            installments,
            conceptsByInstallmentId,
            periodStartDates,
            today,
            { interestAccrualGraceDays: INTEREST_ACCRUAL_GRACE_DAYS },
          ),
        ),
      },
    );
  }

  // Separate, explicit flow from registerPayment (confirmed with the
  // human — see the phase doc's "Resolved" point 5): always settles the
  // loan for its FULL quoted amount, closing it out entirely. Registers
  // one real Payment row per still-pending installment, so the payoff
  // leaves the same kind of historical record an ordinary payment would.
  async payoff(id: string, dto: PayoffLoanDto = {}): Promise<LoanDetail> {
    const loan = await this.findLoanOrThrow(id);
    if (loan.status !== LoanStatus.Active) {
      throw new BadRequestException(
        `Loan ${id} cannot be paid off because its status is '${loan.status}' — only active loans can be paid off this way`,
      );
    }

    const installments = await this.installmentsRepository.find({
      where: { loanId: id },
      order: { installmentNumber: 'ASC' },
    });
    const pending = installments.filter(
      (installment) => installment.status === InstallmentStatus.Pending,
    );
    const conceptsByInstallmentId = await this.findConceptsByInstallmentId(
      installments.map((installment) => installment.id),
    );
    // Bug fix, 2026-09-15 — see getPayoffQuote's identical addition above;
    // payoff() has its own separate calculatePayoff() call and needed the
    // same fix, not just the quote endpoint.
    const totalPaidByInstallmentId = await sumPaymentsByInstallmentId(
      this.paymentsRepository,
      pending.map((installment) => installment.id),
    );
    const periodStartDates = buildPeriodStartDates(
      installments,
      loan.disbursedAt,
    );
    const today = new Date();
    const quote = calculatePayoff(
      pending.map((installment) =>
        toPayoffInstallmentInput(
          installment,
          conceptsByInstallmentId.get(installment.id) ?? [],
          totalPaidByInstallmentId.get(installment.id) ?? 0,
          periodStartDates.get(installment.installmentNumber) ??
            loan.disbursedAt,
        ),
      ),
      today,
      {
        interestAccrualGraceDays: INTEREST_ACCRUAL_GRACE_DAYS,
        ...trueUpOptions(
          this.computeInterestTrueUp(
            installments,
            conceptsByInstallmentId,
            periodStartDates,
            today,
            { interestAccrualGraceDays: INTEREST_ACCRUAL_GRACE_DAYS },
          ),
        ),
      },
    );

    const paidAt = new Date().toISOString().slice(0, 10);
    // Each pending installment's own true-up already sits in its
    // totalDue; only the unattributed remainder (from installments already
    // paid) has no row of its own, so it rides on the first pending
    // installment's payment — that way the payments still sum to exactly
    // the quoted total.
    // Human report, 2026-10-21 — the admin's own detail (reason, payment
    // method…) goes after the fixed label, never instead of it.
    const adminNote = dto.observation?.trim();
    const payments = quote.installments.map((breakdown, index) => {
      const carriesTrueUp = index === 0 && quote.interestTrueUp !== 0;
      const label = carriesTrueUp
        ? 'Liquidación anticipada (incluye ajuste de interés causado)'
        : 'Liquidación anticipada';
      return this.paymentsRepository.create({
        installmentId: breakdown.installmentId,
        amountPaid:
          breakdown.totalDue + (carriesTrueUp ? quote.interestTrueUp : 0),
        paidAt,
        observation: adminNote ? `${label} — ${adminNote}` : label,
        imageUrl: null,
      });
    });
    if (payments.length > 0) {
      const savedPayments = await this.paymentsRepository.save(payments);
      // Human report, 2026-09-25 — the receipt of the payoff. One comprobante
      // covers the whole settlement, so the same photos go on every payment
      // row it registers (same as a bulk payment across several cuotas), and
      // each row shows them in the loan's payment history.
      if (dto.imageUrls && dto.imageUrls.length > 0) {
        await this.paymentImagesRepository.save(
          savedPayments.flatMap((payment) =>
            (dto.imageUrls ?? []).map((imageUrl) =>
              this.paymentImagesRepository.create({
                paymentId: payment.id,
                imageUrl,
              }),
            ),
          ),
        );
      }
    }

    await this.installmentsRepository.update(
      { loanId: id, status: InstallmentStatus.Pending },
      { status: InstallmentStatus.Paid },
    );
    await this.loansRepository.update({ id }, { status: LoanStatus.Paid });

    return this.findOne(id);
  }

  // See calculateInterestTrueUp.ts. Needs the loan's FULL installment list
  // (paid ones included), unlike calculatePayoff which only sees pending
  // ones. A loan with nothing pending (already paid/refinanced) has nothing
  // left to settle, so its quote stays empty like before.
  //
  // Style cleanup, 2026-09-30 — used to take loanId/pendingCount and fetch
  // its own copy of `installments`/`conceptsByInstallmentId`; now takes
  // them already fetched, since every call site now needs that same full
  // list itself anyway (to build periodStartDates for the new
  // interestAccrualGraceDays rule) — one shared query instead of two.
  private computeInterestTrueUp(
    installments: Installment[],
    conceptsByInstallmentId: Map<string, LoanInstallmentConcept[]>,
    periodStartDates: Map<number, string>,
    today: Date,
    options?: { interestAccrualGraceDays?: number },
  ): InterestTrueUpBreakdown {
    const hasPending = installments.some(
      (installment) => installment.status === InstallmentStatus.Pending,
    );
    if (!hasPending) {
      return {
        total: 0,
        attributedByInstallmentNumber: new Map(),
        unattributed: 0,
      };
    }
    return calculateInterestTrueUpBreakdown(
      installments.map((installment) => ({
        installmentNumber: installment.installmentNumber,
        dueDate: installment.dueDate,
        periodStartDate:
          periodStartDates.get(installment.installmentNumber) ??
          installment.dueDate,
        status: installment.status,
        isDownPayment: installment.isDownPayment,
        amount: installment.amount,
        principalPortion: installment.principalPortion,
        percentageConcepts: (conceptsByInstallmentId.get(installment.id) ?? [])
          .filter(
            (concept) =>
              concept.category === ConceptCategory.Corriente &&
              concept.calculationType === ConceptCalculationType.Percentage,
          )
          .map((concept) => ({
            value: concept.value,
            computedAmount: concept.computedAmount,
          })),
      })),
      today,
      options,
    );
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
  // Phase 25 (confirmed with the human, reunión 2026-08-25), corrected
  // 2026-09-30: this quote passes interestAccrualGraceDays so an
  // installment whose period started at least INTEREST_ACCRUAL_GRACE_DAYS
  // days ago — not yet actually overdue — also has its corriente interest
  // folded into suggestedPrincipalAmount ("de la cuarta cuota entran los
  // intereses al capital también, así no haya llegado a su fecha de
  // vencimiento como tal"). Its moratory interest stays 0, since it isn't
  // actually in mora yet — calculatePayoff() enforces that on its own, see
  // that function's own comment. Since 2026-09-26 the real early-payoff
  // endpoints (getPayoffQuote()/payoff()) apply the same rule — see
  // INTEREST_ACCRUAL_GRACE_DAYS.
  async getRefinanceQuote(id: string): Promise<RefinanceQuote> {
    const loan = await this.findLoanOrThrow(id);
    const installments = await this.installmentsRepository.find({
      where: { loanId: id },
      order: { installmentNumber: 'ASC' },
    });
    const pending = installments.filter(
      (installment) => installment.status === InstallmentStatus.Pending,
    );
    const conceptsByInstallmentId = await this.findConceptsByInstallmentId(
      installments.map((installment) => installment.id),
    );
    // Bug fix, 2026-09-15 — see getPayoffQuote's identical addition:
    // suggestedPrincipalAmount reuses this same engine, so it had the same
    // gap — a partially-paid pending cuota inflated how much principal got
    // suggested for the new refinanced loan.
    const totalPaidByInstallmentId = await sumPaymentsByInstallmentId(
      this.paymentsRepository,
      pending.map((installment) => installment.id),
    );
    const periodStartDates = buildPeriodStartDates(
      installments,
      loan.disbursedAt,
    );
    const today = new Date();
    const payoffInputs = pending.map((installment) =>
      toPayoffInstallmentInput(
        installment,
        conceptsByInstallmentId.get(installment.id) ?? [],
        totalPaidByInstallmentId.get(installment.id) ?? 0,
        periodStartDates.get(installment.installmentNumber) ?? loan.disbursedAt,
      ),
    );
    const payoff = calculatePayoff(payoffInputs, today, {
      interestAccrualGraceDays: INTEREST_ACCRUAL_GRACE_DAYS,
      ...trueUpOptions(
        this.computeInterestTrueUp(
          installments,
          conceptsByInstallmentId,
          periodStartDates,
          today,
          { interestAccrualGraceDays: INTEREST_ACCRUAL_GRACE_DAYS },
        ),
      ),
    });

    // Same quote without the rule: the difference is exactly the interest
    // that only entered because an installment's period started long
    // enough ago, so the UI can show it apart from interest that formally
    // ran (dueDate actually reached).
    const payoffWithoutWindow = calculatePayoff(
      payoffInputs,
      today,
      trueUpOptions(
        this.computeInterestTrueUp(
          installments,
          conceptsByInstallmentId,
          periodStartDates,
          today,
        ),
      ),
    );
    const earlyWindowInstallmentNumbers = pending
      .filter((installment) => {
        if (calculateDaysUntilDue(new Date(installment.dueDate), today) === 0) {
          return false; // already actually due/overdue — not an "early" case
        }
        const periodStart =
          periodStartDates.get(installment.installmentNumber) ??
          loan.disbursedAt;
        return (
          calculateOverdueDays(new Date(periodStart), today) >=
          INTEREST_ACCRUAL_GRACE_DAYS
        );
      })
      .map((installment) => installment.installmentNumber);
    const earlyWindowInterest = Math.max(
      0,
      payoff.totalInterestOwed - payoffWithoutWindow.totalInterestOwed,
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
      earlyWindowInterest,
      earlyWindowInstallmentNumbers,
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

    // Human report, 2026-09-09 — withDeleted here is deliberate, unlike
    // every other Payment query in the codebase: a voided payment (see
    // InstallmentsService.voidPayment()) should stay visible in this
    // history, flagged via deletedAt/voidReason, not silently vanish —
    // this is the one place an admin needs to see that it happened.
    const payments = await this.paymentsRepository.find({
      where: { installmentId: In(installmentIds) },
      order: { paidAt: 'ASC' },
      withDeleted: true,
    });
    const imageUrlsByPaymentId = await this.findImageUrlsByPaymentId(
      payments.map((payment) => payment.id),
    );
    const sourceMessageByPaymentId =
      await this.findSourceWhatsappMessageByPaymentId(
        payments.map((payment) => payment.id),
      );

    const creditByPaymentId =
      await this.clientCreditBalanceService.summarizeCreditByPaymentId(
        payments.map((payment) => payment.id),
      );

    return payments.map(({ imageUrl, ...payment }) => ({
      ...payment,
      // Human request, 2026-09-26 — what voiding this payment would do to the
      // client's saldo a favor, so the void dialog can say so up front.
      creditGeneratedAmount: creditByPaymentId.get(payment.id)?.generated ?? 0,
      creditSpentAmount: creditByPaymentId.get(payment.id)?.spent ?? 0,
      // Phase 28 — payment_images is the real source now; imageUrl is only
      // a fallback for a pre-migration row that somehow still has nothing
      // in payment_images (the migration itself backfills every existing
      // one, so this should be rare in practice). See PaymentImage entity.
      imageUrls:
        imageUrlsByPaymentId.get(payment.id) ?? (imageUrl ? [imageUrl] : []),
      sourceWhatsappMessage: sourceMessageByPaymentId.get(payment.id) ?? null,
    }));
  }

  // Same bulk-fetch-by-parent-ids pattern as findImageUrlsByPaymentId
  // below. A comprobante is linked to at most one payment, but nothing
  // stops two messages pointing at the same one — the earliest wins.
  private async findSourceWhatsappMessageByPaymentId(
    paymentIds: string[],
  ): Promise<Map<string, SourceWhatsappMessage>> {
    const map = new Map<string, SourceWhatsappMessage>();
    if (paymentIds.length === 0) {
      return map;
    }

    const messages = await this.whatsappInboundMessagesRepository.find({
      where: { paymentId: In(paymentIds) },
      select: ['id', 'paymentId', 'clientId', 'receivedAt'],
      order: { receivedAt: 'ASC' },
    });
    for (const message of messages) {
      if (message.paymentId && !map.has(message.paymentId)) {
        map.set(message.paymentId, {
          id: message.id,
          clientId: message.clientId,
          receivedAt: message.receivedAt,
        });
      }
    }
    return map;
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

  // Phase 10 cupo guard — only on create(), not refinance(): the phase
  // brief scopes this to new-loan creation specifically (refinancing
  // restructures existing exposure rather than adding new exposure, and
  // isn't mentioned in docs/phases/PHASE_10_CLIENT_CAPACITY.md's guard
  // scope).
  //
  // Changed, 2026-09-09 (client decision) — mora used to hard-block a new
  // loan here too. Dropped: the client's own reasoning is that by the
  // time a loan is actually being created, the negotiation, acceptance,
  // and paperwork already happened — a hard block at this exact step was
  // the wrong place to catch it, and mostly just got in the way (real
  // reported case: a client with several existing pagarés, one of them
  // overdue past 30 days, needed a genuinely new one created). The
  // client's mora status is still surfaced — GET /clients/:id's
  // isMoraBlocked is unchanged, still shown as a warning banner on
  // LoanForm.tsx — it just no longer blocks submission. See
  // docs/DATABASE.md's note of this date.
  private async assertClientCanTakeNewLoan(
    clientId: string,
    principalAmount: number,
  ): Promise<void> {
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

    if (!params.skipPromissoryNoteNumberUniquenessCheck) {
      await this.assertPromissoryNoteNumberIsUnique(
        params.promissoryNoteNumber,
        loansRepository,
      );
    }
    await this.assertCoDebtorIsValid(params.clientId, params.coDebtorClientId);
    this.assertAlternateContactIsValid(
      params.alternateContactName,
      params.alternateContactPhoneNumber,
    );
    this.assertDownPaymentIsValid(
      params.downPaymentAmount,
      params.downPaymentDueDate,
      params.disbursedAt,
      params.installmentFrequency,
      params.firstInstallmentDueDate,
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
      isNewLoan: params.isNewLoan ?? false,
      alternateContactName: params.alternateContactName ?? null,
      alternateContactPhoneNumber: params.alternateContactPhoneNumber ?? null,
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
          params.firstInstallmentDueDate,
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
  // Human report, 2026-09-19 — see Loan.alternateContactPhoneNumber's own
  // comment. Same "both or neither" shape as assertDownPaymentIsValid
  // below, no cross-field date/uniqueness rule to check beyond that.
  private assertAlternateContactIsValid(
    alternateContactName: string | null | undefined,
    alternateContactPhoneNumber: string | null | undefined,
  ): void {
    const hasName = alternateContactName != null;
    const hasPhoneNumber = alternateContactPhoneNumber != null;
    if (hasName === hasPhoneNumber) {
      return;
    }
    throw new BadRequestException(
      'alternateContactName and alternateContactPhoneNumber must be provided together, or both omitted.',
    );
  }

  private assertDownPaymentIsValid(
    downPaymentAmount: number | undefined,
    downPaymentDueDate: string | undefined,
    disbursedAt: string,
    installmentFrequency: InstallmentFrequency,
    firstInstallmentDueDate?: string,
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
      firstInstallmentDueDate,
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
    const resolved = concepts.map((concept) => {
      const name = typeById.get(concept.conceptTypeId)?.name ?? '';
      this.assertConceptValuePrecision(concept, name);
      return {
        conceptTypeId: concept.conceptTypeId,
        name,
        calculationType: concept.calculationType,
        value: concept.value,
        fixedAmountDistribution: typeById.get(concept.conceptTypeId)
          ?.fixedAmountDistribution,
      };
    });
    return resolved;
  }

  // Feature request, 2026-09-06 (human) — same rule as
  // InterestConceptTypesService.assertValuePrecision, applied here to a
  // concept ASSIGNMENT (what the admin actually picked for this loan)
  // instead of a catalog default: a percentage concept can carry up to 4
  // decimals (see WidenConceptValuePrecision migration), a fixed_amount one
  // — a plain currency figure — only 2. See countDecimalPlaces's own
  // comment for why this lives here instead of a DTO decorator.
  private assertConceptValuePrecision(
    concept: LoanConceptAssignmentDto,
    name: string,
  ): void {
    const maxDecimalPlaces =
      concept.calculationType === ConceptCalculationType.Percentage ? 4 : 2;
    if (countDecimalPlaces(concept.value) > maxDecimalPlaces) {
      throw new BadRequestException(
        concept.calculationType === ConceptCalculationType.Percentage
          ? `El cargo "${name}" es porcentual y admite hasta ${maxDecimalPlaces} decimales.`
          : `El cargo "${name}" es un monto fijo y admite hasta ${maxDecimalPlaces} decimales.`,
      );
    }
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

    const resolved = concepts.map((concept) => {
      const name = nameByConceptTypeId.get(concept.conceptTypeId) ?? '';
      this.assertConceptValuePrecision(concept, name);
      return {
        conceptTypeId: concept.conceptTypeId,
        name,
        calculationType: concept.calculationType,
        value: concept.value,
      };
    });
    return resolved;
  }

  // Redesign, 2026-09-03 — the loan's own corriente/moratorio interest is
  // no longer picked from the catalog; it's built here directly from the
  // request's corrienteInterestRate/moratoryInterestRate, capped at the
  // current usury ceiling and always editable downward too ("editable
  // solo hacia abajo [del techo]", confirmed with the human) — omitted
  // defaults to DEFAULT_INTEREST_RATE_PERCENTAGE instead of the ceiling
  // itself since 2026-09-30 (see that constant's own comment). Wraps
  // resolveConcepts/resolveMoratoryConcepts, which still resolve any
  // optional catalog fees the admin picked on top.
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
    // See DEFAULT_INTEREST_RATE_PERCENTAGE's own comment — Math.min can
    // never resolve above `ceiling`, so a month whose certified rate is
    // itself below the round default falls back to that real ceiling
    // instead.
    const rate =
      requested ?? Math.min(DEFAULT_INTEREST_RATE_PERCENTAGE, ceiling);
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

  private async findLoanOrThrow(id: string): Promise<Loan> {
    const loan = await this.loansRepository.findOneBy({ id });
    if (!loan) {
      throw new NotFoundException(`Loan with id ${id} not found`);
    }
    return loan;
  }

  // Relaxed 2026-09-07 (confirmed with the human, reverses the
  // "regardless of status or soft-delete" rule this comment used to state):
  // a genuinely NEW loan (create(), or a refinance's own dto-driven fields —
  // just not its promissoryNoteNumber anymore, see below) can still never
  // reuse a number that belongs to any EXISTING (non-deleted) loan, but a
  // number that only ever belonged to a loan that was later soft-deleted via
  // LoansService.remove() is now free to reuse. Safe specifically because
  // remove() itself only ever allows deleting a loan that never had a single
  // Payment registered against it — so there is no financial history a
  // reused number could ever get confused with. Dropping `withDeleted: true`
  // here is enough: TypeORM's default query already excludes soft-deleted
  // rows, so this now only looks at loans that are still "live" in some
  // status (active/paid/refinanced).
  //
  // Only refinance()'s own inherited number is exempt from this check
  // entirely (see persistLoanWithInstallments's
  // skipPromissoryNoteNumberUniquenessCheck param) — it's not "picking" a
  // number to validate, it's mechanically carrying the old loan's own number
  // forward, which by construction always already exists (on the loan being
  // refinanced, and possibly on earlier loans in the same refinancing chain
  // too). Letting a check like this one see that reused number would always
  // reject it. The DB's own partial unique index
  // (ScopePromissoryNoteNumberUniquenessToActiveLoans — WHERE status =
  // 'active' AND deleted_at IS NULL) is what actually allows that legitimate
  // repetition to be stored, and remains the last-resort guard against a
  // concurrent double-refinance race — independent of this check, so
  // relaxing this check can never let two loans be simultaneously active
  // under the same number.
  private async assertPromissoryNoteNumberIsUnique(
    promissoryNoteNumber: string,
    loansRepository: Repository<Loan>,
  ): Promise<void> {
    const existing = await loansRepository.findOne({
      where: { promissoryNoteNumber },
    });
    if (existing) {
      throw new ConflictException(
        `A loan with promissory note number ${promissoryNoteNumber} already exists`,
      );
    }
  }

  // Bug fix, 2026-09-09 — when firstInstallmentDueDate is given, it's the
  // exact date the admin entered for the schedule's own (unshifted)
  // installment 1, and every other installment is anchored on THAT date
  // instead of disbursedAt — see PersistLoanParams.firstInstallmentDueDate
  // for why disbursedAt alone can no longer be trusted to carry the
  // correct day-of-month once it's been back-computed from a due date.
  // Falls back to the old disbursedAt-based formula when omitted (e.g.
  // LoanImportService, whose disbursedAt is a real, not back-computed,
  // date).
  private calculateDueDate(
    disbursedAt: string,
    frequency: InstallmentFrequency,
    installmentNumber: number,
    firstInstallmentDueDate?: string,
  ): string {
    if (firstInstallmentDueDate) {
      if (installmentNumber === 1) {
        return firstInstallmentDueDate;
      }
      return frequency === InstallmentFrequency.Monthly
        ? addMonthsToDateString(firstInstallmentDueDate, installmentNumber - 1)
        : addWeeksToDateString(
            firstInstallmentDueDate,
            (installmentNumber - 1) * 2,
          );
    }
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

// See calculateInterestTrueUpBreakdown — the per-installment share goes into
// that row, only the remainder is carried as the quote-level interestTrueUp.
function trueUpOptions(trueUp: InterestTrueUpBreakdown): {
  interestTrueUp: number;
  interestTrueUpByInstallment: Map<number, number>;
} {
  return {
    interestTrueUp: trueUp.unattributed,
    interestTrueUpByInstallment: trueUp.attributedByInstallmentNumber,
  };
}

// Style cleanup, 2026-09-04 — now takes ALL of an installment's concepts
// (not just moratorio) so calculatePayoff() can also build its display-only
// conceptBreakdown (see that file's own comment); corriente/moratorio are
// split here, same filtering enrichInstallment.ts already does for the
// exact same rows.
// totalPaid (bug fix, 2026-09-15) — see PayoffInstallmentInput.totalPaid's
// own comment; defaults to 0 for a not-yet-fetched figure, but every
// caller below now passes the real one via sumPaymentsByInstallmentId.
// periodStartDate (human correction, 2026-09-30) — see
// PayoffInstallmentInput.periodStartDate's own comment; every caller below
// computes it via buildPeriodStartDates.
function toPayoffInstallmentInput(
  installment: Installment,
  concepts: LoanInstallmentConcept[] = [],
  totalPaid = 0,
  periodStartDate = installment.dueDate,
): PayoffInstallmentInput {
  const corrienteConcepts = concepts.filter(
    (concept) => concept.category === ConceptCategory.Corriente,
  );
  const moratoryConcepts = concepts.filter(
    (concept) => concept.category === ConceptCategory.Moratorio,
  );
  return {
    installmentId: installment.id,
    installmentNumber: installment.installmentNumber,
    amount: installment.amount,
    principalPortion: installment.principalPortion,
    dueDate: installment.dueDate,
    periodStartDate,
    moratoryConcepts: moratoryConcepts.map((concept) => ({
      name: concept.nameSnapshot,
      calculationType: concept.calculationType,
      value: concept.value,
    })),
    corrienteConcepts: corrienteConcepts.map((concept) => ({
      name: concept.nameSnapshot,
      amount: concept.computedAmount,
    })),
    totalPaid,
  };
}

// Human correction, 2026-09-30 — see INTEREST_ACCRUAL_GRACE_DAYS's own
// comment for the full story. An installment's period "starts" when the
// PREVIOUS installment (in installmentNumber order, cuota inicial
// included) becomes due — or, for the very first installment on the loan,
// when it was disbursed. Built from the loan's FULL installment list (not
// just pending ones), so a pending installment's period start can
// correctly be a PAID installment's due date.
function buildPeriodStartDates(
  installments: { installmentNumber: number; dueDate: string }[],
  disbursedAt: string,
): Map<number, string> {
  const sorted = [...installments].sort(
    (a, b) => a.installmentNumber - b.installmentNumber,
  );
  const periodStartDates = new Map<number, string>();
  let previousDueDate = disbursedAt;
  for (const installment of sorted) {
    periodStartDates.set(installment.installmentNumber, previousDueDate);
    previousDueDate = installment.dueDate;
  }
  return periodStartDates;
}

function compareClientFullNames(a: Loan, b: Loan): number {
  return `${a.client.firstName} ${a.client.lastName}`.localeCompare(
    `${b.client.firstName} ${b.client.lastName}`,
    'es',
  );
}

// The label the loans list shows in its Estado column — mirrors the
// frontend's estadoBadge() (loanStatusDisplay.ts) so sorting by "Estado"
// orders by what is on screen ("Al día" < "En mora" < "Pagado" <
// "Refinanciado"), not by the raw enum value.
function loanStatusLabel(loan: {
  status: LoanStatus;
  overdueDays: number;
}): string {
  if (loan.status === LoanStatus.Paid) {
    return 'Pagado';
  }
  if (loan.status === LoanStatus.Refinanced) {
    return 'Refinanciado';
  }
  return loan.overdueDays > 0 ? 'En mora' : 'Al día';
}

function compareLoanSummariesByColumn(
  a: LoanSummary,
  b: LoanSummary,
  column: 'outstandingBalance' | 'overdueDays' | 'status',
): number {
  switch (column) {
    case 'outstandingBalance':
      return a.outstandingBalance - b.outstandingBalance;
    case 'overdueDays':
      return a.overdueDays - b.overdueDays;
    case 'status':
      return loanStatusLabel(a).localeCompare(loanStatusLabel(b), 'es');
  }
}

// Moved to promissoryNoteNumberSort.ts (2026-09-15) so the overdue-
// installments Excel report can reuse the identical numeric-aware sort —
// same two-level ORDER BY as the previous query builder, unchanged.
function compareLoansByPromissoryNoteNumber(a: Loan, b: Loan): number {
  return comparePromissoryNoteNumbers(
    a.promissoryNoteNumber,
    b.promissoryNoteNumber,
  );
}
