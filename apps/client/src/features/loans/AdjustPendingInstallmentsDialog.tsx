import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { CloseButton } from '@/components/ui/CloseButton';
import { CurrencyInput } from '@/components/ui/CurrencyInput';
import { Field } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { ApiError } from '@/lib/apiClient';
import { formatCurrency } from '@/lib/format';
import { useEscapeKey } from '@/lib/useEscapeKey';

import type { Installment } from '@/features/installments/installmentsApi';

type AdjustmentDirection = 'increase' | 'decrease';

const DIRECTION_OPTIONS: { value: AdjustmentDirection; label: string }[] = [
  { value: 'increase', label: 'Subir' },
  { value: 'decrease', label: 'Bajar' },
];

interface AdjustPendingInstallmentsDialogProps {
  // Only PENDING installments — LoanDetailPage filters this before opening
  // the dialog, same as RescheduleDueDatesDialog.
  installments: Installment[];
  loanLabel: string;
  onClose: () => void;
  // Signed whole pesos: positive raises every pending cuota, negative
  // lowers them.
  onConfirm: (amountPerInstallment: number) => Promise<unknown>;
}

// Human request, 2026-09-25 — two pagarés were loaded from the old Excel
// with every pending cuota $10.000 short, and the clients already know
// their real cuota, so Refinanciar (new pagaré + WhatsApp) was the wrong
// tool. Only reachable on a pagaré the api has explicitly unlocked
// (LoanDetail.canAdjustPendingInstallments). The adjustment is booked as
// capital on every pending cuota and sends no message — both spelled out
// in the copy below, since that's the whole point of this action.
export function AdjustPendingInstallmentsDialog({
  installments,
  loanLabel,
  onClose,
  onConfirm,
}: AdjustPendingInstallmentsDialogProps) {
  const sortedInstallments = [...installments].sort(
    (a, b) => a.installmentNumber - b.installmentNumber,
  );

  const [direction, setDirection] = useState<AdjustmentDirection>('increase');
  const [amount, setAmount] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEscapeKey(onClose);

  const signedAmount = direction === 'increase' ? amount : -amount;
  const firstInstallment = sortedInstallments[0];
  const count = sortedInstallments.length;
  // Human request, 2026-10-19 — lowering a cuota whose payments already
  // cover its corrected amount closes it as paid (the api does the same
  // check). What's been paid so far is recovered from totalDue, which the
  // api returns already net of it.
  const settledNumbers =
    signedAmount < 0
      ? sortedInstallments
          .filter(
            (installment) =>
              installment.amount +
                installment.interest -
                installment.totalDue >=
              installment.amount + signedAmount,
          )
          .map((installment) => installment.installmentNumber)
      : [];

  const handleConfirm = async () => {
    setError(null);
    setIsSubmitting(true);
    try {
      await onConfirm(signedAmount);
      onClose();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'No se pudieron ajustar las cuotas. Intenta de nuevo.',
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal maxWidth="max-w-[480px]">
      <div className="flex items-center justify-between">
        <h2 className="text-[16px] font-medium text-white">
          Ajustar cuotas pendientes
        </h2>
        <CloseButton onClick={onClose} />
      </div>
      <p className="mt-1 text-label text-muted">
        {loanLabel} · Suma o resta el mismo valor a cada cuota pendiente, como
        capital. No se envía ningún mensaje al cliente.
      </p>

      <div className="mt-5 border-t border-border" />

      <div className="mt-5 flex items-end gap-3">
        <Field label="Acción">
          <Select
            value={direction}
            onChange={(value) => setDirection(value as AdjustmentDirection)}
            options={DIRECTION_OPTIONS}
            className="w-28"
          />
        </Field>
        <Field label="Valor por cuota">
          <CurrencyInput
            value={amount}
            onChange={setAmount}
            className="h-[42px] w-full rounded border border-border bg-input px-3.5 text-control text-white focus:border-subtle focus:outline-none"
          />
        </Field>
      </div>

      {firstInstallment && amount > 0 && (
        <p className="mt-3 text-meta text-muted">
          Vista previa: cuota {firstInstallment.installmentNumber} pasa de{' '}
          {formatCurrency(firstInstallment.amount)} a{' '}
          {formatCurrency(firstInstallment.amount + signedAmount)}
          {count > 1 &&
            ` (y ${count - 1} cuota${count > 2 ? 's' : ''} más igual)`}
          . El capital del préstamo {direction === 'increase' ? 'sube' : 'baja'}{' '}
          {formatCurrency(amount * count)} en total.
        </p>
      )}
      {settledNumbers.length > 0 && (
        <p className="mt-2 text-meta text-muted">
          {settledNumbers.length === 1
            ? `La cuota ${settledNumbers[0]} queda pagada`
            : `Las cuotas ${settledNumbers.join(', ')} quedan pagadas`}{' '}
          con lo ya abonado, sin cobrar su mora.
        </p>
      )}
      {count === 0 && (
        <p className="mt-3 text-small text-muted">
          Este préstamo no tiene cuotas pendientes para ajustar.
        </p>
      )}

      {error && (
        <p className="mt-3 text-small text-danger" role="alert">
          {error}
        </p>
      )}

      <div className="mt-5 flex items-center justify-end gap-3">
        <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>
          Cancelar
        </Button>
        <Button
          disabled={isSubmitting || amount === 0 || count === 0}
          onClick={() => void handleConfirm()}
        >
          {isSubmitting
            ? 'Aplicando…'
            : `Aplicar a ${count} cuota${count === 1 ? '' : 's'}`}
        </Button>
      </div>
    </Modal>
  );
}
