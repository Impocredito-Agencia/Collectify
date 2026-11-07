import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
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

function renderTerms() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  render(<LoanOriginationTerms loanId="loan-1" />, { wrapper });
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
    expect(screen.getByText('Estudio de crédito')).toBeTruthy();
    expect(screen.getByText(/Refinancia al día/)).toBeTruthy();
  });

  it('lists every charge in its group', async () => {
    vi.spyOn(loansApi, 'getOriginationTerms').mockResolvedValue([
      {
        ...current,
        moratoryInterestRate: 2.1605,
        otherCharges: [
          ...current.otherCharges,
          {
            name: 'Gastos de cobranza',
            category: ConceptCategory.Moratorio,
            calculationType: ConceptCalculationType.Percentage,
            value: 4.8395,
          },
          {
            name: 'Reporte en centrales',
            category: ConceptCategory.Moratorio,
            calculationType: ConceptCalculationType.FixedAmount,
            value: 5000,
          },
        ],
      },
    ]);
    renderTerms();

    const corriente = (await screen.findByText('Se cobra en cada cuota'))
      .parentElement!;
    expect(within(corriente).getByText('Intereses corrientes')).toBeTruthy();
    expect(within(corriente).getByText('3,9% mensual')).toBeTruthy();
    expect(within(corriente).getByText('Estudio de crédito')).toBeTruthy();
    expect(within(corriente).getByText('$ 20.000')).toBeTruthy();
    expect(within(corriente).queryByText(/en total/)).toBeNull();

    const mora = screen.getByText('En caso de mora').parentElement!;
    expect(within(mora).getByText('Gastos de cobranza')).toBeTruthy();
    expect(within(mora).getByText('4,8395% mensual')).toBeTruthy();
    expect(within(mora).getByText('por cuota vencida')).toBeTruthy();
    expect(within(mora).getByText('Intereses moratorios')).toBeTruthy();
  });

  it('shows only this loan, not the ones it was refinanced from', async () => {
    vi.spyOn(loansApi, 'getOriginationTerms').mockResolvedValue([
      current,
      original,
    ]);
    renderTerms();

    expect(await screen.findByText('3,9% mensual')).toBeTruthy();
    expect(screen.getByText('12 cuotas mensuales')).toBeTruthy();
    expect(screen.queryByText('12 cuotas quincenales')).toBeNull();
    expect(screen.queryByText(/Pagarés anteriores/)).toBeNull();
  });

  it('shows "No registrada" for a rate never stored', async () => {
    vi.spyOn(loansApi, 'getOriginationTerms').mockResolvedValue([original]);
    renderTerms();

    expect(await screen.findByText('12 cuotas quincenales')).toBeTruthy();
    expect(screen.getAllByText('No registrada')).toHaveLength(2);
  });
});
