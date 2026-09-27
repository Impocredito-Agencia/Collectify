import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { CurrencyInput } from '@/components/ui/CurrencyInput';
import { Field } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { useRefundClientCredit } from '@/features/clients/useClients';
import { ApiError } from '@/lib/apiClient';
import { formatCurrency } from '@/lib/format';
import { useEscapeKey } from '@/lib/useEscapeKey';

interface RefundClientCreditDialogProps {
  clientId: string;
  // The client's current saldo a favor — the most that can be returned.
  balance: number;
  onClose: () => void;
}

const inputClassName =
  'h-[42px] w-full rounded border border-border bg-input px-3.5 text-control text-white placeholder-mid focus:border-subtle focus:outline-none';

// Human request, 2026-09-26 — "devolver al cliente": records that cash from
// the client's saldo a favor was handed back to them. The honest way to take
// a credit off the books instead of discarding it — that money is the
// client's. It only RECORDS the return (nothing moves electronically),
// deducts it from the balance and leaves who/when/why in Auditoría. Admin
// only, like voiding a payment, so ClientCreditBanner only offers it to
// admins. Two steps because cash leaving can't be undone from here.
export function RefundClientCreditDialog({
  clientId,
  balance,
  onClose,
}: RefundClientCreditDialogProps) {
  useEscapeKey(onClose);

  const refund = useRefundClientCredit();
  const [amount, setAmount] = useState(Math.floor(balance));
  const [reason, setReason] = useState('');
  const [isConfirming, setIsConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleContinue = () => {
    setError(null);
    if (!(amount > 0)) {
      setError('El monto a devolver debe ser mayor a 0.');
      return;
    }
    if (amount > balance) {
      setError(
        `No puedes devolver más que el saldo disponible (${formatCurrency(balance)}).`,
      );
      return;
    }
    setIsConfirming(true);
  };

  const handleConfirm = async () => {
    setError(null);
    try {
      await refund.mutateAsync({
        clientId,
        amount,
        reason: reason.trim() || undefined,
      });
      onClose();
    } catch (err) {
      setIsConfirming(false);
      setError(
        err instanceof ApiError
          ? err.message
          : 'No se pudo registrar la devolución. Intenta de nuevo.',
      );
    }
  };

  return (
    <Modal maxWidth="max-w-[440px]">
      <h2 className="text-[16px] font-medium text-white">
        Devolver saldo a favor
      </h2>
      <p className="mt-2.5 text-small text-muted">
        El cliente tiene {formatCurrency(balance)} de saldo a favor. Aquí
        registras que se le devolvió (todo o una parte) en efectivo; ese monto
        se descuenta del saldo y queda en Auditoría. Si prefieres usarlo para
        pagar cuotas, cierra esto y usa "Aplicar".
      </p>

      <div className="mt-5 flex flex-col gap-3.5">
        <Field label="Monto a devolver" layout="stack">
          <CurrencyInput
            value={amount}
            onChange={setAmount}
            className={inputClassName}
            disabled={isConfirming}
          />
        </Field>
        <Field label="Motivo (opcional)" layout="stack">
          <input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Ej: el cliente pidió que se le devolviera el excedente"
            maxLength={500}
            disabled={isConfirming}
            className={inputClassName}
          />
        </Field>
      </div>

      {isConfirming && (
        <p
          className="mt-3 rounded border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-small text-amber-300"
          role="alert"
        >
          Vas a registrar la devolución de{' '}
          <strong>{formatCurrency(amount)}</strong>; el saldo del cliente
          quedará en <strong>{formatCurrency(balance - amount)}</strong>. Esta
          acción no se puede deshacer.
        </p>
      )}

      {error && (
        <p className="mt-3 text-small text-danger" role="alert">
          {error}
        </p>
      )}

      <div className="mt-6 border-t border-border" />

      <div className="mt-5 flex items-center justify-end gap-3">
        <Button
          variant="secondary"
          onClick={isConfirming ? () => setIsConfirming(false) : onClose}
          disabled={refund.isPending}
        >
          {isConfirming ? 'Volver' : 'Cancelar'}
        </Button>
        {isConfirming ? (
          <Button
            variant="dangerSolid"
            onClick={() => void handleConfirm()}
            disabled={refund.isPending}
          >
            {refund.isPending ? 'Registrando…' : 'Sí, registrar devolución'}
          </Button>
        ) : (
          <Button onClick={handleContinue}>Continuar</Button>
        )}
      </div>
    </Modal>
  );
}
