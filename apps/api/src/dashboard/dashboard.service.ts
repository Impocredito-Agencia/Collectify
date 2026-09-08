import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { endOfWeek, startOfWeek } from 'date-fns';
import { Between, LessThan, Repository } from 'typeorm';

import { PaginatedResult } from '../common/interfaces/paginatedResult.interface';
import { addDaysToDateString, todayDateString } from '../loans/dueDateSchedule';
import {
  Installment,
  InstallmentStatus,
} from '../loans/entities/installment.entity';
import { Loan, LoanStatus } from '../loans/entities/loan.entity';
import { Payment } from '../loans/entities/payment.entity';
import { enrichInstallment } from '../loans/installments/enrichInstallment';
import { sumPaymentsByInstallmentId } from '../loans/installments/paymentTotals';
import {
  MessageLog,
  MessageLogStatus,
} from '../whatsapp/entities/messageLog.entity';

import { MonthlyReportQueryDto } from './dto/monthlyReportQuery.dto';
import {
  OverdueClientsSortBy,
  QueryOverdueClientsDto,
} from './dto/queryOverdueClients.dto';
import { monthBoundaries } from './monthBoundaries';

const DEFAULT_PAGE = 1;
// 50, matching clients.service.ts's DEFAULT_PAGE_SIZE — style cleanup
// 2026-09-05 brought the rest of the app's large tables (this one, loans,
// messageLogs, auditLog) up to the same 50/page + 5-window pager Clientes
// already had, instead of leaving them at the old 20/page default.
const DEFAULT_PAGE_SIZE = 50;
const WEEK_STARTS_ON_MONDAY = 1;
// Matches upcomingDueReminderDays (5 by default — see
// config/configuration.ts), so "cuotas por vencer" on this KPI lines up
// with the WhatsApp reminder window, rather than being an arbitrary
// different number. Kept as its own constant rather than importing the
// cron config here — this predates 2026-09-07's rework of that config from
// three exact trigger days (5,3,1) to a single cumulative-window size, and
// the two happen to describe the exact same "continuous window (today
// through today+5)" concept now, purely coincidentally.
const UPCOMING_DUE_WINDOW_DAYS = 5;

export interface DashboardSummary {
  totalActiveClients: number;
  totalActiveLoans: number;
  // Sum of remaining principal (principalPortion, or amount when null —
  // same legacy fallback used everywhere else) across every pending
  // installment on an active loan. NOT the same as summing each loan's
  // original principalAmount: this reflects paydowns already made. Doesn't
  // need calculatePayoff()'s full engine — principalApplied there is
  // always principalPortion regardless of an installment's maturity, so
  // this is just that same sum without the interest-rate machinery.
  totalOutstandingPrincipal: number;
  totalOverdueInstallments: number;
  // Pending installments on an active loan due today through
  // today+UPCOMING_DUE_WINDOW_DAYS (inclusive both ends) — a "call these
  // clients before they're overdue" count, deliberately not overlapping
  // totalOverdueInstallments (that one is strictly dueDate < today).
  upcomingDueInstallments: number;
  totalAmountOverdue: number;
  // totalAmountOverdue (which includes accrued interest/moratory charges,
  // not just principal) divided by totalOutstandingPrincipal (principal
  // only) — a deliberately simple "how much of what's out there is
  // currently overdue" ratio for an at-a-glance KPI, not a formal
  // delinquency-rate calculation. 0 when there's no active portfolio.
  // Rounded to 1 decimal. Flagged for the human to weigh in on if a
  // stricter definition (e.g. overdue principal / total principal) is
  // wanted instead.
  overdueRate: number;
  messagesSentThisWeek: number;
  messagesFailedThisWeek: number;
}

export interface OverdueClientSummary {
  clientId: string;
  firstName: string;
  lastName: string;
  totalOverdueAmount: number;
  overdueInstallmentsCount: number;
  maxOverdueDays: number;
}

export interface MonthlyReport {
  month: number;
  year: number;
  newLoansDisbursed: number;
  totalPaymentsReceived: number;
  messagesSent: number;
}

@Injectable()
export class DashboardService {
  constructor(
    @InjectRepository(Loan)
    private readonly loansRepository: Repository<Loan>,
    @InjectRepository(Installment)
    private readonly installmentsRepository: Repository<Installment>,
    @InjectRepository(Payment)
    private readonly paymentsRepository: Repository<Payment>,
    @InjectRepository(MessageLog)
    private readonly messageLogsRepository: Repository<MessageLog>,
  ) {}

