import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { matchesPromissoryNoteNumber } from '@/features/loans/promissoryNoteNumberMatch';
import {
  useDeleteLoan,
  useLoanDeletionPreview,
} from '@/features/loans/useLoanDeletion';
import { ApiError } from '@/lib/apiClient';
import { formatCurrency } from '@/lib/format';
import { inputClassName } from '@/lib/formStyles';
import { useEscapeKey } from '@/lib/useEscapeKey';

import type { LoanDeletionPreview } from '@/features/loans/loanDeletionApi';

interface DeleteLoanDialogProps {
  loanId: string;
  onDeleted: () => void;
  onClose: () => void;
}

// Phase 35 — replaces Phase 30's single "¿está seguro?" confirm. Deleting is
// now allowed with payments and is IRREVERSIBLE, so the human asked for a
// deliberately heavy, red, two-step flow nobody can click through by
// accident ("que no puedan decir después que se equivocaron"):
//   1. what exactly will happen (from GET /loans/:id/deletion-preview) plus
//      a mandatory reason — blocked here, in red, if the api says it can't
//      be deleted right now;
//   2. "no se puede deshacer", and the pagaré number typed to confirm.
// See docs/phasesClient/PHASE_35_LOAN_DELETION.md.
export function DeleteLoanDialog({
  loanId,
  onDeleted,
  onClose,
}: DeleteLoanDialogProps) {
  const [step, setStep] = useState<1 | 2>(1);
  const [reason, setReason] = useState('');
  const [typedNumber, setTypedNumber] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data: preview, isLoading, isError } = useLoanDeletionPreview(loanId);
  const deleteLoan = useDeleteLoan();

  useEscapeKey(onClose);

  const trimmedReason = reason.trim();
  const canContinue =
    preview !== undefined &&
    preview.blockers.length === 0 &&
    trimmedReason.length > 0;
  const numberMatches =
    preview !== undefined &&
    matchesPromissoryNoteNumber(typedNumber, preview.promissoryNoteNumber);

  const handleDelete = async () => {
    if (!preview || !numberMatches) {
      return;
    }
    setError(null);
    try {
      await deleteLoan.mutateAsync({
        id: loanId,
        input: {
          reason: trimmedReason,
          confirmPromissoryNoteNumber: typedNumber,
        },
      });
      onDeleted();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'No se pudo eliminar el pagaré. Intenta de nuevo.',
      );
    }
  };

  return (
    <Modal maxWidth="max-w-[520px]" scroll>
      <h2 className="text-[16px] font-medium text-danger">
        Eliminar pagaré{preview ? ` ${preview.promissoryNoteNumber}` : ''}
      </h2>
      <p className="mt-1 text-label text-muted">
        Paso {step} de 2{preview ? ` · ${preview.clientFullName}` : ''}
      </p>

      <div className="mt-5 border-t border-border" />

      {isLoading && (
        <p className="mt-5 text-small text-muted">Revisando el pagaré…</p>
      )}
      {isError && (
        <p className="mt-5 text-small text-danger" role="alert">
          No se pudo revisar el pagaré. Cierra e intenta de nuevo.
        </p>
      )}

      {preview && step === 1 && (
        <div className="mt-5 flex flex-col gap-4">
          <DeletionSummary preview={preview} />

          {preview.blockers.length > 0 ? (
            <div
              className="rounded border border-danger bg-danger-bg px-3.5 py-3 text-small text-danger"
              role="alert"
            >
              <p className="font-medium">No se puede eliminar todavía:</p>
              <ul className="mt-1.5 list-disc pl-5">
                {preview.blockers.map((blocker) => (
                  <li key={blocker}>{blocker}</li>
                ))}
              </ul>
            </div>
          ) : (
            <Field
              label="Motivo de la eliminación (obligatorio)"
              layout="stack"
            >
              <textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Ej: pagaré de prueba, creado por error…"
                rows={3}
                maxLength={500}
                className="w-full resize-none rounded border border-border bg-input px-3.5 py-2 text-control text-white placeholder-mid focus:border-subtle focus:outline-none"
              />
            </Field>
          )}
        </div>
      )}

      {preview && step === 2 && (
        <div className="mt-5 flex flex-col gap-4">
          <div
            className="rounded border border-danger bg-danger-bg px-3.5 py-3"
            role="alert"
          >
            <p className="text-control font-semibold text-danger">
              Esta acción es permanente y no se puede deshacer.
            </p>
            <p className="mt-1.5 text-small text-danger">
              El pagaré {preview.promissoryNoteNumber} dejará de aparecer en la
              app. Solo se podrá consultar, sin cambios, en Préstamos →
              Eliminados.
            </p>
          </div>

          <p className="text-small text-muted">
            Motivo: <span className="text-white">{trimmedReason}</span>
          </p>

          <Field
            label={`Escribe ${preview.promissoryNoteNumber} para confirmar`}
            layout="stack"
          >
            <input
              value={typedNumber}
              onChange={(event) => {
                setTypedNumber(event.target.value);
                setError(null);
              }}
              placeholder={preview.promissoryNoteNumber}
              autoFocus
              className={inputClassName(false)}
            />
          </Field>

          {error && (
            <p className="text-small text-danger" role="alert">
              {error}
            </p>
          )}
        </div>
      )}

      <div className="mt-6 border-t border-border" />

      <div className="mt-5 flex items-center justify-end gap-3">
        {step === 1 ? (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button
              variant="danger"
              onClick={() => setStep(2)}
              disabled={!canContinue}
            >
              Continuar
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setStep(1);
                setTypedNumber('');
                setError(null);
              }}
              disabled={deleteLoan.isPending}
            >
              Atrás
            </Button>
            <Button
              variant="dangerSolid"
              onClick={() => void handleDelete()}
              disabled={!numberMatches || deleteLoan.isPending}
            >
              {deleteLoan.isPending
                ? 'Eliminando…'
                : 'Eliminar definitivamente'}
            </Button>
          </>
        )}
      </div>
    </Modal>
  );
}

// Step 1's red "this is what will happen" box.
function DeletionSummary({ preview }: { preview: LoanDeletionPreview }) {
  const chainNumbers = preview.chainLoans
    .map((chainLoan) => chainLoan.promissoryNoteNumber)
    .join(', ');
  return (
    <div className="rounded border border-danger/40 bg-danger/10 px-3.5 py-3 text-small text-strong">
      <p className="font-medium text-danger">Al eliminar este pagaré:</p>
      <ul className="mt-1.5 flex list-disc flex-col gap-1 pl-5">
        <li>
          Se elimina el pagaré {preview.promissoryNoteNumber} con sus{' '}
          {preview.installmentCount} cuota(s).
        </li>
        {preview.chainLoans.length > 0 && (
          <li>
            Se eliminan también los pagarés de esta cadena de refinanciamiento:{' '}
            {chainNumbers}.
          </li>
        )}
        <li>
          {preview.paymentCount > 0
            ? `Sus ${preview.paymentCount} pago(s), por ${formatCurrency(preview.paymentsTotal)}, quedarán anulados y dejarán de contar en los reportes.`
            : 'No tiene pagos registrados.'}
        </li>
        {preview.creditToRestore > 0 && (
          <li>
            Se le devolverán {formatCurrency(preview.creditToRestore)} de saldo
            a favor a {preview.clientFullName}.
          </li>
        )}
        {preview.creditToReverse > 0 && (
          <li>
            Se descontarán {formatCurrency(preview.creditToReverse)} del saldo a
            favor de {preview.clientFullName}.
          </li>
        )}
        <li>No se envía ningún mensaje al cliente.</li>
      </ul>
    </div>
  );
}
