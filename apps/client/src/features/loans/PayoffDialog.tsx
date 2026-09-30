import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { ReceiptPhotosField } from '@/components/ui/ReceiptPhotosField';
import { Td, Th } from '@/components/ui/Table';
import { ConceptCategory } from '@/features/interestConceptTypes/interestConceptTypesApi';
import { usePayoffQuote } from '@/features/loans/useLoans';
import { formatCurrency } from '@/lib/format';
import { ImageUploadError, uploadPaymentReceipt } from '@/lib/imageUpload';
import { useEscapeKey } from '@/lib/useEscapeKey';

import type {
  PayoffInstallmentBreakdown,
  PayoffQuote,
} from '@/features/loans/loansApi';

interface PayoffDialogProps {
  loanId: string;
  loanLabel: string;
  // imageUrls: the payment receipt photos, already uploaded (empty when the
  // admin attached none).
  onConfirm: (imageUrls: string[]) => Promise<unknown>;
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
  // Human report, 2026-09-25 — the payoff had no way to attach the payment
  // receipt. Optional, same as on an ordinary payment.
  const [receiptFiles, setReceiptFiles] = useState<File[]>([]);

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
      // An upload failure must never let the payoff go through silently
      // without the receipt the admin chose to attach — so every photo is
      // uploaded first, and the payoff is aborted (nothing settled) if any
      // one fails. Same rule as RegisterPaymentDialog.
      const imageUrls: string[] = [];
      for (const file of receiptFiles) {
        try {
          imageUrls.push(await uploadPaymentReceipt(file));
        } catch (err) {
          setConfirmError(
            err instanceof ImageUploadError
              ? err.message
              : 'No se pudo subir una de las fotos del comprobante. Intenta de nuevo.',
          );
          return;
        }
      }
      await onConfirm(imageUrls);
      onClose();
    } catch {
      setConfirmError('No se pudo liquidar el préstamo. Intenta de nuevo.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Style cleanup, 2026-09-04 (client feedback, round 3 — "se hace muy
  // largo horizontalmente" with the previous one-column-per-concept
  // layout) — collapsed down to two fixed columns (corriente/moratorio
  // totals) instead of a column per distinct concept name, so the table's
  // width no longer grows with how many charge types a loan happens to
  // have. moratorioTotal is interestApplied MINUS the itemized corriente
  // total, rather than a sum of moratorio conceptBreakdown items — both
  // are mathematically equivalent today (every loan's moratory interest is
  // always itemized via real concepts, see calculatePayoff.ts), kept this
  // way since it's already proven correct and there's no reason to
  // introduce a second formula. Individual concept names/amounts aren't
  // lost, just moved into each cell's title= tooltip.
  function conceptSummary(installment: PayoffInstallmentBreakdown) {
    const corrienteItems = installment.conceptBreakdown.filter(
      (concept) => concept.category === ConceptCategory.Corriente,
    );
    const moratorioItems = installment.conceptBreakdown.filter(
      (concept) => concept.category === ConceptCategory.Moratorio,
    );
    const corrienteTotal = corrienteItems.reduce(
      (sum, concept) => sum + concept.amount,
      0,
    );
    const moratorioTotal = installment.interestApplied - corrienteTotal;

    const toTitle = (items: { name: string; amount: number }[]) =>
      items.length > 0
        ? items
            .map((item) => `${item.name}: ${formatCurrency(item.amount)}`)
            .join('\n')
        : undefined;

    return {
      corrienteTotal,
      moratorioTotal,
      corrienteTitle: toTitle(corrienteItems),
      moratorioTitle: toTitle(moratorioItems),
    };
  }

  return (
    <Modal maxWidth="max-w-[560px]" scroll>
      <h2 className="text-[16px] font-medium text-white">
        Liquidar anticipadamente
      </h2>
      <p className="mt-2.5 text-small text-muted">
        {loanLabel} — esto cierra el préstamo por completo hoy. Lo ya causado
        (mora y cargos adicionales de las cuotas vencidas) se cobra, y también
        los intereses de las cuotas aún no vencidas cuyo periodo ya lleva más de
        5 días corriendo; las demás cuotas futuras se cobran solo por su
        capital.
      </p>

      <div className="mt-5 border-t border-border" />

      {loadError && (
        <p className="mt-5 text-small text-danger" role="alert">
          {loadError}
        </p>
      )}
      {!quote && !loadError && (
        <p className="mt-5 text-small text-muted">Calculando…</p>
      )}

      {/* Redesign, 2026-09-04 (client feedback, three rounds):
          1) The big total is centered, in its own subdued-accent-bordered
             box (border-accent/30 bg-accent/5 — same soft-tint formula
             Button.tsx's danger variant already uses, just the brand
             accent instead of red) so it reads as the one figure that
             matters most, not another StatCard indistinguishable from a
             KPI grid.
          2) Every value in the table below uses the SAME (non-muted,
             white/font-medium) style — every column here is an equally
             real, final number, not a supporting/identifying-vs-secondary
             split the way Th/Td's usual convention assumes.
          3) Fixed corriente/moratorio TOTAL columns (see conceptSummary
             above) instead of one column per concept — keeps the table's
             width constant no matter how many charge types a loan has;
             hover a cell for the per-concept detail. */}
      {quote && (
        <>
          <div className="mt-5 flex flex-col items-center gap-1 rounded-lg border border-accent/30 bg-accent/5 px-5 py-5 text-center">
            <span className="text-small text-muted">Total a pagar hoy</span>
            <span className="text-kpi font-light text-white">
              {formatCurrency(quote.totalDue)}
            </span>
          </div>

          <div className="mt-4 max-h-[280px] overflow-auto rounded-lg bg-surface">
            <table className="w-full">
              <thead className="sticky top-0 bg-input">
                <tr>
                  {/* w-14 + text-center (style cleanup, 2026-09-04, round
                      5 — "parece que tuviera demasiado espacio") — with no
                      width set, the table's auto layout handed this column
                      whatever space the other four (currency, always
                      wider) didn't need, then left its 1-2 digit numbers
                      stranded at the left edge of all that extra room.
                      Same fix Historial de pagos' own "#" column already
                      uses two sections up (<Th className="w-10">#</Th>) —
                      pinning a narrow, purely-numeric identifying column to
                      a fixed width instead of letting auto-layout inflate
                      it. */}
                  <Th compact className="w-14 text-center">
                    Cuota
                  </Th>
                  {/* Style cleanup, 2026-09-04 (client feedback, round 4) —
                      "Interés corriente"/"Interés moratorio" replaced with
                      Σ (sum) + the same C/M badge colors LoanDetailPage's
                      InstallmentsTable already uses for this exact
                      corriente/moratorio distinction, to compact the header
                      further. Σ sits OUTSIDE the badge, as its own muted
                      glyph, rather than crammed inside it (e.g. "ΣC") — two
                      characters inside that 9px pill read as noise, while Σ
                      as plain adjacent text stays legible at a glance. title=
                      on the header keeps the full word one hover away, since
                      "Σ C" alone is less self-explanatory than the words
                      were. */}
                  <Th compact className="text-right" title="Interés corriente">
                    <span className="text-mid">Σ</span>
                    <span className="ml-1 rounded bg-white/10 px-1 py-0.5 text-[9px] font-medium text-mid">
                      C
                    </span>
                  </Th>
                  <Th compact className="text-right" title="Interés moratorio">
                    <span className="text-mid">Σ</span>
                    <span className="ml-1 rounded bg-danger/15 px-1 py-0.5 text-[9px] font-medium text-danger">
                      M
                    </span>
                  </Th>
                  <Th compact className="text-right">
                    Capital
                  </Th>
                  <Th compact className="text-right">
                    Total
                  </Th>
                </tr>
              </thead>
              <tbody>
                {quote.installments.map((installment) => {
                  const {
                    corrienteTotal,
                    moratorioTotal,
                    corrienteTitle,
                    moratorioTitle,
                  } = conceptSummary(installment);
                  return (
                    <tr
                      key={installment.installmentId}
                      className="border-t border-border"
                    >
                      <Td compact className="text-center">
                        {installment.installmentNumber}
                      </Td>
                      <Td compact className="text-right" title={corrienteTitle}>
                        {formatCurrency(corrienteTotal)}
                      </Td>
                      <Td compact className="text-right" title={moratorioTitle}>
                        {formatCurrency(moratorioTotal)}
                      </Td>
                      <Td compact className="text-right">
                        {formatCurrency(installment.principalApplied)}
                      </Td>
                      <Td compact className="text-right">
                        {formatCurrency(installment.totalDue)}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {quote.interestTrueUp !== 0 && (
            <div className="mt-3 flex items-start justify-between gap-4 rounded border border-border bg-surface px-3.5 py-2.5">
              <div>
                <p className="text-small font-medium text-white">
                  {quote.interestTrueUp > 0
                    ? 'Ajuste de interés de cuotas ya pagadas'
                    : 'Crédito por interés cobrado por adelantado'}
                </p>
                <p className="mt-0.5 text-[11px] text-muted">
                  {quote.interestTrueUp > 0
                    ? 'Las cuotas que ya pagó se cobraron con un interés promediado, menor al que realmente se causó hasta hoy; esta es la diferencia. Ya está incluida en el total.'
                    : 'Las cuotas pagadas por adelantado ya incluyeron interés de períodos que aún no se causan; se descuenta del total.'}
                </p>
              </div>
              <span className="whitespace-nowrap text-small font-medium text-white">
                {formatCurrency(quote.interestTrueUp)}
              </span>
            </div>
          )}
        </>
      )}

      <div className="mt-5">
        <Field label="Fotos del comprobante (opcional)" layout="stack">
          <ReceiptPhotosField
            onChange={setReceiptFiles}
            disabled={isSubmitting}
          />
        </Field>
      </div>

      {isConfirmingFinal && (
        <p
          className="mt-3 rounded border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-small text-amber-300"
          role="alert"
        >
          ¿Está seguro? Esta acción no se puede deshacer.
        </p>
      )}

      {confirmError && (
        <p className="mt-3 text-small text-danger" role="alert">
          {confirmError}
        </p>
      )}

      <div className="mt-6 border-t border-border" />

      <div className="mt-5 flex items-center justify-end gap-3">
        <Button
          variant="secondary"
          onClick={
            isConfirmingFinal ? () => setIsConfirmingFinal(false) : onClose
          }
        >
          Cancelar
        </Button>
        {isConfirmingFinal ? (
          <Button
            variant="dangerSolid"
            onClick={() => void handleConfirm()}
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Liquidando…' : 'Sí, liquidar definitivamente'}
          </Button>
        ) : (
          <Button onClick={() => setIsConfirmingFinal(true)} disabled={!quote}>
            Confirmar liquidación
          </Button>
        )}
      </div>
    </Modal>
  );
}
