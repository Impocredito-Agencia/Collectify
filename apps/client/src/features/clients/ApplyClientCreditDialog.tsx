import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { CurrencyInput } from '@/components/ui/CurrencyInput';
import { Field } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { InstallmentStatus } from '@/features/installments/installmentsApi';
import {
  useApplyClientCredit,
  useInstallments,
} from '@/features/installments/useInstallments';
import { LoanStatus } from '@/features/loans/loansApi';
import { useLoans } from '@/features/loans/useLoans';
import { ApiError } from '@/lib/apiClient';
import { formatCurrency } from '@/lib/format';
import { useEscapeKey } from '@/lib/useEscapeKey';

interface ApplyClientCreditDialogProps {
  clientId: string;
  balance: number;
  // When set (opened from LoanDetailPage), this loan is fixed — no loan
  // picker shown, only its own pending cuotas. When omitted (opened from
  // ClientDetailPage, where the credit isn't tied to any one loan —
  // confirmed with the human it must be applicable to any of the client's
  // loans), a loan picker comes first.
  loanId?: string;
  onClose: () => void;
}

export function ApplyClientCreditDialog({
  clientId,
  balance,
  loanId,
  onClose,
}: ApplyClientCreditDialogProps) {
  useEscapeKey(onClose);

  const [selectedLoanId, setSelectedLoanId] = useState(loanId ?? '');
  const [selectedInstallmentId, setSelectedInstallmentId] = useState('');
  const [amount, setAmount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Only fetched (and only rendered as a picker) when no loanId was fixed
  // by the caller — cheap enough to always call regardless, same
  // "conditional rendering, not conditional hooks" pattern every other
  // dialog in this app follows.
  const { data: loans } = useLoans({
    clientId,
    status: LoanStatus.Active,
    limit: 100,
  });
  const { data: installments } = useInstallments({
    loanId: selectedLoanId,
    status: InstallmentStatus.Pending,
    limit: 100,
  });

  const selectedInstallment = installments?.items.find(
    (installment) => installment.id === selectedInstallmentId,
  );
  const maxApplicable = selectedInstallment
    ? Math.min(balance, Math.ceil(selectedInstallment.totalDue))
    : 0;

  // Pre-fills with the sensible default (as much of the credit as this
  // cuota can actually use) every time a different cuota is picked —
  // still editable down, same "shown for reference, not locked" spirit as
  // RegisterPaymentDialog's own balance hint.
  useEffect(() => {
    setAmount(maxApplicable);
  }, [maxApplicable]);

  const applyCredit = useApplyClientCredit();

  const handleConfirm = () => {
    setError(null);
    if (!selectedInstallmentId) {
      setError('Elige a qué cuota aplicar el saldo.');
      return;
    }
    if (!(amount > 0)) {
      setError('El monto a aplicar debe ser mayor a 0.');
      return;
    }
    if (amount > balance) {
      setError('El monto supera el saldo a favor disponible.');
      return;
    }

    applyCredit.mutate(
      {
        installmentId: selectedInstallmentId,
        clientId,
        amount,
        loanId: selectedLoanId,
      },
      {
        onSuccess: () => onClose(),
        onError: (err) => {
          setError(
            err instanceof ApiError
              ? err.message
              : 'No se pudo aplicar el saldo a favor. Intenta de nuevo.',
          );
        },
      },
    );
  };

  return (
    <Modal maxWidth="max-w-[440px]">
      <h2 className="text-[16px] font-medium text-white">
        Aplicar saldo a favor
      </h2>
      <p className="mt-1 text-label text-muted">
        Saldo disponible: {formatCurrency(balance)}
      </p>

      <div className="mt-5 border-t border-border" />

      <div className="mt-5 flex flex-col gap-3.5">
        {!loanId && (
          <Field label="Préstamo">
            <Select
              value={selectedLoanId}
              onChange={(value) => {
                setSelectedLoanId(value);
                setSelectedInstallmentId('');
              }}
              placeholder="Elige un préstamo"
              options={(loans?.items ?? []).map((loan) => ({
                value: loan.id,
                label: `Pagaré ${loan.promissoryNoteNumber}`,
              }))}
            />
          </Field>
        )}

        <Field label="Cuota">
          <Select
            value={selectedInstallmentId}
            onChange={setSelectedInstallmentId}
            placeholder={
              selectedLoanId
                ? 'Elige una cuota pendiente'
                : 'Elige un préstamo primero'
            }
            options={(installments?.items ?? []).map((installment) => ({
              value: installment.id,
              label: `Cuota ${installment.installmentNumber} — Saldo ${formatCurrency(installment.totalDue)}`,
            }))}
          />
        </Field>

        <Field label="Monto a aplicar">
          <CurrencyInput
            value={amount}
            onChange={setAmount}
            className="h-[42px] w-full rounded border border-border bg-input px-3.5 text-control text-white placeholder-mid focus:border-subtle focus:outline-none"
          />
          {selectedInstallment && (
            <span className="mt-1 text-meta text-muted">
              Máximo aplicable a esta cuota: {formatCurrency(maxApplicable)}
            </span>
          )}
        </Field>

        {error && (
          <p className="text-small text-danger" role="alert">
            {error}
          </p>
        )}
      </div>

      <div className="mt-5 border-t border-border" />

      <div className="mt-5 flex items-center justify-end gap-3">
        <Button
          variant="secondary"
          onClick={onClose}
          disabled={applyCredit.isPending}
        >
          Cancelar
        </Button>
        <Button onClick={handleConfirm} disabled={applyCredit.isPending}>
          {applyCredit.isPending ? 'Aplicando…' : 'Aplicar saldo'}
        </Button>
      </div>
    </Modal>
  );
}
