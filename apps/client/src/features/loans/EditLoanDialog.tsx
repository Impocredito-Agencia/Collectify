import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { CloseButton } from '@/components/ui/CloseButton';
import { Modal } from '@/components/ui/Modal';
import { ApiError } from '@/lib/apiClient';
import { useEscapeKey } from '@/lib/useEscapeKey';

import type { UpdateLoanInput } from '@/features/loans/loansApi';
import type { FormEvent } from 'react';

interface EditLoanDialogProps {
  loanLabel: string;
  description: string | null;
  onClose: () => void;
  onConfirm: (input: UpdateLoanInput) => Promise<unknown>;
}

// PATCH /loans/:id (apps/api/src/loans/dto/updateLoan.dto.ts) — description
// only.
//
// Final scope, 2026-09-04 (client feedback, same day as two earlier
// attempts): this dialog briefly let the admin correct interestRate, then
// a loan's moratory concept values — both reverted the same day. The
// client's own conclusion after seeing the moratory-concept version in
// practice: there wasn't much real use for editing those numbers after
// the fact, and it muddied a simpler, more defensible rule — a préstamo's
// numbers are fixed the moment it's created (principalAmount, schedule,
// interestRate, every concept, corriente or moratorio). Get it wrong, and
// the fix is Refinanciar, which regenerates the schedule and — unlike a
// silent PATCH — notifies the client. See docs/DATABASE.md's `interest_rate`
// "Resolved" note and UpdateLoanDto's own comment for the full history.
//
// description survived as the one editable field: a wording/typo fix has
// no bearing on what the client owes, so it doesn't need Refinanciar's
// full weight (new pagaré, cancelled installments, new WhatsApp message).
// Its trigger moved off the top action bar and onto the Descripción line
// itself on LoanDetailPage, precisely so this narrower scope reads as
// obvious from where the button lives, not just from a tooltip.
export function EditLoanDialog({
  loanLabel,
  description,
  onClose,
  onConfirm,
}: EditLoanDialogProps) {
  const [descriptionInput, setDescriptionInput] = useState(description ?? '');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEscapeKey(onClose);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    setIsSubmitting(true);
    try {
      await onConfirm({ description: descriptionInput.trim() || undefined });
      onClose();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'No se pudo guardar el préstamo. Intenta de nuevo.',
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal maxWidth="max-w-[440px]">
      <div className="flex items-center justify-between">
        <h2 className="text-[16px] font-medium text-white">
          Editar descripción
        </h2>
        <CloseButton onClick={onClose} />
      </div>
      <p className="mt-1 text-label text-muted">
        {loanLabel} · Solo la descripción puede editarse aquí — el monto, la
        tasa y el desglose de cuotas ya generaron las cuotas reales. Si el
        préstamo quedó mal desde el inicio, use Refinanciar en su lugar.
      </p>

      <div className="mt-5 border-t border-border" />

      <form onSubmit={handleSubmit} className="mt-5 flex flex-col gap-3.5">
        <Field label="Descripción (opcional)">
          <textarea
            value={descriptionInput}
            onChange={(event) => setDescriptionInput(event.target.value)}
            placeholder="Ej: Compra de electrodoméstico…"
            rows={2}
            className="w-full resize-none rounded border border-border bg-input px-3.5 py-2 text-control text-white placeholder-mid focus:border-subtle focus:outline-none"
          />
        </Field>

        {error && (
          <p className="text-small text-danger" role="alert">
            {error}
          </p>
        )}

        <div className="mt-2.5 border-t border-border" />

        <div className="mt-2 flex items-center justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Guardando…' : 'Guardar cambios'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[10px] font-normal tracking-normal text-muted">
        {label}
      </span>
      {children}
    </div>
  );
}
