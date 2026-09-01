import { useEffect, useState } from 'react';

import { usePayoffQuote } from '@/features/loans/useLoans';
import { formatCurrency } from '@/lib/format';
import { useEscapeKey } from '@/lib/useEscapeKey';

import type { PayoffQuote } from '@/features/loans/loansApi';

interface PayoffDialogProps {
  loanId: string;
  loanLabel: string;
  onConfirm: () => Promise<unknown>;
  onClose: () => void;
}

// "Liquidar anticipadamente" — docs/phases/PHASE_16_EARLY_PAYOFF.md /
// docs/phasesClient/PHASE_16_EARLY_PAYOFF.md. A read-only-summary +
// single-confirm-action shape, but shows the real
// GET /loans/:id/payoff-quote breakdown first — interest owed (moratory +
// Phase 14 concepts on matured installments only) vs. principal, per
// installment — instead of a static confirmation sentence. Confirmed with
// the human: this always settles the FULL quoted amount; there is no
// partial-amount input, unlike RegisterPaymentDialog.
export function PayoffDialog({
  loanId,
  loanLabel,
  onConfirm,
  onClose,
}: PayoffDialogProps) {
  const [quote, setQuote] = useState<PayoffQuote | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Phase 32 — an explicit second "¿estás seguro?" step on top of the
  // breakdown-plus-confirm flow this dialog already had (confirmed with
  // the human: the extra step is wanted even though a confirm button
  // already existed here). "Confirmar liquidación" only reveals this final
  // warning; the actual POST /loans/:id/payoff call happens on the second
  // button below.
  const [isConfirmingFinal, setIsConfirmingFinal] = useState(false);

  const payoffQuote = usePayoffQuote();

  useEscapeKey(onClose);

  useEffect(() => {
    payoffQuote
      .mutateAsync(loanId)
      .then(setQuote)
      .catch(() =>
        setLoadError('No se pudo calcular la liquidación. Intenta de nuevo.'),
      );
    // Fetch once, when the dialog opens — not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loanId]);

  const handleConfirm = async () => {
    setConfirmError(null);
    setIsSubmitting(true);
    try {
      await onConfirm();
      onClose();
    } catch {
      setConfirmError('No se pudo liquidar el préstamo. Intenta de nuevo.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="max-h-[90vh] w-full max-w-[480px] overflow-y-auto rounded-lg border border-border bg-surface px-8 py-7">
        <h2 className="text-[16px] font-medium text-white">
          Liquidar anticipadamente
        </h2>
        <p className="mt-2.5 text-small text-muted">
          {loanLabel} — esto cierra el préstamo por completo hoy. Lo ya causado
          (mora y cargos adicionales de las cuotas vencidas) se cobra; las
          cuotas futuras aún no vencidas se cobran solo por su capital.
        </p>

        <div className="mt-5 border-t border-border" />

        {loadError && (
          <p className="mt-5 text-small text-red-400" role="alert">
            {loadError}
          </p>
        )}
        {!quote && !loadError && (
          <p className="mt-5 text-small text-muted">Calculando…</p>
        )}

        {quote && (
          <>
            <div className="mt-5 max-h-[220px] overflow-y-auto">
              <table className="w-full text-meta">
                <thead>
                  <tr className="text-muted">
                    <th className="pb-1 text-left font-normal">Cuota</th>
                    <th className="pb-1 text-right font-normal">Interés</th>
                    <th className="pb-1 text-right font-normal">Capital</th>
                    <th className="pb-1 text-right font-normal">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {quote.installments.map((installment) => (
                    <tr key={installment.installmentId} className="text-white">
                      <td className="py-0.5">
                        {installment.installmentNumber}
                      </td>
                      <td className="py-0.5 text-right">
                        {formatCurrency(installment.interestApplied)}
                      </td>
                      <td className="py-0.5 text-right">
                        {formatCurrency(installment.principalApplied)}
                      </td>
                      <td className="py-0.5 text-right font-medium">
                        {formatCurrency(installment.totalDue)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-4 flex items-center justify-between rounded bg-input px-3.5 py-3">
              <span className="text-small text-muted">Total a pagar hoy</span>
              <span className="text-card-title font-medium text-white">
                {formatCurrency(quote.totalDue)}
              </span>
            </div>
          </>
        )}

        {isConfirmingFinal && (
          <p
            className="mt-3 rounded border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-small text-amber-300"
            role="alert"
          >
            ¿Estás seguro? Esta acción no se puede deshacer.
          </p>
        )}

        {confirmError && (
          <p className="mt-3 text-small text-red-400" role="alert">
            {confirmError}
          </p>
        )}

        <div className="mt-6 border-t border-border" />

        <div className="mt-5 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={
              isConfirmingFinal ? () => setIsConfirmingFinal(false) : onClose
            }
            className="rounded border border-border bg-input px-4 py-2.5 text-small text-muted hover:text-white"
          >
            Cancelar
          </button>
          {isConfirmingFinal ? (
            <button
              type="button"
              onClick={() => void handleConfirm()}
              disabled={isSubmitting}
              className="rounded bg-red-500 px-4 py-2.5 text-small font-semibold text-white hover:bg-red-500/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? 'Liquidando…' : 'Sí, liquidar definitivamente'}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setIsConfirmingFinal(true)}
              disabled={!quote}
              className="rounded bg-white px-4 py-2.5 text-small font-semibold text-background hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Confirmar liquidación
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
