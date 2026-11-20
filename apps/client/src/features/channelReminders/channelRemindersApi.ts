import { apiClient } from '@/lib/apiClient';

import type { BrevoChannel } from '@/features/brevo/brevoApi';

// Matches apps/api's CHANNEL_REMINDER_FAMILIES — the reminder families that
// can also go out by email/SMS. Collection only: payment confirmations
// never do; new pagaré / refinance are pending the business's answer.
export enum ChannelReminderFamily {
  Overdue = 'overdue',
  UpcomingDue = 'upcoming_due',
  CreditReport = 'credit_report',
}

// Matches apps/api's MessageChannelSchedule.
export interface ChannelSchedule {
  id: string;
  family: ChannelReminderFamily;
  channel: BrevoChannel;
  cronExpression: string;
  isPaused: boolean;
  updatedAt: string;
}

// Matches apps/api's ChannelRecipient.
export interface ChannelRecipient {
  clientId: string;
  fullName: string;
  documentNumber: string;
  phoneNumber: string;
  email: string | null;
  // Null when nothing is overdue — listed only because a channel is on.
  maxOverdueDays: number | null;
  overdueInstallments: number;
  emailRemindersEnabled: boolean;
  smsRemindersEnabled: boolean;
}

export interface ChannelSelectionChange {
  emailRemindersEnabled?: boolean;
  smsRemindersEnabled?: boolean;
}

export interface BulkSelectionResult {
  updatedClientIds: string[];
  skippedWithoutEmail: { clientId: string; fullName: string }[];
}

interface ScheduleKey {
  family: ChannelReminderFamily;
  channel: BrevoChannel;
}

// All require the message_templates module server-side.
export const channelRemindersApi = {
  getSchedules: async (): Promise<ChannelSchedule[]> => {
    const { data } = await apiClient.get<ChannelSchedule[]>(
      '/message-channels/schedules',
    );
    return data;
  },

  reschedule: async ({
    family,
    channel,
    cronExpression,
  }: ScheduleKey & { cronExpression: string }): Promise<ChannelSchedule> => {
    const { data } = await apiClient.patch<ChannelSchedule>(
      `/message-channels/schedules/${family}/${channel}`,
      { cronExpression },
    );
    return data;
  },

  setPaused: async ({
    family,
    channel,
    isPaused,
  }: ScheduleKey & { isPaused: boolean }): Promise<ChannelSchedule> => {
    const { data } = await apiClient.post<ChannelSchedule>(
      `/message-channels/schedules/${family}/${channel}/${isPaused ? 'pause' : 'resume'}`,
    );
    return data;
  },

  getRecipients: async (): Promise<ChannelRecipient[]> => {
    const { data } = await apiClient.get<ChannelRecipient[]>(
      '/message-channels/recipients',
    );
    return data;
  },

  updateRecipients: async (
    input: ChannelSelectionChange & { clientIds: string[] },
  ): Promise<BulkSelectionResult> => {
    const { data } = await apiClient.put<BulkSelectionResult>(
      '/message-channels/recipients',
      input,
    );
    return data;
  },

  updateRecipient: async ({
    clientId,
    ...change
  }: ChannelSelectionChange & {
    clientId: string;
  }): Promise<ChannelSelectionChange> => {
    const { data } = await apiClient.put<ChannelSelectionChange>(
      `/message-channels/recipients/${clientId}`,
      change,
    );
    return data;
  },
};
