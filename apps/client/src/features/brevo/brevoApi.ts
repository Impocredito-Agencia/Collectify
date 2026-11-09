import { apiClient } from '@/lib/apiClient';

// Matches apps/api/src/brevo/brevoTypes.ts.
export enum BrevoChannel {
  Email = 'email',
  Sms = 'sms',
}

export enum BrevoSendFailureReason {
  Paused = 'paused',
  NotConfigured = 'not_configured',
  InvalidApiKey = 'invalid_api_key',
  InsufficientCredits = 'insufficient_credits',
  RateLimited = 'rate_limited',
  Rejected = 'rejected',
  NetworkError = 'network_error',
}

export interface BrevoChannelStatus {
  configured: boolean;
  sendingPaused: boolean;
  sender: string | null;
}

export type BrevoAccountInfo =
  | {
      available: true;
      planType: string | null;
      emailCredits: number | null;
      // Null when the account has never bought SMS credits.
      smsCredits: number | null;
    }
  | {
      available: false;
      failureReason: BrevoSendFailureReason;
      errorMessage: string;
    };

// Built server-side from env config plus a live Brevo lookup. The API key
// itself never reaches the browser.
export interface BrevoStatus {
  apiKeyConfigured: boolean;
  email: BrevoChannelStatus;
  sms: BrevoChannelStatus;
  testRecipientsCount: number;
  account: BrevoAccountInfo;
}

export interface BrevoSendResult {
  sent: boolean;
  providerMessageId: string | null;
  failureReason: BrevoSendFailureReason | null;
  errorMessage: string | null;
}

export interface SendBrevoTestInput {
  channel: BrevoChannel;
  to: string;
}

// Both require the message_templates module server-side.
export const brevoApi = {
  getStatus: async (): Promise<BrevoStatus> => {
    const { data } = await apiClient.get<BrevoStatus>('/brevo/status');
    return data;
  },

  sendTest: async (input: SendBrevoTestInput): Promise<BrevoSendResult> => {
    const { data } = await apiClient.post<BrevoSendResult>(
      '/brevo/test',
      input,
    );
    return data;
  },
};
