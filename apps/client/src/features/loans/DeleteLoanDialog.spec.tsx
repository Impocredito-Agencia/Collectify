import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/apiClient';

import { DeleteLoanDialog } from './DeleteLoanDialog';

import type { LoanDeletionPreview } from './loanDeletionApi';

const mutateAsync = vi.fn();
let preview: LoanDeletionPreview;

vi.mock('@/features/loans/useLoanDeletion', () => ({
  useLoanDeletionPreview: () => ({
    data: preview,
    isLoading: false,
    isError: false,
  }),
  useDeleteLoan: () => ({ mutateAsync, isPending: false }),
}));

function basePreview(
  overrides: Partial<LoanDeletionPreview> = {},
): LoanDeletionPreview {
  return {
    loanId: 'loan-1',
    promissoryNoteNumber: '#0800',
    clientId: 'client-1',
    clientFullName: 'Juana Pérez',
    chainLoans: [],
    installmentCount: 12,
    paymentCount: 2,
    paymentsTotal: 226000,
    creditToRestore: 0,
    creditToReverse: 0,
    blockers: [],
    ...overrides,
  };
}

function renderDialog() {
  const onDeleted = vi.fn();
  const onClose = vi.fn();
  render(
    <DeleteLoanDialog
      loanId="loan-1"
      onDeleted={onDeleted}
      onClose={onClose}
    />,
  );
  return { onDeleted, onClose };
}

const button = (name: string) =>
  screen.getByRole('button', { name }) as HTMLButtonElement;

function goToStepTwo(reason = 'Pagaré de prueba') {
  fireEvent.change(screen.getByPlaceholderText(/pagaré de prueba/), {
    target: { value: reason },
  });
  fireEvent.click(button('Continuar'));
}

describe('DeleteLoanDialog', () => {
  beforeEach(() => {
    preview = basePreview();
    mutateAsync.mockReset();
    mutateAsync.mockResolvedValue(undefined);
  });

  it('shows what will happen: cuotas, voided payments and saldo a favor', () => {
    preview = basePreview({
      chainLoans: [{ id: 'old', promissoryNoteNumber: '#0700' }],
      creditToRestore: 50000,
      creditToReverse: 30000,
    });
    renderDialog();

    expect(screen.getByText(/con sus 12 cuota/)).toBeTruthy();
    expect(screen.getByText(/#0700/)).toBeTruthy();
    expect(
      screen.getByText(/2 pago\(s\), por \$ 226\.000, quedarán anulados/),
    ).toBeTruthy();
    expect(screen.getByText(/Se le devolverán \$ 50\.000/)).toBeTruthy();
    expect(screen.getByText(/Se descontarán \$ 30\.000/)).toBeTruthy();
  });

  it('keeps "Continuar" disabled until a reason is written', () => {
    renderDialog();

    expect(button('Continuar').disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText(/pagaré de prueba/), {
      target: { value: '   ' },
    });
    expect(button('Continuar').disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText(/pagaré de prueba/), {
      target: { value: 'Pagaré de prueba' },
    });
    expect(button('Continuar').disabled).toBe(false);
  });

  it('shows a blocker in red and never lets the admin continue', () => {
    preview = basePreview({
      blockers: ['El saldo a favor ya se usó en: cuota 3 del pagaré #0700.'],
    });
    renderDialog();

    expect(screen.getByRole('alert').textContent).toContain(
      'cuota 3 del pagaré #0700',
    );
    expect(screen.queryByPlaceholderText(/pagaré de prueba/)).toBeNull();
    expect(button('Continuar').disabled).toBe(true);
  });

  it('only enables the final button once the current number is typed', () => {
    renderDialog();
    goToStepTwo();

    expect(screen.getByText(/no se puede deshacer/)).toBeTruthy();
    const confirmInput = screen.getByPlaceholderText('#0800');
    expect(button('Eliminar definitivamente').disabled).toBe(true);

    fireEvent.change(confirmInput, { target: { value: '#800' } });
    expect(button('Eliminar definitivamente').disabled).toBe(true);

    fireEvent.change(confirmInput, { target: { value: '0800' } });
    expect(button('Eliminar definitivamente').disabled).toBe(false);
  });

  it('deletes with the reason and the typed number, then reports back', async () => {
    const { onDeleted } = renderDialog();
    goToStepTwo('  Pagaré de prueba  ');
    fireEvent.change(screen.getByPlaceholderText('#0800'), {
      target: { value: '#0800' },
    });
    fireEvent.click(button('Eliminar definitivamente'));

    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
    expect(mutateAsync).toHaveBeenCalledWith({
      id: 'loan-1',
      input: {
        reason: 'Pagaré de prueba',
        confirmPromissoryNoteNumber: '#0800',
      },
    });
  });

  it("shows the api's message when it rejects, deleting nothing", async () => {
    mutateAsync.mockRejectedValue(
      new ApiError(
        'El número escrito no coincide con el número actual de este pagaré (#0801).',
        400,
      ),
    );
    const { onDeleted } = renderDialog();
    goToStepTwo();
    fireEvent.change(screen.getByPlaceholderText('#0800'), {
      target: { value: '#0800' },
    });
    fireEvent.click(button('Eliminar definitivamente'));

    await waitFor(() => expect(screen.getByText(/#0801/)).toBeTruthy());
    expect(onDeleted).not.toHaveBeenCalled();
  });
});
