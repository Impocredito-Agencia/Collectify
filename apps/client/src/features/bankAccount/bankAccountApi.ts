import { apiClient } from '@/lib/apiClient';

// Matches apps/api/src/whatsapp/bankAccount.service.ts's BankAccountSetting.
export interface BankAccountSetting {
  // Null until an admin enters one for the first time.
  bankAccount: string | null;
  // The exact text a client would receive right now, rendered by the API
  // from the cuenta_bancaria template — never rebuilt on this side.
  messagePreview: string | null;
  updatedAt: string | null;
}

// Must match apps/api's BANK_ACCOUNT_MAX_LENGTH.
export const BANK_ACCOUNT_MAX_LENGTH = 200;

export const bankAccountApi = {
  // Open to any authenticated user — read by both the inbox's send dialog
  // and the templates page's editor.
  get: async (): Promise<BankAccountSetting> => {
    const { data } = await apiClient.get<BankAccountSetting>('/bank-account');
    return data;
  },

  // Requires the message_templates module server-side.
  update: async (bankAccount: string): Promise<BankAccountSetting> => {
    const { data } = await apiClient.put<BankAccountSetting>('/bank-account', {
      bankAccount,
    });
    return data;
  },
};
