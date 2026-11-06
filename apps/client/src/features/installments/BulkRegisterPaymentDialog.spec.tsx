import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BulkRegisterPaymentDialog } from './BulkRegisterPaymentDialog';
import { installmentsApi } from './installmentsApi';

import type { Installment } from './installmentsApi';
import type { ReactNode } from 'react';

const baseInstallment = {
  loanId: 'loan-1',
  principalPortion: 427708,
  status: 'pending',
  isDownPayment: false,
  createdAt: '',
  updatedAt: '',
  deletedAt: null,
  conceptBreakdown: [],
};

const installments = [
  {
    ...baseInstallment,
    id: 'inst-1',
    installmentNumber: 1,
    amount: 500000,
    dueDate: '2026-09-20',
    overdueDays: 46,
    interest: 46000,
    totalDue: 546000,
  },
  {
    ...baseInstallment,
    id: 'inst-2',
    installmentNumber: 2,
    amount: 500000,
    dueDate: '2026-10-20',
    overdueDays: 16,
    interest: 16000,
    totalDue: 516000,
  },
] as unknown as Installment[];

function withQueryClient({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

// Human request, 2026-11-05 — a batch dated in the past settles each cuota
// with the balance it had on that day.
describe('BulkRegisterPaymentDialog — payment dated in the past', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("re-fills every row with that day's balance and sends that date", async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-05T15:00:00'));
    vi.spyOn(installmentsApi, 'getValuation').mockResolvedValue([
      {
        installmentId: 'inst-1',
        valuationDate: '2026-11-03',
        overdueDays: 44,
        interest: 44000,
        totalDue: 544000,
      },
      {
        installmentId: 'inst-2',
        valuationDate: '2026-11-03',
        overdueDays: 14,
        interest: 14000,
        totalDue: 514000,
      },
    ]);
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(
      <BulkRegisterPaymentDialog
        installments={installments}
        loanLabel="#0907 — Nicolas"
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
      { wrapper: withQueryClient },
    );

    fireEvent.click(screen.getByRole('button', { name: 'Fecha de pago' }));
    fireEvent.click(screen.getAllByRole('button', { name: '3' })[0]);

    await screen.findByText(/cada cuota se toma con el saldo que tenía/);
    await waitFor(() =>
      expect(screen.getByText(/Saldo \$\s?544\.000/)).toBeTruthy(),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Registrar 2 pagos' }));
    fireEvent.click(
      await screen.findByRole('button', { name: 'Sí, registrar pagos' }),
    );

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(onConfirm).toHaveBeenCalledWith([
      expect.objectContaining({
        installmentId: 'inst-1',
        amountPaid: 544000,
        paidAt: '2026-11-03',
      }),
      expect.objectContaining({
        installmentId: 'inst-2',
        amountPaid: 514000,
        paidAt: '2026-11-03',
      }),
    ]);
  });
});
