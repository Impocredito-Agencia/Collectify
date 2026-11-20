import { apiClient } from '@/lib/apiClient';

import type { BrevoChannel, BrevoSendResult } from '@/features/brevo/brevoApi';
import type { MessageType } from '@/features/messageTemplates/messageTemplatesApi';

// Matches apps/api's MessageTypeParameter — what one {{n}} is.
export interface MessageTypeParameter {
  label: string;
  example: string;
}

// Matches apps/api's MessageChannelTemplateView.
export interface ChannelTemplate {
  type: MessageType;
  channel: BrevoChannel;
  // Email only; always null for SMS.
  subject: string | null;
  body: string;
  updatedAt: string;
  // In {{1}}, {{2}}... order.
  parameters: MessageTypeParameter[];
}

export interface UpdateChannelTemplateInput {
  type: MessageType;
  channel: BrevoChannel;
  subject: string | null;
  body: string;
}

export interface SendChannelTemplateTestInput {
  type: MessageType;
  channel: BrevoChannel;
  to: string;
}

// Must match the api's limits (messageChannelTemplates.service.ts).
export const SMS_BODY_MAX_LENGTH = 480;
export const EMAIL_BODY_MAX_LENGTH = 5000;
export const EMAIL_SUBJECT_MAX_LENGTH = 150;

// All require the message_templates module server-side.
export const channelTemplatesApi = {
  getAll: async (): Promise<ChannelTemplate[]> => {
    const { data } = await apiClient.get<ChannelTemplate[]>(
      '/message-channel-templates',
    );
    return data;
  },

  update: async ({
    type,
    channel,
    ...body
  }: UpdateChannelTemplateInput): Promise<ChannelTemplate> => {
    const { data } = await apiClient.put<ChannelTemplate>(
      `/message-channel-templates/${type}/${channel}`,
      body,
    );
    return data;
  },

  sendTest: async ({
    type,
    channel,
    to,
  }: SendChannelTemplateTestInput): Promise<BrevoSendResult> => {
    const { data } = await apiClient.post<BrevoSendResult>(
      `/message-channel-templates/${type}/${channel}/test`,
      { to },
    );
    return data;
  },
};
