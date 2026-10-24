import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { InstallmentStatus } from '@/features/installments/installmentsApi';

import { LoanClientSummaryDialog } from './LoanClientSummaryDialog';

import type { Installment } from '@/features/installments/installmentsApi';

const pending: Installment = {
  id: 'i3',
  loanId: 'loan-1',
  installmentNumber: 3,
  amount: 210000,
  principalPortion: 195349,
  dueDate: '2024-05-30',
  status: InstallmentStatus.Pending,
  isDownPayment: false,
  createdAt: '',
  updatedAt: '',
  deletedAt: null,
  overdueDays: 876,
  interest: 429240,
  totalDue: 639200,
  conceptBreakdown: [
    {
      name: 'Intereses moratorios',
      amount: 132482,
    } as Installment['conceptBreakdown'][number],
  ],
};

function renderDialog(installments: Installment[] = [pending]) {
  const onClose = vi.fn();
  render(
    <LoanClientSummaryDialog
      promissoryNoteNumber="#0743"
      clientFullName="Juana Pérez"
      installments={installments}
      onClose={onClose}
    />,
  );
  return onClose;
}

describe('LoanClientSummaryDialog', () => {
  it('shows days late, surcharges as one figure and the total to pay', () => {
    renderDialog();

    expect(screen.getByText(/Pagaré #0743/)).toBeTruthy();
    expect(screen.getByText('876 días')).toBeTruthy();
    expect(screen.getAllByText('$ 429.200').length).toBeGreaterThan(0);
    expect(screen.getAllByText('$ 639.200').length).toBeGreaterThan(0);
  });

  it('names the mora column explicitly and has no summed total row', () => {
    renderDialog();

    expect(screen.getByText('Días de mora')).toBeTruthy();
    expect(screen.getByText('Valor mora')).toBeTruthy();
    expect(screen.queryByText('Recargos')).toBeNull();
    expect(screen.queryByText('Total')).toBeNull();
    expect(screen.getAllByText('$ 429.200')).toHaveLength(1);
  });

  it('never shows the per-concept breakdown', () => {
    renderDialog();

    expect(screen.queryByText(/Intereses moratorios/)).toBeNull();
    expect(screen.queryByText(/Capital/)).toBeNull();
  });

  it('hides the Abonado column when no cuota has a partial payment', () => {
    renderDialog();

    expect(screen.queryByText('Abonado')).toBeNull();
  });

  it('closes from the Cerrar button', () => {
    const onClose = renderDialog();

    fireEvent.click(screen.getByText('Cerrar'));

    expect(onClose).toHaveBeenCalled();
  });
});
