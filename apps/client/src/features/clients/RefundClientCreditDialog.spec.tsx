import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/apiClient';

import { RefundClientCreditDialog } from './RefundClientCreditDialog';

const mutateAsync = vi.fn();

vi.mock('@/features/clients/useClients', () => ({
  useRefundClientCredit: () => ({ mutateAsync, isPending: false }),
}));

function renderDialog(onClose = vi.fn()) {
  render(
    <RefundClientCreditDialog
      clientId="client-1"
      balance={80000}
      onClose={onClose}
    />,
  );
  return onClose;
}

describe('RefundClientCreditDialog', () => {
  beforeEach(() => {
    mutateAsync.mockReset();
    mutateAsync.mockResolvedValue({ balance: 0 });
  });

  it('starts with the whole balance as the amount to return', () => {
    renderDialog();

    expect((screen.getAllByRole('textbox')[0] as HTMLInputElement).value).toBe(
      '$80.000',
    );
  });

  it('needs a second confirmation that states the new balance before returning anything', async () => {
    const onClose = renderDialog();
    fireEvent.change(screen.getAllByRole('textbox')[0], {
      target: { value: '30000' },
    });
    fireEvent.change(screen.getAllByRole('textbox')[1], {
      target: { value: 'Pidió el excedente' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));

    expect(mutateAsync).not.toHaveBeenCalled();
    expect(screen.getByText(/no se puede deshacer/)).toBeTruthy();
    expect(screen.getByText(/quedará en/)).toBeTruthy();

    fireEvent.click(
      screen.getByRole('button', { name: 'Sí, registrar devolución' }),
    );

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mutateAsync).toHaveBeenCalledWith({
      clientId: 'client-1',
      amount: 30000,
      reason: 'Pidió el excedente',
    });
  });

  it('sends no reason when none was typed', async () => {
    renderDialog();

    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Sí, registrar devolución' }),
    );

    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    expect(mutateAsync).toHaveBeenCalledWith({
      clientId: 'client-1',
      amount: 80000,
      reason: undefined,
    });
  });

  it('refuses an amount above the balance without asking the server', () => {
    renderDialog();
    fireEvent.change(screen.getAllByRole('textbox')[0], {
      target: { value: '80001' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));

    expect(
      screen.getByText(/no puedes devolver más que el saldo/i),
    ).toBeTruthy();
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('shows the server error and goes back to the form when the refund is rejected', async () => {
    mutateAsync.mockRejectedValue(
      new ApiError('El saldo a favor disponible ($10000) es menor', 400),
    );
    renderDialog();

    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Sí, registrar devolución' }),
    );

    expect(await screen.findByText(/es menor/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeTruthy();
  });
});
