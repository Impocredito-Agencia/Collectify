import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { PaginatedResult } from '../common/interfaces/paginatedResult.interface';

import {
  DashboardService,
  DashboardSummary,
  MonthlyReport,
  OverdueClientSummary,
} from './dashboard.service';
import { MonthlyReportQueryDto } from './dto/monthlyReportQuery.dto';
import { QueryOverdueClientsDto } from './dto/queryOverdueClients.dto';

@ApiTags('dashboard')
@ApiBearerAuth()
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('summary')
  @ApiOperation({
    summary: 'At-a-glance portfolio summary',
    description:
      'totalActiveClients counts clients with at least one active loan (deduped by client). ' +
      'totalActiveLoans counts active loans directly, so a client with two active loans counts once ' +
      'toward totalActiveClients but twice here. totalOutstandingPrincipal sums remaining principal ' +
      "(not original principalAmount) across every active loan's pending installments. " +
      'totalAmountOverdue reuses the Phase 4 overdue/interest formula per installment (calculated on ' +
      'read, never stored). overdueRate is totalAmountOverdue / totalOutstandingPrincipal as a percentage ' +
      '(1 decimal), a simple at-a-glance ratio rather than a formal delinquency-rate calculation. ' +
      'upcomingDueInstallments counts pending installments due today through today+5 (inclusive), a ' +
      'continuous window distinct from the specific 5/3/1-day WhatsApp reminder trigger days. ' +
      'messagesSentThisWeek/messagesFailedThisWeek are scoped to the current calendar week ' +
      '(Monday-Sunday), matching the weekly reminder cron.',
  })
  @ApiResponse({ status: 200, description: 'Returns the summary numbers.' })
  getSummary(): Promise<DashboardSummary> {
    return this.dashboardService.getSummary();
  }

  @Get('overdue-clients')
  @ApiOperation({
    summary: 'Paginated list of clients with at least one overdue installment',
    description:
      'Sortable by totalOverdueAmount or maxOverdueDays (descending). Each row aggregates across every ' +
      "overdue installment on the client's active loans.",
  })
  @ApiResponse({
    status: 200,
    description: 'Returns a page of overdue clients.',
  })
  getOverdueClients(
    @Query() query: QueryOverdueClientsDto,
  ): Promise<PaginatedResult<OverdueClientSummary>> {
    return this.dashboardService.getOverdueClients(query);
  }

  @Get('monthly-report')
  @ApiOperation({
    summary: 'Monthly report: new loans disbursed, payments, messages sent',
    description:
      'month/year scope the report to that calendar month (inclusive boundaries).',
  })
  @ApiResponse({ status: 200, description: 'Returns the monthly report.' })
  getMonthlyReport(
    @Query() query: MonthlyReportQueryDto,
  ): Promise<MonthlyReport> {
    return this.dashboardService.getMonthlyReport(query);
  }
}
