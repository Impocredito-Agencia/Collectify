import { apiClient } from '@/lib/apiClient';
import { MessageType } from '@/features/messageTemplates/messageTemplatesApi';

// Matches apps/api/src/whatsapp/entities/messageLog.entity.ts's
// MessageLogStatus — only whether the initial send API call succeeded or
// not, synchronously, at send time. Distinct from WhatsappDeliveryStatus
// below, which is Meta's later delivery-status webhook callback (added
// 2026-09-16, human report — see that enum's own comment).
export enum MessageLogStatus {
  Sent = 'sent',
  Failed = 'failed',
}

// Matches apps/api/src/whatsapp/whatsappDeliveryStatus.enum.ts. Meta's
// per-message webhook callback — null on MessageLog/WhatsappManualReply
// means no callback has been received (yet, or ever) for that send.
export enum WhatsappDeliveryStatus {
  Sent = 'sent',
  Delivered = 'delivered',
  Read = 'read',
  Failed = 'failed',
}

// GET /message-logs now leftJoinAndSelects `client` (added this phase) so
// the list can show a name instead of a bare clientId — comes back as a
// nested object, not a flattened clientFullName like LoanSummary.
export interface MessageLog {
  id: string;
  clientId: string;
  client: {
    id: string;
    firstName: string;
    lastName: string;
  };
  type: MessageType;
  phoneNumber: string;
  messageContent: string;
  // Human report, 2026-10-09 — the cuota-by-cuota desglose behind a
  // reminder that covers several cuotas, snapshotted at send time.
  // Internal: never part of what the client received. Null for every
  // other message and for rows sent before this existed.
  breakdownContent: string | null;
  status: MessageLogStatus;
  sentAt: string;
  whatsappMessageId: string | null;
  // Added 2026-09-16 — Meta's delivery-status webhook callback, applied
  // once a matching WAMID arrives. deliveryStatus null means no callback
  // has been received yet (or ever) for this send.
  deliveryStatus: WhatsappDeliveryStatus | null;
  deliveryStatusUpdatedAt: string | null;
  lastErrorCode: number | null;
  lastErrorTitle: string | null;
  // Phase 18 manual retry tracking — retriedAt is set on the ORIGINAL
  // (failed) row once it's retried; retryOfMessageLogId is set on the NEW
  // row created for that retry, pointing back at the original. Both null
  // on rows never retried.
  retriedAt: string | null;
  retryOfMessageLogId: string | null;
  createdAt: string;
}

export interface MessageLogsQueryParams {
  clientId?: string;
  type?: MessageType;
  status?: MessageLogStatus;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export interface PaginatedMessageLogs {
  items: MessageLog[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// GET /message-logs/:id/items — matches
// apps/api/src/whatsapp/entities/messageLogItem.entity.ts. Added this phase
// (announced first): backs the "Mensaje completo" drawer's related-
// installments section. A single overdue reminder can cover several
// installments across several loans (consolidated per client), so this is
// a list, not Figma's single "Préstamo relacionado" line.
export interface MessageLogItem {
  id: string;
  messageLogId: string;
  installmentId: string;
  installment: {
    id: string;
    installmentNumber: number;
    loanId: string;
    loan: {
      id: string;
      promissoryNoteNumber: string;
    };
  };
  overdueDaysSnapshot: number;
  interestSnapshot: number;
  createdAt: string;
}

export const messageLogsApi = {
  // Fase 9: type is now an optional filter instead of always forced to
  // Overdue — undefined means "all types", matching GET /message-logs's
  // own optional `type` query param.
  getAll: async (
    params: MessageLogsQueryParams = {},
  ): Promise<PaginatedMessageLogs> => {
    const { data, meta } = await apiClient.get<MessageLog[]>('/message-logs', {
      clientId: params.clientId,
      type: params.type,
      status: params.status,
      dateFrom: params.dateFrom,
      dateTo: params.dateTo,
      search: params.search,
      page: params.page,
      limit: params.limit,
    });
    return { items: data, meta: meta as PaginatedMessageLogs['meta'] };
  },

  getItems: async (id: string): Promise<MessageLogItem[]> => {
    const { data } = await apiClient.get<MessageLogItem[]>(
      `/message-logs/${id}/items`,
    );
    return data;
  },

  // Phase 18 — admin-only server-side. 400 if the log isn't Failed.
  retry: async (id: string): Promise<MessageLog> => {
    const { data } = await apiClient.post<MessageLog>(
      `/message-logs/${id}/retry`,
    );
    return data;
  },
};
