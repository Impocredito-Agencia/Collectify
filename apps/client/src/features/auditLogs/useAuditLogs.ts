import { useQuery } from '@tanstack/react-query';

import { auditLogsApi } from '@/features/auditLogs/auditLogsApi';

import type { AuditLogsQueryParams } from '@/features/auditLogs/auditLogsApi';

export function useAuditLogs(params: AuditLogsQueryParams) {
  return useQuery({
    queryKey: ['auditLogs', params],
    queryFn: () => auditLogsApi.getAll(params),
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
