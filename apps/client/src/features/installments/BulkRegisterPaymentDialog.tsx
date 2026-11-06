import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { CurrencyInput } from '@/components/ui/CurrencyInput';
import { DatePicker } from '@/components/ui/DatePicker';
import { Field } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { ReceiptFilePreview } from '@/components/ui/ReceiptFilePreview';
import { useInstallmentValuation } from '@/features/installments/useInstallments';
import { ApiError } from '@/lib/apiClient';
import { formatCurrency, formatDateOnly } from '@/lib/format';
import { ImageUploadError, uploadPaymentReceipt } from '@/lib/imageUpload';
import { maxWaivableMora, requiredPaymentWithWaiver } from '@/lib/moraWaiver';
import { useEscapeKey } from '@/lib/useEscapeKey';

import type { BulkPaymentEntryInput } from '@/features/installments/installmentsApi';
import type { Installment } from '@/features/installments/installmentsApi';
import type { ChangeEvent, FormEvent } from 'react';

interface BulkRegisterPaymentDialogProps {
  // Every installment must be paid in FULL in a batch — confirmed with the
  // human, see docs/phases/PHASE_28_MULTI_INSTALLMENT_PAYMENT.md. Partial
  // payment stays on RegisterPaymentDialog's single-installment flow.
  installments: Installment[];
  loanLabel: string;
  // Human request, 2026-11-05 — the pagaré's disbursement date, the earliest
  // day the batch can be dated.
  minPaidAt?: string;
  onClose: () => void;
  onConfirm: (entries: BulkPaymentEntryInput[]) => Promise<unknown>;
}

function todayDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

interface RowState {
  installment: Installment;
  amountPaid: number;
  images: { file: File; previewUrl: string }[];
  // Human request, 2026-09-25 — mora forgiven together with this cuota's
  // payment, per row. While a waiver is set the row's amount isn't typed but
  // computed as balance − waiver, exactly (each cuota of a batch must be
  // settled to the peso — see lib/moraWaiver.ts and the server's
  // assertValidMoraWaiver).
  isWaiverOpen: boolean;
  moraWaiver: number;
  moraWaiverReason: string;
}

// What this row will actually pay: the typed amount, or — with a waiver set
// — the balance minus the waiver.
function rowAmount(row: RowState): number {
  return row.isWaiverOpen && row.moraWaiver > 0
    ? requiredPaymentWithWaiver(row.installment, row.moraWaiver)
    : row.amountPaid;
}

function rowWaiver(row: RowState): number {
  return row.isWaiverOpen && row.moraWaiver > 0 ? row.moraWaiver : 0;
}

