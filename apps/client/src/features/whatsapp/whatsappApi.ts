import { apiClient } from '@/lib/apiClient';

import type { MessageLog } from '@/features/messageLogs/messageLogsApi';
import type { MessageTemplate } from '@/features/messageTemplates/messageTemplatesApi';

// Matches apps/api/src/whatsapp/reminderFamily.ts — Phase 33 replaced the
// old per-MessageType cron jobs (one each for new_loan/upcoming_due/
// overdue/account_summary) with one job per FAMILY, since "vencida" now
// spans 4 templates and "próxima a vencer" spans 2. NewLoan restored
// 2026-09-09 (confirmed with the human) — payment-confirmation/paid-in-full
// templates are the only ones left with no cron job, still sent
// synchronously at their triggering event. See
// docs/phases/PHASE_33_MESSAGE_TEMPLATES_V2.md.
export enum ReminderFamily {
  Overdue = 'overdue',
  UpcomingDue = 'upcoming_due',
  NewLoan = 'new_loan',
  CreditReport = 'credit_report',
}

// Matches apps/api/src/whatsapp/whatsapp.controller.ts's
// /whatsapp/cron/:family/* routes.
export const whatsappApi = {
  getCronStatus: async (
    family: ReminderFamily,
  ): Promise<{ running: boolean }> => {
    const { data } = await apiClient.get<{ running: boolean }>(
      `/whatsapp/cron/${family}/status`,
    );
    return data;
  },

  pauseCron: async (family: ReminderFamily): Promise<void> => {
    await apiClient.post<{ paused: true }>(`/whatsapp/cron/${family}/pause`);
  },

  resumeCron: async (family: ReminderFamily): Promise<void> => {
    await apiClient.post<{ paused: false }>(`/whatsapp/cron/${family}/resume`);
  },

  // Persists on the family's "schedule owner" MessageTemplate row
  // (SingleOverdueInstallment / SingleUpcomingInstallment) and reschedules
  // the running job immediately, no restart needed. Returns that owner row.
  updateCronSchedule: async (
    family: ReminderFamily,
    cronExpression: string,
  ): Promise<MessageTemplate> => {
    const { data } = await apiClient.patch<MessageTemplate>(
      `/whatsapp/cron/${family}/schedule`,
      { cronExpression },
    );
    return data;
  },

  // Same grouping/rendering as the weekly job, triggered on demand for one
  // client. 400 if the client has no overdue installments. Returns one
  // MessageLog per phone number on file for the client (human report,
  // 2026-09-19 — see Client.alternatePhoneNumber).
  sendReminder: async (clientId: string): Promise<MessageLog[]> => {
    const { data } = await apiClient.post<MessageLog[]>(
      `/whatsapp/clients/${clientId}/send-reminder`,
    );
    return data;
  },

  // 400 if the client has no installments approaching due date across
  // their active loans. Returns one MessageLog per phone number on file.
  sendUpcomingDueReminder: async (clientId: string): Promise<MessageLog[]> => {
    const { data } = await apiClient.post<MessageLog[]>(
      `/whatsapp/clients/${clientId}/send-upcoming-due`,
    );
    return data;
  },
};
