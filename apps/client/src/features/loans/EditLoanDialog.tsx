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
  interestRate: number;
  description: string | null;
  onClose: () => void;
  onConfirm: (input: UpdateLoanInput) => Promise<unknown>;
}

// PATCH /loans/:id (apps/api/src/loans/dto/updateLoan.dto.ts) only allows
// interestRate/description — principalAmount and the installment schedule
// aren't patchable (would cascade into already-generated installments).
// Post-review gap: this mutation (useUpdateLoan) has existed in the data
// layer since Phase 4, and both fields are collected at loan creation, but
// neither was ever shown again afterward and there was no way to fix a
// typo. See apps/client/docs/DESIGN_TOKENS.md "Known design/backend gaps".
export function EditLoanDialog({
  loanLabel,
  interestRate,
  description,
  onClose,
  onConfirm,
}: EditLoanDialogProps) {
  const [interestRateInput, setInterestRateInput] = useState(
    String(interestRate),
  );
  const [descriptionInput, setDescriptionInput] = useState(description ?? '');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEscapeKey(onClose);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    const rate = parseFloat(interestRateInput);
    if (Number.isNaN(rate) || rate < 0 || rate > 100) {
      setError('La tasa debe estar entre 0 y 100.');
      return;
    }

    setIsSubmitting(true);
    try {
      await onConfirm({
        interestRate: rate,
        description: descriptionInput.trim() || undefined,
      });
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
        <h2 className="text-[16px] font-medium text-white">Editar préstamo</h2>
        <CloseButton onClick={onClose} />
      </div>
      <p className="mt-1 text-label text-muted">
        {loanLabel} · Solo la tasa de interés y la descripción pueden editarse —
        el monto y el desglose de cuotas ya generaron las cuotas reales,
        cambiarlos las dejaría inconsistentes.
      </p>

      <div className="mt-5 border-t border-border" />

      <form onSubmit={handleSubmit} className="mt-5 flex flex-col gap-3.5">
        <Field label="Incremento en mora (%)">
          <input
            type="number"
            min={0}
            max={100}
            step="0.1"
            value={interestRateInput}
            onChange={(event) => setInterestRateInput(event.target.value)}
            className="h-[42px] w-full rounded border border-border bg-input px-3.5 text-control text-white placeholder-mid focus:border-subtle focus:outline-none"
          />
        </Field>

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
