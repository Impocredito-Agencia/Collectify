import { apiClient } from '@/lib/apiClient';

// Matches apps/api/src/dashboard/dashboard.service.ts's DashboardSummary
// exactly. totalAmountOverdue reuses the same per-installment formula as
// everywhere else (enrichInstallment) — calculated on read, never stored.
export interface DashboardSummary {
  totalActiveClients: number;
  totalActiveLoans: number;
  // Remaining principal (not original principalAmount) across every active
  // loan's pending installments — see dashboard.service.ts's own comment.
  totalOutstandingPrincipal: number;
  totalOverdueInstallments: number;
  // Pending installments due today through today+5 (inclusive) on an
  // active loan — see dashboard.service.ts's own comment.
  upcomingDueInstallments: number;
  totalAmountOverdue: number;
  // totalAmountOverdue / totalOutstandingPrincipal as a percentage (1
  // decimal) — a simple at-a-glance ratio, not a formal delinquency rate.
  overdueRate: number;
  messagesSentThisWeek: number;
  messagesFailedThisWeek: number;
}

// Matches apps/api/src/dashboard/dashboard.service.ts's OverdueClientSummary.
export interface OverdueClientSummary {
  clientId: string;
  firstName: string;
  lastName: string;
  totalOverdueAmount: number;
  overdueInstallmentsCount: number;
  maxOverdueDays: number;
}

export enum OverdueClientsSortBy {
  TotalOverdueAmount = 'totalOverdueAmount',
  MaxOverdueDays = 'maxOverdueDays',
}

export interface OverdueClientsQueryParams {
  sortBy?: OverdueClientsSortBy;
  page?: number;
  limit?: number;
}

export interface MonthlyReport {
  month: number;
  year: number;
  newLoansDisbursed: number;
  totalPaymentsReceived: number;
  messagesSent: number;
}

export interface PaginatedOverdueClients {
  items: OverdueClientSummary[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export const dashboardApi = {
  getSummary: async (): Promise<DashboardSummary> => {
    const { data } =
      await apiClient.get<DashboardSummary>('/dashboard/summary');
    return data;
  },

  getOverdueClients: async (
    params: OverdueClientsQueryParams = {},
  ): Promise<PaginatedOverdueClients> => {
    const { data, meta } = await apiClient.get<OverdueClientSummary[]>(
      '/dashboard/overdue-clients',
      {
        sortBy: params.sortBy,
        page: params.page,
        limit: params.limit,
      },
    );
    return { items: data, meta: meta as PaginatedOverdueClients['meta'] };
  },

  getMonthlyReport: async (
    month: number,
    year: number,
  ): Promise<MonthlyReport> => {
    const { data } = await apiClient.get<MonthlyReport>(
      '/dashboard/monthly-report',
      { month, year },
    );
    return data;
  },
};