// Phase 28 — pays several installments in one action. One shared date and
// observación for the whole batch (the realistic case: a collector
// reconciling several cuotas paid at the same time/deposit), but one row
// per installment for amount (pre-filled to its totalDue, since a batch
// requires full payment of every row — confirmed with the human) and its
// own optional receipt photos (receipts are naturally per-cuota). No
// Figma frame exists for this dialog, same gap as RegisterPaymentDialog's
// receipt-photo field (see DESIGN_TOKENS.md).
//
// Math.ceil, not Math.round, for the pre-filled amount: totalDue includes
// accrued interest (rate / 30 × overdueDays), which routinely produces
// long decimals (e.g. 364217.4). Math.round can round DOWN to the nearest
// peso, and since submission below requires amountPaid >= totalDue for
// every row, that rounded-down default silently failed its own "full
// balance" check — a bug a user hit on an untouched row (2026-09-04).
// formatCurrency's display rounds the same way, so the amount field and
// the "Saldo" label looked identical while the raw comparison failed
// underneath. Rounding up always covers the balance.
export function BulkRegisterPaymentDialog({
  installments,
  loanLabel,
  minPaidAt,
  onClose,
  onConfirm,
}: BulkRegisterPaymentDialogProps) {
  const today = todayDateString();
  const [paidAt, setPaidAt] = useState(today);
  const [observation, setObservation] = useState('');
  const [rowState, setRows] = useState<RowState[]>(() =>
    installments.map((installment) => ({
      installment,
      amountPaid: Math.ceil(installment.totalDue),
      images: [],
      isWaiverOpen: false,
      moraWaiver: 0,
      moraWaiverReason: '',
    })),
  );

  // Human request, 2026-11-05 — for a past paidAt every cuota is shown (and
  // validated, server-side) as it stood on that day. `rows` carries that
  // day's figures in row.installment; everything below reads from it.
  const isBackdated = paidAt !== '' && paidAt < today;
  const valuationQuery = useInstallmentValuation(
    installments.map((installment) => installment.id),
    paidAt,
    isBackdated,
  );
  const valuationById = new Map(
    (isBackdated ? (valuationQuery.data ?? []) : []).map((valuation) => [
      valuation.installmentId,
      valuation,
    ]),
  );
  const isValuationPending =
    isBackdated && valuationById.size < installments.length;
  const rows: RowState[] = rowState.map((row) => {
    const valuation = valuationById.get(row.installment.id);
    return valuation
      ? {
          ...row,
          installment: {
            ...row.installment,
            overdueDays: valuation.overdueDays,
            interest: valuation.interest,
            totalDue: valuation.totalDue,
          },
        }
      : row;
  });

  // A batch must settle every cuota exactly, so each row's amount is
  // re-filled with the balance of whichever day is now picked (and any
  // waiver cleared, its maximum having changed too).
  const valuationData = valuationQuery.data;
  useEffect(() => {
    const byId = new Map(
      (isBackdated ? (valuationData ?? []) : []).map((valuation) => [
        valuation.installmentId,
        valuation.totalDue,
      ]),
    );
    setRows((current) =>
      current.map((row) => ({
        ...row,
        amountPaid: Math.ceil(
          byId.get(row.installment.id) ?? row.installment.totalDue,
        ),
        isWaiverOpen: false,
        moraWaiver: 0,
        moraWaiverReason: '',
      })),
    );
  }, [isBackdated, valuationData]);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUploadingImages, setIsUploadingImages] = useState(false);
  // Redesign, 2026-09-09 (human decision) — same two-step pattern as
  // RegisterPaymentDialog.tsx's ConfirmRegisterPaymentDialog: "Registrar N
  // pagos" below only validates/uploads photos and opens a summary
  // confirming the total and how many cuotas it settles; onConfirm (which
  // triggers a WhatsApp confirmation message per settled cuota, plus a
  // "pagado en su totalidad" one for any loan that fully closes) only
  // fires from that dialog's own confirm button — see performConfirm.
  const [pendingEntries, setPendingEntries] = useState<
    BulkPaymentEntryInput[] | null
  >(null);
  // One row per installment, each with its own file input — keyed by row
  // index rather than a single ref since useRef can't hold a dynamic list of
  // DOM nodes directly.
  const fileInputRefs = useRef<Record<number, HTMLInputElement | null>>({});

  useEscapeKey(onClose);

  const setRowAmount = (index: number, amountPaid: number) => {
    setRows((current) =>
      current.map((row, i) => (i === index ? { ...row, amountPaid } : row)),
    );
  };

  const updateRow = (index: number, patch: Partial<RowState>) => {
    setRows((current) =>
      current.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  };

  const handleFileChange = (
    index: number,
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) {
      return;
    }
    setRows((current) =>
      current.map((row, i) =>
        i === index
          ? {
              ...row,
              images: [
                ...row.images,
                ...files.map((file) => ({
                  file,
                  previewUrl: URL.createObjectURL(file),
                })),
              ],
            }
          : row,
      ),
    );
    event.target.value = '';
  };

  const handleRemoveImage = (rowIndex: number, imageIndex: number) => {
    setRows((current) =>
      current.map((row, i) => {
        if (i !== rowIndex) {
          return row;
        }
        URL.revokeObjectURL(row.images[imageIndex].previewUrl);
        return {
          ...row,
          images: row.images.filter((_, j) => j !== imageIndex),
        };
      }),
    );
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    if (!paidAt) {
      setError('La fecha de pago es obligatoria.');
      return;
    }
    if (paidAt > today) {
      setError('La fecha de pago no puede ser posterior a hoy.');
      return;
    }
    if (minPaidAt && paidAt < minPaidAt) {
      setError(
        `La fecha de pago no puede ser anterior al desembolso (${formatDateOnly(minPaidAt)}).`,
      );
      return;
    }
    if (isValuationPending) {
      setError(
        valuationQuery.isError
          ? 'No se pudo calcular el saldo de las cuotas a esa fecha. Intenta de nuevo.'
          : 'Calculando el saldo de las cuotas a esa fecha…',
      );
      return;
    }

    const overWaivedRow = rows.find(
      (row) =>
        row.isWaiverOpen && row.moraWaiver > maxWaivableMora(row.installment),
    );
    if (overWaivedRow) {
      setError(
        `La mora a condonar en la cuota ${overWaivedRow.installment.installmentNumber} no puede superar ${formatCurrency(maxWaivableMora(overWaivedRow.installment))}.`,
      );
      return;
    }

    // Same full-payment rule the api enforces server-side — checked here
    // too so the error surfaces before submit, not just from the api. Mora
    // forgiven on a row counts toward settling it, like cash does.
    const shortRow = rows.find(
      (row) => !(rowAmount(row) + rowWaiver(row) >= row.installment.totalDue),
    );
    if (shortRow) {
      setError(
        `El monto de la cuota ${shortRow.installment.installmentNumber} debe cubrir el saldo completo (${formatCurrency(shortRow.installment.totalDue)}). Un lote solo admite pagos completos.`,
      );
      return;
    }

    setIsUploadingImages(true);
    const entries: BulkPaymentEntryInput[] = [];
    try {
      for (const row of rows) {
        let imageUrls: string[] | undefined;
        if (row.images.length > 0) {
          const uploaded: string[] = [];
          for (const image of row.images) {
            uploaded.push(await uploadPaymentReceipt(image.file));
          }
          imageUrls = uploaded;
        }
        entries.push({
          installmentId: row.installment.id,
          amountPaid: rowAmount(row),
          paidAt,
          observation: observation.trim() || undefined,
          imageUrls,
          ...(rowWaiver(row) > 0
            ? {
                moraWaivedAmount: rowWaiver(row),
                moraWaiverReason: row.moraWaiverReason.trim() || undefined,
              }
            : {}),
        });
      }
    } catch (err) {
      setError(
        err instanceof ImageUploadError
          ? err.message
          : 'No se pudo subir uno de los archivos del comprobante. Intenta de nuevo.',
      );
      setIsUploadingImages(false);
      return;
    }
    setIsUploadingImages(false);
    setPendingEntries(entries);
  };

  // Takes `entries` as a parameter rather than reading pendingEntries from
  // state — same reasoning as RegisterPaymentDialog.tsx's identical
  // performConfirm: the confirm dialog's own onConfirm below clears
  // pendingEntries immediately on click, so this would otherwise read a
  // stale null on the very call it's meant to act on.
  const performConfirm = async (entries: BulkPaymentEntryInput[]) => {
    setIsSubmitting(true);
    try {
      await onConfirm(entries);
      onClose();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'No se pudo registrar el lote de pagos. Intenta de nuevo.',
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal maxWidth="max-w-[640px]" scroll maxHeight="max-h-[85vh]">
      <h2 className="text-[16px] font-medium text-white">
        Registrar pago de {installments.length} cuotas
      </h2>
      <p className="mt-1 text-label text-muted">{loanLabel}</p>

      <div className="mt-5 border-t border-border" />

      <form onSubmit={handleSubmit} className="mt-5 flex flex-col gap-3.5">
        <div className="flex gap-4">
          <Field label="Fecha de pago">
            <DatePicker
              value={paidAt}
              onChange={setPaidAt}
              className={inputClassName}
              ariaLabel="Fecha de pago"
              min={minPaidAt}
              max={today}
            />
          </Field>
          <Field label="Observación (opcional)">
            <input
              type="text"
              value={observation}
              onChange={(event) => setObservation(event.target.value)}
              placeholder="Ej: pago recibido en efectivo"
              className={inputClassName}
            />
          </Field>
        </div>

        {/* Human request, 2026-11-05 — see the single-payment dialog. */}
        {isBackdated && (
          <p className="text-small text-muted">
            {isValuationPending
              ? valuationQuery.isError
                ? 'No se pudo calcular el saldo de las cuotas a esa fecha.'
                : 'Calculando el saldo de las cuotas a esa fecha…'
              : `Pago con fecha anterior: cada cuota se toma con el saldo que tenía el ${formatDateOnly(paidAt)}, no el de hoy.`}
          </p>
        )}

        <div className="flex flex-col gap-3">
          {rows.map((row, index) => (
            <div
              key={row.installment.id}
              className="rounded border border-border bg-input/40 p-3.5"
            >
              <div className="flex items-center justify-between">
                <span className="text-small font-medium text-white">
                  Cuota {row.installment.installmentNumber}
                </span>
                <span className="text-meta text-muted">
                  Saldo {formatCurrency(row.installment.totalDue)}
                </span>
              </div>
              <div className="mt-2.5 flex flex-col gap-2.5">
                <Field label="Monto del pago">
                  <CurrencyInput
                    value={rowAmount(row)}
                    onChange={(value) => setRowAmount(index, value)}
                    className={inputClassName}
                    disabled={rowWaiver(row) > 0}
                  />
                </Field>
                {maxWaivableMora(row.installment) > 0 &&
                  (row.isWaiverOpen ? (
                    <div className="flex flex-col gap-2.5 rounded border border-border bg-input/40 p-3">
                      <Field label="Mora a condonar (opcional)">
                        <div className="flex items-center gap-2.5">
                          <div className="flex-1">
                            <CurrencyInput
                              value={row.moraWaiver}
                              onChange={(value) =>
                                updateRow(index, { moraWaiver: value })
                              }
                              className={inputClassName}
                            />
                          </div>
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={() =>
                              updateRow(index, {
                                moraWaiver: maxWaivableMora(row.installment),
                              })
                            }
                          >
                            Toda la mora
                          </Button>
                        </div>
                        <span className="mt-1 text-meta text-muted">
                          Máximo{' '}
                          {formatCurrency(maxWaivableMora(row.installment))}
                        </span>
                      </Field>
                      <Field label="Motivo (opcional)">
                        <input
                          value={row.moraWaiverReason}
                          onChange={(event) =>
                            updateRow(index, {
                              moraWaiverReason: event.target.value,
                            })
                          }
                          placeholder="Ej: pagó todo de contado"
                          maxLength={500}
                          className={inputClassName}
                        />
                      </Field>
                      <Button
                        type="button"
                        variant="secondary"
                        className="w-fit"
                        onClick={() =>
                          updateRow(index, {
                            isWaiverOpen: false,
                            moraWaiver: 0,
                            moraWaiverReason: '',
                          })
                        }
                      >
                        Quitar condonación
                      </Button>
                    </div>
                  ) : (
                    <Button
                      type="button"
                      variant="secondary"
                      className="w-fit"
                      onClick={() => updateRow(index, { isWaiverOpen: true })}
                    >
                      Condonar mora
                    </Button>
                  ))}
                <Field label="Comprobante: fotos o PDF (opcional)">
                  {row.images.length > 0 && (
                    <div className="flex flex-wrap items-center gap-3">
                      {row.images.map((image, imageIndex) => (
                        <div
                          key={image.previewUrl}
                          className="flex flex-col items-center gap-1"
                        >
                          <ReceiptFilePreview
                            file={image.file}
                            previewUrl={image.previewUrl}
                          />
                          <button
                            type="button"
                            onClick={() => handleRemoveImage(index, imageIndex)}
                            className="text-meta text-subtle hover:text-white"
                          >
                            Quitar
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  {/* 2026-09-05: same Button migration as
                      RegisterPaymentDialog.tsx's single-installment version
                      — see its comment for why. */}
                  <input
                    ref={(el) => {
                      fileInputRefs.current[index] = el;
                    }}
                    type="file"
                    accept="image/*,application/pdf"
                    multiple
                    onChange={(event) => handleFileChange(index, event)}
                    className="hidden"
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => fileInputRefs.current[index]?.click()}
                    className="w-fit"
                  >
                    Agregar foto o PDF
                  </Button>
                </Field>
              </div>
            </div>
          ))}
        </div>

        {error && (
          <p className="text-small text-danger" role="alert">
            {error}
          </p>
        )}

        <div className="mt-2.5 border-t border-border" />

        {/* Human request, 2026-09-27 — the total only showed up in the
            second, confirm-and-send dialog; a cobrador tallying several
            cuotas at once wants it visible here too, live as amounts/
            condonaciones change, not just right before sending. Same sum
            ConfirmBulkRegisterPaymentDialog computes from the submitted
            entries below, so the two numbers can never disagree. */}
        <div className="mt-2 flex items-center justify-between">
          <span className="text-small text-muted">Total a pagar</span>
          <span className="text-[16px] font-medium text-white">
            {formatCurrency(rows.reduce((sum, row) => sum + rowAmount(row), 0))}
          </span>
        </div>

        <div className="mt-2 flex items-center justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={isSubmitting || isUploadingImages}>
            {isUploadingImages
              ? 'Subiendo comprobantes…'
              : isSubmitting
                ? 'Registrando…'
                : `Registrar ${installments.length} pagos`}
          </Button>
        </div>
      </form>

      {pendingEntries && (
        <ConfirmBulkRegisterPaymentDialog
          entryCount={pendingEntries.length}
          total={pendingEntries.reduce(
            (sum, entry) => sum + entry.amountPaid,
            0,
          )}
          totalWaived={pendingEntries.reduce(
            (sum, entry) => sum + (entry.moraWaivedAmount ?? 0),
            0,
          )}
          isSubmitting={isSubmitting}
          onCancel={() => setPendingEntries(null)}
          onConfirm={() => {
            const entries = pendingEntries;
            setPendingEntries(null);
            void performConfirm(entries);
          }}
        />
      )}
    </Modal>
  );
}

const inputClassName =
  'h-[42px] w-full rounded border border-border bg-input px-3.5 text-control text-white placeholder-mid focus:border-subtle focus:outline-none';

// Redesign, 2026-09-09 (human decision) — mirrors RegisterPaymentDialog.tsx's
// ConfirmRegisterPaymentDialog. Every entry in a batch always fully
// settles its installment (enforced above and server-side), so unlike the
// single-payment dialog there's no "saldo pendiente" case to distinguish
// — this is always a full close per cuota, which is why it's worth
// spelling out how many and for how much before the WhatsApp confirmation
// messages go out.
function ConfirmBulkRegisterPaymentDialog({
  entryCount,
  total,
  totalWaived,
  isSubmitting,
  onCancel,
  onConfirm,
}: {
  entryCount: number;
  total: number;
  // Total mora forgiven across the batch (0 = none) — not money received.
  totalWaived: number;
  isSubmitting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEscapeKey(onCancel);

  return (
    <Modal maxWidth="max-w-[420px]">
      <h2 className="text-[16px] font-medium text-white">
        Confirmar registro de pagos
      </h2>
      <p className="mt-2.5 text-small text-muted">
        Vas a registrar {entryCount} pagos por un total de{' '}
        <strong className="text-white">{formatCurrency(total)}</strong>
        {totalWaived > 0 && (
          <>
            {' '}
            y condonando{' '}
            <strong className="text-white">
              {formatCurrency(totalWaived)}
            </strong>{' '}
            de mora
          </>
        )}
        , saldando por completo cada una de esas cuotas.
      </p>
      <p className="mt-2.5 text-small text-muted">
        Al confirmar, se le enviará automáticamente al cliente un mensaje de
        WhatsApp por cada cuota saldada, confirmando el pago.
      </p>

      <div className="mt-6 border-t border-border" />

      <div className="mt-5 flex items-center justify-end gap-3">
        <Button variant="secondary" onClick={onCancel} disabled={isSubmitting}>
          Cancelar
        </Button>
        <Button onClick={onConfirm} disabled={isSubmitting}>
          {isSubmitting ? 'Registrando…' : 'Sí, registrar pagos'}
        </Button>
      </div>
    </Modal>
  );
}

// Field now lives in @/components/ui/Field — see DESIGN_TOKENS.md's
// "Component-based centralization" section.
