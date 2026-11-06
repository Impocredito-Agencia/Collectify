import { useState } from 'react';

import { useQueryClient } from '@tanstack/react-query';

import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { InstallmentStatus } from '@/features/installments/installmentsApi';
import { RegisterPaymentDialog } from '@/features/installments/RegisterPaymentDialog';
import { useRegisterPayment } from '@/features/installments/useInstallments';
import { LoanStatus } from '@/features/loans/loansApi';
import { useLoan, useLoans } from '@/features/loans/useLoans';
import { formatCurrency, formatDateOnly } from '@/lib/format';
import { useEscapeKey } from '@/lib/useEscapeKey';

import type { LoanSummary } from '@/features/loans/loansApi';

interface RegisterPaymentFromWhatsappModalProps {
  clientId: string;
  mediaUrl: string;
  sourceWhatsappMessageId: string;
  onClose: () => void;
}

// Human report, 2026-09-11 — the "Registrar pago con este comprobante"
// flow: a WhatsApp message only knows which client sent it, not which
// préstamo/cuota the comprobante is for, so this walks the collector
// through picking both before opening RegisterPaymentDialog (reused as-is)
// with the comprobante already attached via initialImageUrls. Deliberately
// a self-contained modal (not a navigation to ClientDetailPage/
// LoanDetailPage carrying state across pages) — simpler and can't lose the
// comprobante mid-flow on a refresh.
export function RegisterPaymentFromWhatsappModal({
  clientId,
  mediaUrl,
  sourceWhatsappMessageId,
  onClose,
}: RegisterPaymentFromWhatsappModalProps) {
  const [selectedLoan, setSelectedLoan] = useState<LoanSummary | null>(null);
  const [selectedInstallmentId, setSelectedInstallmentId] = useState<
    string | null
  >(null);

  useEscapeKey(onClose);

  const { data: loansResult, isLoading: isLoadingLoans } = useLoans({
    clientId,
    status: LoanStatus.Active,
    limit: 100,
  });
  const { data: loan, isLoading: isLoadingLoan } = useLoan(
    selectedLoan?.id ?? '',
  );
  const queryClient = useQueryClient();
  const registerPayment = useRegisterPayment(selectedLoan?.id ?? '');

  const selectedInstallment = loan?.installments.find(
    (installment) => installment.id === selectedInstallmentId,
  );

  if (selectedLoan && selectedInstallment) {
    return (
      <RegisterPaymentDialog
        installment={selectedInstallment}
        loanLabel={`${selectedLoan.promissoryNoteNumber} — ${selectedLoan.clientFullName}`}
        minPaidAt={loan?.disbursedAt}
        initialImageUrls={[mediaUrl]}
        onClose={onClose}
        onConfirm={async (input) => {
          const result = await registerPayment.mutateAsync({
            installmentId: selectedInstallment.id,
            input: { ...input, sourceWhatsappMessageId },
          });
          // Not covered by useRegisterPayment's own invalidation (loans/
          // installments only) — this is the one caller that also needs
          // the inbox to pick up the new "✅ Ya registrado" link.
          await queryClient.invalidateQueries({
            queryKey: ['whatsappInboundMessages'],
          });
          return result;
        }}
      />
    );
  }

  if (selectedLoan) {
    const pendingInstallments =
      loan?.installments.filter(
        (installment) => installment.status === InstallmentStatus.Pending,
      ) ?? [];

    return (
      <Modal maxWidth="max-w-[440px]">
        <h2 className="text-[16px] font-medium text-white">
          Elegí la cuota a pagar
        </h2>
        <p className="mt-1 text-label text-muted">
          {selectedLoan.promissoryNoteNumber} — {selectedLoan.clientFullName}
        </p>

        <div className="mt-5 border-t border-border" />

        <div className="mt-4 flex max-h-[320px] flex-col gap-2 overflow-y-auto">
          {isLoadingLoan && (
            <p className="text-small text-muted">Cargando cuotas…</p>
          )}
          {!isLoadingLoan && pendingInstallments.length === 0 && (
            <p className="text-small text-muted">
              Este préstamo no tiene cuotas pendientes.
            </p>
          )}
          {pendingInstallments.map((installment) => (
            <button
              key={installment.id}
              type="button"
              onClick={() => setSelectedInstallmentId(installment.id)}
              className="flex items-center justify-between rounded border border-border bg-input px-3.5 py-2.5 text-left hover:border-subtle"
            >
              <span className="text-small text-white">
                Cuota {installment.installmentNumber} — vence{' '}
                {formatDateOnly(installment.dueDate)}
              </span>
              <span className="text-small text-muted">
                {formatCurrency(installment.totalDue)}
              </span>
            </button>
          ))}
        </div>

        <div className="mt-5 border-t border-border" />

        <div className="mt-4 flex items-center justify-end gap-3">
          <Button variant="secondary" onClick={() => setSelectedLoan(null)}>
            Volver
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal maxWidth="max-w-[440px]">
      <h2 className="text-[16px] font-medium text-white">Elegí el préstamo</h2>
      <p className="mt-1 text-label text-muted">
        A qué préstamo del cliente corresponde este comprobante.
      </p>

      <div className="mt-5 border-t border-border" />

      <div className="mt-4 flex max-h-[320px] flex-col gap-2 overflow-y-auto">
        {isLoadingLoans && (
          <p className="text-small text-muted">Cargando préstamos…</p>
        )}
        {!isLoadingLoans && loansResult?.items.length === 0 && (
          <p className="text-small text-muted">
            Este cliente no tiene préstamos activos.
          </p>
        )}
        {loansResult?.items.map((loanSummary) => (
          <button
            key={loanSummary.id}
            type="button"
            onClick={() => setSelectedLoan(loanSummary)}
            className="flex items-center justify-between rounded border border-border bg-input px-3.5 py-2.5 text-left hover:border-subtle"
          >
            <span className="text-small text-white">
              {loanSummary.promissoryNoteNumber}
            </span>
            <span className="text-small text-muted">
              Saldo {formatCurrency(loanSummary.outstandingBalance)}
            </span>
          </button>
        ))}
      </div>

      <div className="mt-5 border-t border-border" />

      <div className="mt-4 flex items-center justify-end gap-3">
        <Button variant="secondary" onClick={onClose}>
          Cancelar
        </Button>
      </div>
    </Modal>
  );
}
