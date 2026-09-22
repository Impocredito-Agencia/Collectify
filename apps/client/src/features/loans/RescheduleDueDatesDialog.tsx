import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { CloseButton } from '@/components/ui/CloseButton';
import { DatePicker } from '@/components/ui/DatePicker';
import { Field } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { withDayOfMonth } from '@/features/loans/dueDateMath';
import { ApiError } from '@/lib/apiClient';
import { formatDateOnly } from '@/lib/format';
import { useEscapeKey } from '@/lib/useEscapeKey';

import type { Installment } from '@/features/installments/installmentsApi';

interface RescheduleDueDatesDialogProps {
  // Only PENDING installments — a paid/cancelled one's date is closed, see
  // InstallmentsService.updateDueDate's own guard. LoanDetailPage filters
  // this before opening the dialog.
  installments: Installment[];
  loanLabel: string;
  onClose: () => void;
  // Bulk path ("que queden todas el 10") — one request, one transaction.
  onAlignAll: (dayOfMonth: number) => Promise<unknown>;
  // Individual path ("una por una") — one request per changed row, fired
  // sequentially below.
  onUpdateOne: (installmentId: string, dueDate: string) => Promise<unknown>;
}

// Human report, 2026-09-22 — "tenemos algunas que están el primero y la
// quieren, por ejemplo, que queden todas el 10, o quedaron 20 y quieren
// ponerla más baja, que se pueda modificar el día." Two ways to reschedule
// a loan's still-pending cuotas, confirmed with the human:
//   1. Move every pending installment to the same day of the month at
//      once (the common case — the whole pagaré was set up on the wrong
//      day).
//      2. Edit one installment's date individually (a one-off correction).
// Deliberately NOT the same "loan's numbers are fixed at creation" rule as
// EditLoanDialog — this only ever touches dueDate, never amount/principal/
// concepts, so it doesn't need Refinanciar's weight or a second confirm
// step (see UpdateLoanDto's own comment for why that rule exists).
export function RescheduleDueDatesDialog({
  installments,
  loanLabel,
  onClose,
  onAlignAll,
  onUpdateOne,
}: RescheduleDueDatesDialogProps) {
  const sortedInstallments = [...installments].sort(
    (a, b) => a.installmentNumber - b.installmentNumber,
  );

  const [dayOfMonth, setDayOfMonth] = useState(10);
  const [isAligning, setIsAligning] = useState(false);
  const [alignError, setAlignError] = useState<string | null>(null);

  // Keyed by installment id — only rows the admin actually edited end up
  // here, so "Guardar cambios" below only submits what changed instead of
  // resending every row's unchanged date.
  const [editedDates, setEditedDates] = useState<Record<string, string>>({});
  const [isSavingRows, setIsSavingRows] = useState(false);
  const [rowsError, setRowsError] = useState<string | null>(null);

  useEscapeKey(onClose);

  const changedCount = Object.keys(editedDates).length;

  const handleAlignAll = async () => {
    setAlignError(null);
    setIsAligning(true);
    try {
      await onAlignAll(dayOfMonth);
      onClose();
    } catch (err) {
      setAlignError(
        err instanceof ApiError
          ? err.message
          : 'No se pudieron reprogramar las cuotas. Intenta de nuevo.',
      );
    } finally {
      setIsAligning(false);
    }
  };

  const handleSaveRows = async () => {
    setRowsError(null);
    setIsSavingRows(true);
    try {
      for (const [installmentId, dueDate] of Object.entries(editedDates)) {
        await onUpdateOne(installmentId, dueDate);
      }
      onClose();
    } catch (err) {
      setRowsError(
        err instanceof ApiError
          ? err.message
          : 'No se pudieron guardar las fechas. Las cuotas ya actualizadas quedaron guardadas — revisa cuáles faltan e intenta de nuevo.',
      );
    } finally {
      setIsSavingRows(false);
    }
  };

  const isBusy = isAligning || isSavingRows;

  return (
    <Modal maxWidth="max-w-[560px]" scroll maxHeight="max-h-[85vh]">
      <div className="flex items-center justify-between">
        <h2 className="text-[16px] font-medium text-white">
          Editar fechas de cobro
        </h2>
        <CloseButton onClick={onClose} />
      </div>
      <p className="mt-1 text-label text-muted">
        {loanLabel} · Solo mueve la fecha de las cuotas pendientes — el monto,
        el capital y los intereses no cambian.
      </p>

      <div className="mt-5 border-t border-border" />

      <div className="mt-5 flex flex-col gap-3">
        <span className="text-small font-medium text-white">
          Mover todas las cuotas pendientes al mismo día
        </span>
        <div className="flex items-end gap-3">
          <Field label="Día del mes">
            <input
              type="number"
              min={1}
              max={31}
              value={dayOfMonth}
              onChange={(event) =>
                setDayOfMonth(
                  Math.min(31, Math.max(1, Number(event.target.value) || 1)),
                )
              }
              className="h-[42px] w-24 rounded border border-border bg-input px-3.5 text-control text-white focus:border-subtle focus:outline-none"
            />
          </Field>
          <Button
            type="button"
            variant="secondary"
            disabled={isBusy}
            onClick={() => void handleAlignAll()}
          >
            {isAligning ? 'Aplicando…' : 'Aplicar a todas las pendientes'}
          </Button>
        </div>
        {sortedInstallments.length > 0 && (
          <p className="text-meta text-muted">
            Vista previa: cuota {sortedInstallments[0].installmentNumber} pasa
            de {formatDateOnly(sortedInstallments[0].dueDate)} a{' '}
            {formatDateOnly(
              withDayOfMonth(sortedInstallments[0].dueDate, dayOfMonth),
            )}
            {sortedInstallments.length > 1 &&
              ` (y ${sortedInstallments.length - 1} cuota${sortedInstallments.length > 2 ? 's' : ''} más)`}
            .
          </p>
        )}
        {alignError && (
          <p className="text-small text-danger" role="alert">
            {alignError}
          </p>
        )}
      </div>

      <div className="mt-5 border-t border-border" />

      <div className="mt-5 flex flex-col gap-3">
        <span className="text-small font-medium text-white">
          O edita una cuota individual
        </span>
        <div className="flex flex-col gap-2.5">
          {sortedInstallments.map((installment) => (
            <div
              key={installment.id}
              className="flex items-center justify-between gap-3 rounded border border-border bg-input/40 px-3.5 py-2.5"
            >
              <span className="text-small text-muted">
                Cuota {installment.installmentNumber} · Fecha actual:{' '}
                {formatDateOnly(installment.dueDate)}
              </span>
              <DatePicker
                value={editedDates[installment.id] ?? installment.dueDate}
                onChange={(value) =>
                  setEditedDates((current) => ({
                    ...current,
                    [installment.id]: value,
                  }))
                }
                className="h-9 w-[150px] rounded border border-border bg-input px-3 text-small text-white focus:border-subtle focus:outline-none"
              />
            </div>
          ))}
          {sortedInstallments.length === 0 && (
            <p className="text-small text-muted">
              Este préstamo no tiene cuotas pendientes para reprogramar.
            </p>
          )}
        </div>
        {rowsError && (
          <p className="text-small text-danger" role="alert">
            {rowsError}
          </p>
        )}
      </div>

      <div className="mt-5 border-t border-border" />

      <div className="mt-5 flex items-center justify-end gap-3">
        <Button variant="secondary" onClick={onClose} disabled={isBusy}>
          Cerrar
        </Button>
        <Button
          disabled={isBusy || changedCount === 0}
          onClick={() => void handleSaveRows()}
        >
          {isSavingRows
            ? 'Guardando…'
            : changedCount > 0
              ? `Guardar ${changedCount} cambio${changedCount > 1 ? 's' : ''}`
              : 'Guardar cambios'}
        </Button>
      </div>
    </Modal>
  );
}
