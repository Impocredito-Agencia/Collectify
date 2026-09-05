import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { endOfWeek, startOfWeek } from 'date-fns';
import { Between, LessThan, Repository } from 'typeorm';

import { PaginatedResult } from '../common/interfaces/paginatedResult.interface';
import {
  Installment,
  InstallmentStatus,
} from '../loans/entities/installment.entity';
import { Loan, LoanStatus } from '../loans/entities/loan.entity';
import { Payment } from '../loans/entities/payment.entity';
import { enrichInstallment } from '../loans/installments/enrichInstallment';
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
// Matches the longest lead time in upcomingDueReminderDays ([5,3,1] by
// default — see config/configuration.ts), so "cuotas por vencer" on this
// KPI lines up with when the first WhatsApp reminder would actually go
// out, rather than being an arbitrary different number. Unlike that
// config's specific trigger days, this is a continuous window (today
// through today+5), not just the exact 5/3/1-day marks — a dashboard count
// should include every cuota in that stretch, not only the ones landing on
// a reminder day.
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
  private async gatherOverdueInstallments(): Promise<
    Array<{
      clientId: string;
      clientFirstName: string;
      clientLastName: string;
      totalDue: number;
      overdueDays: number;
    }>
  > {
    const today = new Date().toISOString().slice(0, 10);

    const installments = await this.installmentsRepository.find({
      where: {
        status: InstallmentStatus.Pending,
        dueDate: LessThan(today),
        loan: { status: LoanStatus.Active },
      },
      relations: { loan: { client: true } },
    });

    return installments.map((installment) => {
      const enriched = enrichInstallment(
        installment,
        installment.loan.interestRate,
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
  private countUpcomingDueInstallments(): Promise<number> {
    const today = new Date();
    const windowEnd = new Date(today);
    windowEnd.setDate(windowEnd.getDate() + UPCOMING_DUE_WINDOW_DAYS);

    return this.installmentsRepository.count({
      where: {
        status: InstallmentStatus.Pending,
        dueDate: Between(
          today.toISOString().slice(0, 10),
          windowEnd.toISOString().slice(0, 10),
        ),
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
