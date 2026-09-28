import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { auditLogsApi } from '@/features/auditLogs/auditLogsApi';

import type { AuditLogsQueryParams } from '@/features/auditLogs/auditLogsApi';

export function useAuditLogs(params: AuditLogsQueryParams) {
  return useQuery({
    queryKey: ['auditLogs', params],
    queryFn: () => auditLogsApi.getAll(params),
    // Human report, 2026-09-27 — keeps the previous page on screen while a
    // new one loads instead of flashing "Cargando…" and losing the pager;
    // see useClients.ts's identical fix for the full explanation.
    placeholderData: keepPreviousData,
  });
}

export function useAuditActors() {
  return useQuery({
    queryKey: ['auditLogs', 'actors'],
    queryFn: () => auditLogsApi.getActors(),
  });
}

export function useAuditActions() {
  return useQuery({
    queryKey: ['auditLogs', 'actions'],
    queryFn: () => auditLogsApi.getActions(),
  });
}
