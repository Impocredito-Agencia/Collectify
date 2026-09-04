import { apiClient } from '@/lib/apiClient';

// Matches apps/api/src/usuryRates/entities/usuryRate.entity.ts. Historical,
// append-only rows — see docs/phases/PHASE_15_USURY_RATE.md.
export interface UsuryRate {
  id: string;
  effectiveMonth: string;
  // The monthly EFFECTIVE rate actually applied to loan interest — derived
  // server-side from annualRatePercentage below, never entered directly.
  ratePercentage: number;
  // The raw annual rate as published by the Superintendencia Financiera
  // (e.g. 29.24 for "29,24%"). Nullable only for rows that predate this
  // field (none exist in production as of 2026-09-03 — see
  // docs/GLOSSARY.md "Usury rate ceiling").
  annualRatePercentage: number | null;
  createdBy: string | null;
  createdAt: string;
}

export interface CurrentUsuryRate extends UsuryRate {
  // True when nobody has entered this calendar month's certified rate yet
  // — not tied to a fixed publication day, since the SFC's own publication
  // date moves around. Keep showing an alert every session until a
  // current-month rate is entered (confirmed with the client).
  isStale: boolean;
}

export interface CreateUsuryRateInput {
  effectiveMonth: string;
  // Bug fix, 2026-09-03 — was ratePercentage (the monthly figure, computed
  // by hand). The admin now enters the raw annual rate exactly as the
  // Superintendencia publishes it; the API derives and stores the monthly
  // effective rate. See UsuryRatesPage.tsx.
  annualRatePercentage: number;
}

export const usuryRatesApi = {
  // Open to any authenticated user as of Phase 24 — a collector who can
  // create a loan (Phase 23) needs to see this before hitting the new hard
  // block on a missing/stale rate. Returns null when no rate has ever been
  // entered. Managing the rate (setRate/getHistory below) stays admin-only.
  getCurrent: async (): Promise<CurrentUsuryRate | null> => {
    const { data } = await apiClient.get<CurrentUsuryRate | null>(
      '/usury-rates/current',
    );
    return data;
  },

  getHistory: async (): Promise<UsuryRate[]> => {
    const { data } = await apiClient.get<UsuryRate[]>('/usury-rates');
    return data;
  },

  setRate: async (input: CreateUsuryRateInput): Promise<UsuryRate> => {
    const { data } = await apiClient.post<UsuryRate>('/usury-rates', input);
    return data;
  },
};
