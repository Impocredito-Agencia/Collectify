import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { InstallmentFrequency, LoanStatus } from './loansApi';
import { DeletedLoanDetailPage } from './DeletedLoanDetailPage';

import type { DeletedLoanDetail } from './loanDeletionApi';

const loan: DeletedLoanDetail = {
  id: 'loan-1',
  promissoryNoteNumber: '#9999',
  clientId: 'client-1',
  clientFullName: 'Juana Pérez',
  principalAmount: 600000,
  totalInstallments: 2,
  status: LoanStatus.Active,
  deletedAt: '2026-11-05T15:00:00.000Z',
  deletedByFullName: 'Ana Admin',
  deletionReason: 'Pagaré de prueba',
  hadPayments: true,
  refinancedLoans: [],
  clientDocumentNumber: '1234567890',
  disbursedAt: '2026-01-01',
  installmentFrequency: InstallmentFrequency.Monthly,
  description: null,
  hasFrozenFigures: true,
  installments: [
    {
      installmentNumber: 1,
      isDownPayment: false,
      dueDate: '2026-09-01',
      amount: 300000,
      principalPortion: 270000,
      status: 'pending',
      overdueDays: 65,
      interest: 13000,
      totalPaid: 0,
      totalDue: 313000,
      conceptBreakdown: [],
    },
  ],
  payments: [
    {
      id: 'pay-1',
      installmentId: 'inst-1',
      amountPaid: 120000,
      paidAt: '2026-08-15',
      observation: null,
      imageUrls: [],
      createdAt: '',
      updatedAt: '',
      deletedAt: '2026-11-05T15:00:00.000Z',
      voidReason: 'Pagaré eliminado: Pagaré de prueba',
      fundedByCredit: false,
      moraWaivedAmount: 0,
      moraWaiverReason: null,
      creditGeneratedAmount: 0,
      creditSpentAmount: 0,
      sourceWhatsappMessage: null,
    },
  ],
  deletedTogether: [],
  originationTerms: [],
};

let shownLoan: DeletedLoanDetail = loan;

vi.mock('@/features/loans/useLoanDeletion', () => ({
  useDeletedLoan: () => ({ data: shownLoan, isLoading: false, isError: false }),
}));

function renderPage() {
  render(
    <MemoryRouter initialEntries={['/prestamos/eliminados/loan-1']}>
      <Routes>
        <Route
          path="/prestamos/eliminados/:id"
          element={<DeletedLoanDetailPage />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('DeletedLoanDetailPage', () => {
  beforeEach(() => {
    shownLoan = loan;
  });

  it('says who deleted it and why, in the red strip', () => {
    renderPage();

    expect(
      screen.getByText(/Pagaré eliminado el .* por Ana Admin/),
    ).toBeTruthy();
    expect(screen.getByText('Motivo: Pagaré de prueba')).toBeTruthy();
  });

  it('shows the frozen cuota value and mora side by side', () => {
    renderPage();

    expect(screen.getByText('65 días')).toBeTruthy();
    expect(screen.getByText('$ 13.000')).toBeTruthy();
    expect(screen.getByText('$ 313.000')).toBeTruthy();
  });

  it('lists the voided payments with their void reason', () => {
    renderPage();

    expect(screen.getByText('$ 120.000')).toBeTruthy();
    expect(screen.getByText('Pagaré eliminado: Pagaré de prueba')).toBeTruthy();
  });

  it('offers no action button at all', () => {
    renderPage();

    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('shows its refinance chain in order, telling same-numbered loans apart by position', () => {
    shownLoan = {
      ...loan,
      id: 'middle',
      promissoryNoteNumber: '#0006',
      refinancedLoans: [{ id: 'first', promissoryNoteNumber: '#0006' }],
      deletedTogether: [
        { id: 'first', promissoryNoteNumber: '#0006' },
        { id: 'head', promissoryNoteNumber: '#0006' },
      ],
    };

    renderPage();

    const links = screen
      .getAllByRole('listitem')
      .map((item) => item.textContent);
    expect(links).toEqual([
      'Original · #0006',
      '→Refinanciación 1 · #0006 (este)',
      '→Refinanciación 2 · #0006',
    ]);
  });

  it('shows the terms it was created with, including mora forgiven at refinance', () => {
    shownLoan = {
      ...loan,
      originationTerms: [
        {
          loanId: 'loan-1',
          promissoryNoteNumber: '#9999',
          status: LoanStatus.Active,
          disbursedAt: '2026-01-01',
          createdAt: '2026-01-01T00:00:00.000Z',
          principalAmount: 600000,
          installmentFrequency: InstallmentFrequency.Monthly,
          financedInstallments: 2,
          downPaymentAmount: null,
          installmentAmount: 300000,
          corrienteInterestRate: 3.9,
          moratoryInterestRate: 2.5,
          otherCharges: [],
          refinancedFromLoanId: 'old',
          refinanceMoraWaivedAmount: 45000,
          refinanceMoraWaiverReason: 'Refinancia al día',
        },
      ],
    };

    renderPage();

    expect(
      screen.getByText('Condiciones con las que se creó el crédito'),
    ).toBeTruthy();
    expect(screen.getByText('3,9% mensual')).toBeTruthy();
    expect(screen.getByText('$ 45.000')).toBeTruthy();
    expect(screen.getByText(/Refinancia al día/)).toBeTruthy();
  });
});
