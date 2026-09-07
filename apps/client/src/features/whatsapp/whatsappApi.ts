import { apiClient } from '@/lib/apiClient';

import type { MessageLog } from '@/features/messageLogs/messageLogsApi';
import type { MessageTemplate } from '@/features/messageTemplates/messageTemplatesApi';

// Matches apps/api/src/whatsapp/reminderFamily.ts — Phase 33 replaced the
// old per-MessageType cron jobs (one each for new_loan/upcoming_due/
// overdue/account_summary) with one job per FAMILY, since "vencida" now
// spans 4 templates and "próxima a vencer" spans 2. A NewLoan family
// briefly existed here (2026-09-06), reverted the same day — new-loan and
// refinance messages are sent synchronously at their triggering event
// (LoansService), same as payment-confirmation/paid-in-full, neither of
// which have ever had a cron job. See docs/phases/PHASE_33_MESSAGE_TEMPLATES_V2.md.
export enum ReminderFamily {
  Overdue = 'overdue',
  UpcomingDue = 'upcoming_due',
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
  // client. 400 if the client has no overdue installments.
  sendReminder: async (clientId: string): Promise<MessageLog> => {
    const { data } = await apiClient.post<MessageLog>(
      `/whatsapp/clients/${clientId}/send-reminder`,
    );
    return data;
  },

  // 400 if the client has no installments approaching due date across
  // their active loans.
  sendUpcomingDueReminder: async (clientId: string): Promise<MessageLog> => {
    const { data } = await apiClient.post<MessageLog>(
      `/whatsapp/clients/${clientId}/send-upcoming-due`,
    );
    return data;
  },
};
