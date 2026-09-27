import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { RegisterPaymentDialog } from './RegisterPaymentDialog';

import type { Installment } from './installmentsApi';

// amount 588000 + accrued mora 12344.6 → rounded total 600300, so the cuota
// charges 12300 of mora and the balance to settle is 600300.
const overdueInstallment = {
  id: 'inst-1',
  loanId: 'loan-1',
  installmentNumber: 15,
  amount: 588000,
  principalPortion: 427708,
  dueDate: '2026-09-20',
  status: 'pending',
  isDownPayment: false,
  createdAt: '',
  updatedAt: '',
  deletedAt: null,
  overdueDays: 30,
  interest: 12344.6,
  totalDue: 600300,
  conceptBreakdown: [],
} as unknown as Installment;

const noMoraInstallment = {
  ...overdueInstallment,
  overdueDays: 0,
  interest: 0,
  totalDue: 588000,
} as Installment;

function renderDialog(installment: Installment, onConfirm = vi.fn()) {
  onConfirm.mockResolvedValue(undefined);
  render(
    <RegisterPaymentDialog
      installment={installment}
      loanLabel="#0907 — Nicolas"
      onClose={vi.fn()}
      onConfirm={onConfirm}
    />,
  );
  return onConfirm;
}

describe('RegisterPaymentDialog — mora waiver', () => {
  it('does not offer to forgive mora on a cuota that has none', () => {
    renderDialog(noMoraInstallment);

    expect(screen.queryByText('Condonar mora')).toBeNull();
  });

  it('with the whole mora forgiven, locks the amount to exactly the capital and sends both figures', async () => {
    const onConfirm = renderDialog(overdueInstallment);

    fireEvent.click(screen.getByText('Condonar mora'));
    fireEvent.click(screen.getByText('Toda la mora'));

    // 600300 balance − 12300 mora = 588000, shown locked (not typed).
    const amountInput = screen.getAllByRole('textbox')[0];
    expect((amountInput as HTMLInputElement).value).toBe('$588.000');
    expect((amountInput as HTMLInputElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Registrar pago' }));
    fireEvent.click(
      await screen.findByRole('button', { name: 'Sí, registrar pago' }),
    );

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        amountPaid: 588000,
        moraWaivedAmount: 12300,
      }),
    );
  });

  it('a partial waiver leaves balance − waiver to pay, to the peso', async () => {
    const onConfirm = renderDialog(overdueInstallment);

    fireEvent.click(screen.getByText('Condonar mora'));
    // First textbox is the amount, second the waiver amount.
    fireEvent.change(screen.getAllByRole('textbox')[1], {
      target: { value: '10000' },
    });

    expect((screen.getAllByRole('textbox')[0] as HTMLInputElement).value).toBe(
      '$590.300',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Registrar pago' }));
    fireEvent.click(
      await screen.findByRole('button', { name: 'Sí, registrar pago' }),
    );

    await waitFor(() => expect(onConfirm).toHaveBeenCalled());
    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ amountPaid: 590300, moraWaivedAmount: 10000 }),
    );
  });

  it('refuses a waiver bigger than the mora being charged', () => {
    const onConfirm = renderDialog(overdueInstallment);

    fireEvent.click(screen.getByText('Condonar mora'));
    fireEvent.change(screen.getAllByRole('textbox')[1], {
      target: { value: '12301' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Registrar pago' }));

    expect(screen.getByText(/no puede superar \$\s?12\.300/)).toBeTruthy();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('removing the waiver goes back to a normal, typed payment', () => {
    renderDialog(overdueInstallment);
    fireEvent.click(screen.getByText('Condonar mora'));
    fireEvent.click(screen.getByText('Toda la mora'));

    fireEvent.click(screen.getByText('Quitar condonación'));

    const amountInput = screen.getAllByRole('textbox')[0] as HTMLInputElement;
    expect(amountInput.disabled).toBe(false);
    expect(screen.getByText('Condonar mora')).toBeTruthy();
  });
});
