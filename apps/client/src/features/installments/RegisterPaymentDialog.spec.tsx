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

// The comprobante a client sent over WhatsApp, already re-hosted (see
// RegisterPaymentFromWhatsappModal) — it can be a photo or a PDF.
describe('RegisterPaymentDialog — comprobante pre-attached from WhatsApp', () => {
  const pdfUrl =
    'https://res.cloudinary.com/demo/image/upload/v1/whatsapp-media/abc.pdf';
  const photoUrl =
    'https://res.cloudinary.com/demo/image/upload/v1/whatsapp-media/abc.jpg';

  function renderWithComprobante(url: string) {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(
      <RegisterPaymentDialog
        installment={noMoraInstallment}
        loanLabel="#0907 — Nicolas"
        initialImageUrls={[url]}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    return onConfirm;
  }

  it('shows a PDF comprobante as a link to the file, not as a broken image', () => {
    renderWithComprobante(pdfUrl);

    const link = screen.getByRole('link', {
      name: 'Abrir comprobante de WhatsApp (PDF)',
    });
    expect(link.getAttribute('href')).toBe(pdfUrl);
    expect(screen.queryByAltText('Comprobante de WhatsApp')).toBeNull();
  });

  it('still shows a photo comprobante as a thumbnail', () => {
    renderWithComprobante(photoUrl);

    expect(
      screen.getByAltText('Comprobante de WhatsApp').getAttribute('src'),
    ).toBe(photoUrl);
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('saves the PDF comprobante with the payment', async () => {
    const onConfirm = renderWithComprobante(pdfUrl);

    fireEvent.change(screen.getAllByRole('textbox')[0], {
      target: { value: '588000' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Registrar pago' }));
    fireEvent.click(
      await screen.findByRole('button', { name: 'Sí, registrar pago' }),
    );

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ imageUrls: [pdfUrl] }),
    );
  });

  it('leaves the PDF out when the collector removes it', async () => {
    const onConfirm = renderWithComprobante(pdfUrl);

    fireEvent.click(screen.getByRole('button', { name: 'Quitar' }));
    expect(screen.queryByRole('link')).toBeNull();

    fireEvent.change(screen.getAllByRole('textbox')[0], {
      target: { value: '588000' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Registrar pago' }));
    fireEvent.click(
      await screen.findByRole('button', { name: 'Sí, registrar pago' }),
    );

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(onConfirm.mock.calls[0][0].imageUrls).toBeUndefined();
  });
});
