import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/apiClient';

import { RenumberLoanDialog } from './RenumberLoanDialog';

function renderDialog(onConfirm = vi.fn().mockResolvedValue({})) {
  const onClose = vi.fn();
  render(
    <RenumberLoanDialog
      loanLabel="#1200 — Juana Pérez"
      promissoryNoteNumber="#1200"
      isRefinanced={false}
      onClose={onClose}
      onConfirm={onConfirm}
    />,
  );
  return { onConfirm, onClose };
}

const typeNumber = (value: string) =>
  fireEvent.change(screen.getByRole('textbox'), { target: { value } });
const save = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Guardar número' }));

describe('RenumberLoanDialog', () => {
  it('keeps saving disabled until the number actually changes', () => {
    renderDialog();

    expect(
      (
        screen.getByRole('button', {
          name: 'Guardar número',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it('rejects a number that is not #0000 without calling the api', () => {
    const { onConfirm } = renderDialog();
    typeNumber('1201');
    save();

    expect(screen.getByRole('alert').textContent).toMatch(/#0000/);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('saves the trimmed number and closes', async () => {
    const { onConfirm, onClose } = renderDialog();
    typeNumber(' #1201 ');
    save();

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onConfirm).toHaveBeenCalledWith('#1201');
  });

  it('says the number is taken on a 409', async () => {
    const { onClose } = renderDialog(
      vi.fn().mockRejectedValue(new ApiError('already exists', 409)),
    );
    typeNumber('#1201');
    save();

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(
        'Ese número ya lo tiene otro préstamo, o perteneció a un pagaré eliminado que tenía pagos.',
      ),
    );
    expect(onClose).not.toHaveBeenCalled();
  });
});
