import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { dashboardApi } from '@/features/dashboard/dashboardApi';

import type { OverdueClientsQueryParams } from '@/features/dashboard/dashboardApi';

export function useDashboardSummary() {
  return useQuery({
    queryKey: ['dashboard', 'summary'],
    queryFn: dashboardApi.getSummary,
  });
}

export function useOverdueClients(params: OverdueClientsQueryParams) {
  return useQuery({
    queryKey: ['dashboard', 'overdue-clients', params],
    queryFn: () => dashboardApi.getOverdueClients(params),
    // Human report, 2026-09-27 — keeps the previous page on screen while a
    // new one loads instead of flashing "Cargando…" and losing the pager;
    // see useClients.ts's identical fix for the full explanation.
    placeholderData: keepPreviousData,
  });
}

// Not currently called anywhere — see dashboardApi.ts's getMonthlyReport
// comment. Left in place in case the "Reporte mensual" section comes back.
export function useMonthlyReport(month: number, year: number) {
  return useQuery({
    queryKey: ['dashboard', 'monthly-report', month, year],
    queryFn: () => dashboardApi.getMonthlyReport(month, year),
  });
}
