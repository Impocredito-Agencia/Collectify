import { apiClient } from '@/lib/apiClient';

// Matches apps/api/src/whatsapp/whatsappDeliveryHealth.ts's
// WhatsappDeliveryHealth. possiblyBlocked is evidence-based, never a
// confirmed Meta status — see that file's own comment. Always shown to the
// admin alongside lastDeliveryStatus/lastErrorCode/lastErrorTitle, never as
// a bare boolean claim.
export interface WhatsappDeliveryHealth {
  lastDeliveryStatus: 'sent' | 'delivered' | 'read' | 'failed' | null;
  lastErrorCode: number | null;
  lastErrorTitle: string | null;
  possiblyBlocked: boolean;
}

export const whatsappDeliveryHealthApi = {
  getForClient: async (clientId: string): Promise<WhatsappDeliveryHealth> => {
    const { data } = await apiClient.get<WhatsappDeliveryHealth>(
      `/whatsapp/clients/${clientId}/delivery-health`,
    );
    return data;
  },
};
