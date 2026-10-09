import { apiClient } from '@/lib/apiClient';

// Matches apps/api/src/whatsapp/clientBreakdown.service.ts.
export interface ClientBreakdownInstallment {
  installmentId: string;
  loanId: string;
  promissoryNoteNumber: string;
  installmentNumber: number;
  dueDate: string;
  // The cuota's own value, before recargos and abonos.
  amount: number;
  // Mora accrued up to the requested day.
  interest: number;
  // Abonos dated on or before the requested day.
  paidByDate: number;
  // What was still owed on this cuota that day.
  totalDue: number;
  overdueDays: number;
  daysUntilDue: number;
}

export interface ClientBreakdown {
  date: string;
  installments: ClientBreakdownInstallment[];
  totalPayableOnDate: number;
}

export const clientBreakdownApi = {
  // The client's still-pending cuotas valued as they stood on `date`
  // ('YYYY-MM-DD', today or earlier). Read-only.
  getAsOf: async (clientId: string, date: string): Promise<ClientBreakdown> => {
    const { data } = await apiClient.get<ClientBreakdown>(
      `/whatsapp/clients/${clientId}/breakdown`,
      { date },
    );
    return data;
  },
};