  async getSummary(): Promise<DashboardSummary> {
    const [
      totalActiveClients,
      totalActiveLoans,
      totalOutstandingPrincipal,
      overdueInstallments,
      upcomingDueInstallments,
      messagesSentThisWeek,
      messagesFailedThisWeek,
    ] = await Promise.all([
      this.countActiveClients(),
      this.countActiveLoans(),
      this.sumOutstandingPrincipal(),
      this.gatherOverdueInstallments(),
      this.countUpcomingDueInstallments(),
      this.countMessagesSentThisWeek(),
      this.countMessagesFailedThisWeek(),
    ]);

    const totalAmountOverdue = overdueInstallments.reduce(
      (sum, installment) => sum + installment.totalDue,
      0,
    );

    return {
      totalActiveClients,
      totalActiveLoans,
      totalOutstandingPrincipal,
      totalOverdueInstallments: overdueInstallments.length,
      upcomingDueInstallments,
      totalAmountOverdue,
      overdueRate:
        totalOutstandingPrincipal > 0
          ? Math.round(
              (totalAmountOverdue / totalOutstandingPrincipal) * 1000,
            ) / 10
          : 0,
      messagesSentThisWeek,
      messagesFailedThisWeek,
    };
  }

  async getOverdueClients(
    query: QueryOverdueClientsDto,
  ): Promise<PaginatedResult<OverdueClientSummary>> {
    const page = query.page ?? DEFAULT_PAGE;
    const limit = query.limit ?? DEFAULT_PAGE_SIZE;
    const sortBy = query.sortBy ?? OverdueClientsSortBy.TotalOverdueAmount;

    const overdueInstallments = await this.gatherOverdueInstallments();

    const byClient = new Map<string, OverdueClientSummary>();
    for (const installment of overdueInstallments) {
      const existing = byClient.get(installment.clientId);
      if (existing) {
        existing.totalOverdueAmount += installment.totalDue;
        existing.overdueInstallmentsCount += 1;
        existing.maxOverdueDays = Math.max(
          existing.maxOverdueDays,
          installment.overdueDays,
        );
      } else {
        byClient.set(installment.clientId, {
          clientId: installment.clientId,
          firstName: installment.clientFirstName,
          lastName: installment.clientLastName,
          totalOverdueAmount: installment.totalDue,
          overdueInstallmentsCount: 1,
          maxOverdueDays: installment.overdueDays,
        });
      }
    }

    const rows = Array.from(byClient.values()).sort(
      (a, b) => b[sortBy] - a[sortBy],
    );

    const total = rows.length;
    const start = (page - 1) * limit;

    return {
      items: rows.slice(start, start + limit),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async getMonthlyReport(query: MonthlyReportQueryDto): Promise<MonthlyReport> {
    const { start, end } = monthBoundaries(query.year, query.month);

    const [newLoansDisbursed, totalPaymentsReceived, messagesSent] =
      await Promise.all([
        this.loansRepository.count({
          where: { disbursedAt: Between(start, end) },
        }),
        this.sumPaymentsBetween(start, end),
        this.messageLogsRepository.count({
          where: {
            sentAt: Between(
              new Date(`${start}T00:00:00.000Z`),
              new Date(`${end}T23:59:59.999Z`),
            ),
          },
        }),
      ]);

    return {
      month: query.month,
      year: query.year,
      newLoansDisbursed,
      totalPaymentsReceived,
      messagesSent,
    };
  }

  // Every overdue-installment aggregate (summary, overdue-clients list) is
  // built from this same fetch — mirrors the grouping query in
  // OverdueReminderService and reuses enrichInstallment's formula instead
  // of reimplementing it, per docs/phases/PHASE_7_DASHBOARD.md.
  //
  // Bug fix, 2026-09-06 — `today` used to be raw `new Date().toISOString()
  // .slice(0, 10)`, the UTC calendar date, which is a day ahead of
  // Bogotá's for roughly 5 hours every day (UTC 00:00-05:00, i.e.
  // 7pm-midnight in Bogotá) — the same root cause already fixed in
  // dueDateSchedule.ts's todayDateString() and reused by the WhatsApp
  // reminder services, but never propagated here. During that window this
  // filter's `today` was a day too late, so an installment due "today" in
  // Bogotá was already being counted as overdue (dueDate < today) a full
  // day early — inconsistent with enrichInstallment's own overdueDays
  // calculation just below, which was always correctly Bogotá-aware.
  private async gatherOverdueInstallments(): Promise<
    Array<{
      clientId: string;
      clientFirstName: string;
      clientLastName: string;
      totalDue: number;
      overdueDays: number;
    }>
  > {
    const today = todayDateString();

    const installments = await this.installmentsRepository.find({
      where: {
        status: InstallmentStatus.Pending,
        dueDate: LessThan(today),
        loan: { status: LoanStatus.Active },
      },
      relations: { loan: { client: true } },
    });
    // Bug fix, 2026-09-07 — see enrichInstallment.ts's `totalPaid` param and
    // docs/DATABASE.md's note of this date: without this, an overdue
    // installment that already had a partial payment registered on it still
    // counted its full original totalDue here, overstating the Dashboard's
    // "cuotas vencidas" total and every overdue client's totalOverdueAmount.
    const totalPaidByInstallmentId = await sumPaymentsByInstallmentId(
      this.paymentsRepository,
      installments.map((installment) => installment.id),
    );

    return installments.map((installment) => {
      const enriched = enrichInstallment(
        installment,
        installment.loan.interestRate,
        [],
        totalPaidByInstallmentId.get(installment.id) ?? 0,
      );
      return {
        clientId: installment.loan.clientId,
        clientFirstName: installment.loan.client.firstName,
        clientLastName: installment.loan.client.lastName,
        totalDue: enriched.totalDue,
        overdueDays: enriched.overdueDays,
      };
    });
  }

  // Continuous [today, today+5] window, not the specific 5/3/1 reminder
  // trigger days — see UPCOMING_DUE_WINDOW_DAYS's own comment.
  //
  // Bug fix, 2026-09-06 — same root cause as gatherOverdueInstallments
  // above: `today`/`windowEnd` used to be built from raw
  // `new Date().toISOString().slice(0, 10)`, the UTC calendar date, wrong
  // for ~5 hours a day in Bogotá. Switched to todayDateString() +
  // addDaysToDateString(), the same Bogotá-aware helpers the WhatsApp
  // reminder services already use for this exact window calculation.
  private countUpcomingDueInstallments(): Promise<number> {
    const today = todayDateString();
    const windowEnd = addDaysToDateString(today, UPCOMING_DUE_WINDOW_DAYS);

    return this.installmentsRepository.count({
      where: {
        status: InstallmentStatus.Pending,
        dueDate: Between(today, windowEnd),
        loan: { status: LoanStatus.Active },
      },
    });
  }

  private async countActiveClients(): Promise<number> {
    const activeLoans = await this.loansRepository.find({
      where: { status: LoanStatus.Active },
      select: { clientId: true },
    });

    return new Set(activeLoans.map((loan) => loan.clientId)).size;
  }

  // Count of loans (not clients) currently being collected — distinct from
  // totalActiveClients above, which dedupes by client and can undercount
  // when a client has more than one active loan.
  private countActiveLoans(): Promise<number> {
    return this.loansRepository.count({ where: { status: LoanStatus.Active } });
  }

  // See totalOutstandingPrincipal's own comment above for why this doesn't
  // need calculatePayoff() — principalApplied there is always
  // principalPortion (or amount, its legacy fallback) regardless of an
  // installment's maturity, so summing that directly gives the identical
  // number without the interest-rate/moratory-concept machinery.
  private async sumOutstandingPrincipal(): Promise<number> {
    const pendingInstallments = await this.installmentsRepository.find({
      where: {
        status: InstallmentStatus.Pending,
        loan: { status: LoanStatus.Active },
      },
      relations: { loan: true },
    });

    return pendingInstallments.reduce(
      (sum, installment) =>
        sum + (installment.principalPortion ?? installment.amount),
      0,
    );
  }

  private async countMessagesSentThisWeek(): Promise<number> {
    const now = new Date();
    return this.messageLogsRepository.count({
      where: {
        sentAt: Between(
          startOfWeek(now, { weekStartsOn: WEEK_STARTS_ON_MONDAY }),
          endOfWeek(now, { weekStartsOn: WEEK_STARTS_ON_MONDAY }),
        ),
      },
    });
  }

  // Same weekly window as countMessagesSentThisWeek, filtered to Failed —
  // sentAt is set on every attempt regardless of outcome (see
  // MessageLog.sentAt's own comment), so this is a genuine subset of that
  // count, not a separate population. Note messagesSentThisWeek itself
  // currently has no status filter, so it actually counts every attempt
  // (sent + failed) this week — a pre-existing naming quirk, left alone
  // here since fixing it wasn't part of this change.
  private async countMessagesFailedThisWeek(): Promise<number> {
    const now = new Date();
    return this.messageLogsRepository.count({
      where: {
        status: MessageLogStatus.Failed,
        sentAt: Between(
          startOfWeek(now, { weekStartsOn: WEEK_STARTS_ON_MONDAY }),
          endOfWeek(now, { weekStartsOn: WEEK_STARTS_ON_MONDAY }),
        ),
      },
    });
  }

  private async sumPaymentsBetween(
    start: string,
    end: string,
  ): Promise<number> {
    const payments = await this.paymentsRepository.find({
      where: { paidAt: Between(start, end) },
      select: { amountPaid: true },
    });

    return payments.reduce((sum, payment) => sum + payment.amountPaid, 0);
  }
}
