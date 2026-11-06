import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ConceptCalculationType,
  ConceptCategory,
} from '@/features/interestConceptTypes/interestConceptTypesApi';

import { LoanOriginationTerms } from './LoanOriginationTerms';
import { InstallmentFrequency, LoanStatus, loansApi } from './loansApi';

import type { LoanOriginationTerms as Terms } from './loansApi';
import type { ReactNode } from 'react';

const current: Terms = {
  loanId: 'loan-1',
  promissoryNoteNumber: '#0907',
  status: LoanStatus.Active,
  disbursedAt: '2026-07-10',
  createdAt: '2026-07-10T15:00:00Z',
  principalAmount: 2600000,
  installmentFrequency: InstallmentFrequency.Monthly,
  financedInstallments: 12,
  downPaymentAmount: null,
  installmentAmount: 271600,
  corrienteInterestRate: 3.9,
  moratoryInterestRate: 2.1,
  otherCharges: [
    {
      name: 'Estudio de crédito',
      category: ConceptCategory.Corriente,
      calculationType: ConceptCalculationType.FixedAmount,
      value: 20000,
    },
  ],
  refinancedFromLoanId: 'loan-0',
  refinanceMoraWaivedAmount: 45000,
  refinanceMoraWaiverReason: 'Refinancia al día',
};

const original: Terms = {
  ...current,
  loanId: 'loan-0',
  status: LoanStatus.Refinanced,
  disbursedAt: '2025-11-01',
  installmentFrequency: InstallmentFrequency.Biweekly,
  corrienteInterestRate: null,
  moratoryInterestRate: null,
  otherCharges: [],
  refinancedFromLoanId: null,
  refinanceMoraWaivedAmount: 0,
  refinanceMoraWaiverReason: null,
};

function renderTerms(compact = false) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  render(<LoanOriginationTerms loanId="loan-1" compact={compact} />, {
    wrapper,
  });
}

// Human request, 2026-11-05 — "a qué tasa se les financió".
describe('LoanOriginationTerms', () => {
  afterEach(() => vi.restoreAllMocks());

  it('shows the rates, plazo and fees the loan was created with, plus the mora forgiven', async () => {
    vi.spyOn(loansApi, 'getOriginationTerms').mockResolvedValue([current]);
    renderTerms();

    expect(await screen.findByText('3,9% mensual')).toBeTruthy();
    expect(screen.getByText('2,1% mensual')).toBeTruthy();
    expect(screen.getByText('12 cuotas mensuales')).toBeTruthy();
    expect(screen.getByText(/Estudio de crédito/)).toBeTruthy();
    expect(screen.getByText(/Refinancia al día/)).toBeTruthy();
  });

  it('shows the refinanced-from pagarés, with "No registrada" for a rate never stored', async () => {
    vi.spyOn(loansApi, 'getOriginationTerms').mockResolvedValue([
      current,
      original,
    ]);
    renderTerms();

    expect(
      await screen.findByText('Pagarés anteriores (refinanciados)'),
    ).toBeTruthy();
    expect(screen.getAllByText('No registrada')).toHaveLength(2);
    expect(screen.getByText('12 cuotas quincenales')).toBeTruthy();
  });

  it('compact shows only this loan', async () => {
    vi.spyOn(loansApi, 'getOriginationTerms').mockResolvedValue([
      current,
      original,
    ]);
    renderTerms(true);

    expect(await screen.findByText('3,9% mensual')).toBeTruthy();
    expect(screen.queryByText('Pagarés anteriores (refinanciados)')).toBeNull();
  });
});
