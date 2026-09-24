import { apiClient } from '@/lib/apiClient';

// Matches apps/api/src/auditLog/entities/auditLog.entity.ts. GET
// /audit-logs relations-loads actorUser (not just actorUserId), same
// treatment GET /message-logs gives `client`.
export interface AuditLog {
  id: string;
  actorUserId: string | null;
  actorUser: {
    id: string;
    fullName: string;
    email: string;
  } | null;
  action: string;
  entityType: string;
  entityId: string | null;
  // Human-readable snapshot of the specific record — "Juana Pérez (CC
  // 1234567890)", "Pagaré #743" — resolved once at write time by the
  // backend's AuditLogInterceptor and frozen, not re-derived from the
  // live record on read. Null for an entityType with no labeling rule
  // yet, or an entity the backend couldn't resolve enough fields for.
  entityLabel: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface AuditLogsQueryParams {
  // Free text — client name/cédula/phone or pagaré number, several words
  // allowed ("Juana 0928"). The backend also returns the entries of that
  // client's/pagaré's loans, installments and payments, not just entries
  // whose label mentions the words. See AuditLogService.findAll.
  search?: string;
  actorUserId?: string;
  action?: string;
  entityType?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  limit?: number;
}

export interface AuditActor {
  id: string;
  fullName: string;
}

export interface AuditActionOption {
  action: string;
  entityType: string;
}

export interface PaginatedAuditLogs {
  items: AuditLog[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export const auditLogsApi = {
  getAll: async (
    params: AuditLogsQueryParams = {},
  ): Promise<PaginatedAuditLogs> => {
    const { data, meta } = await apiClient.get<AuditLog[]>('/audit-logs', {
      search: params.search,
      actorUserId: params.actorUserId,
      action: params.action,
      entityType: params.entityType,
      dateFrom: params.dateFrom,
      dateTo: params.dateTo,
      page: params.page,
      limit: params.limit,
    });
    return { items: data, meta: meta as PaginatedAuditLogs['meta'] };
  },

  // Users who appear in the trail — feeds the "Usuario" filter.
  getActors: async (): Promise<AuditActor[]> => {
    const { data } = await apiClient.get<AuditActor[]>('/audit-logs/actors');
    return data;
  },

  // Distinct actions actually logged, each with its entity type — feeds the
  // "Acción"/"Entidad" filters.
  getActions: async (): Promise<AuditActionOption[]> => {
    const { data } = await apiClient.get<AuditActionOption[]>(
      '/audit-logs/actions',
    );
    return data;
  },
};
