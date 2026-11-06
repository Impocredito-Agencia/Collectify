import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { CloseButton } from '@/components/ui/CloseButton';
import { Field } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { PROMISSORY_NOTE_NUMBER_PATTERN } from '@/features/loans/loansApi';
import { ApiError } from '@/lib/apiClient';
import { inputClassName } from '@/lib/formStyles';
import { useEscapeKey } from '@/lib/useEscapeKey';

import type { FormEvent } from 'react';

interface RenumberLoanDialogProps {
  loanLabel: string;
  promissoryNoteNumber: string;
  // Whether this loan came from a refinance — only changes the copy, the
  // backend decides which earlier loans actually share the number.
  isRefinanced: boolean;
  onClose: () => void;
  onConfirm: (promissoryNoteNumber: string) => Promise<unknown>;
}

// Human request, 2026-10-21 — PATCH /loans/:id/promissory-note-number. A
// pagaré created with the wrong number used to be fixable only by deleting
// it, which is blocked once it has a payment. Active loans only; silent (no
// WhatsApp message), audited as loan.renumber.
export function RenumberLoanDialog({
  loanLabel,
  promissoryNoteNumber,
  isRefinanced,
  onClose,
  onConfirm,
}: RenumberLoanDialogProps) {
  const [numberInput, setNumberInput] = useState(promissoryNoteNumber);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEscapeKey(onClose);

  const trimmed = numberInput.trim();
  const isUnchanged = trimmed === promissoryNoteNumber;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!PROMISSORY_NOTE_NUMBER_PATTERN.test(trimmed)) {
      setError('El número de pagaré debe tener el formato #0000.');
      return;
    }

    setIsSubmitting(true);
    try {
      await onConfirm(trimmed);
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 409) {
        setError(
          'Ese número ya lo tiene otro préstamo, o perteneció a un pagaré eliminado que tenía pagos.',
        );
      } else {
        setError(
          err instanceof ApiError
            ? err.message
            : 'No se pudo cambiar el número. Intenta de nuevo.',
        );
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal maxWidth="max-w-[440px]">
      <div className="flex items-center justify-between">
        <h2 className="text-[16px] font-medium text-white">
          Cambiar número de pagaré
        </h2>
        <CloseButton onClick={onClose} />
      </div>
      <p className="mt-1 text-label text-muted">
        {loanLabel} · No se envía ningún mensaje al cliente. Los mensajes ya
        enviados conservan el número anterior.
        {isRefinanced &&
          ' Los préstamos anteriores de este refinanciamiento que tengan el mismo número también se renombran.'}
      </p>

      <div className="mt-5 border-t border-border" />

      <form onSubmit={handleSubmit} className="mt-5 flex flex-col gap-3.5">
        <Field label="Nuevo número de pagaré" layout="stack">
          <input
            value={numberInput}
            onChange={(event) => {
              setNumberInput(event.target.value);
              setError(null);
            }}
            placeholder="Ej: #1191"
            autoFocus
            className={inputClassName(Boolean(error))}
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
          <Button type="submit" disabled={isSubmitting || isUnchanged}>
            {isSubmitting ? 'Guardando…' : 'Guardar número'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
