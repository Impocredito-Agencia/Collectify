import { useRef, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { CurrencyInput } from '@/components/ui/CurrencyInput';
import { DatePicker } from '@/components/ui/DatePicker';
import { Field } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { ApiError } from '@/lib/apiClient';
import { formatCurrency } from '@/lib/format';
import { ImageUploadError, uploadPaymentReceipt } from '@/lib/imageUpload';
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
  onClose,
  onConfirm,
}: BulkRegisterPaymentDialogProps) {
  const [paidAt, setPaidAt] = useState(todayDateString());
  const [observation, setObservation] = useState('');
  const [rows, setRows] = useState<RowState[]>(() =>
    installments.map((installment) => ({
      installment,
      amountPaid: Math.ceil(installment.totalDue),
      images: [],
    })),
  );
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUploadingImages, setIsUploadingImages] = useState(false);
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

    // Same full-payment rule the api enforces server-side — checked here
    // too so the error surfaces before submit, not just from the api.
    const shortRow = rows.find(
      (row) => !(row.amountPaid >= row.installment.totalDue),
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
          amountPaid: row.amountPaid,
          paidAt,
          observation: observation.trim() || undefined,
          imageUrls,
        });
      }
    } catch (err) {
      setError(
        err instanceof ImageUploadError
          ? err.message
          : 'No se pudo subir una de las fotos del comprobante. Intenta de nuevo.',
      );
      setIsUploadingImages(false);
      return;
    }
    setIsUploadingImages(false);

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
                    value={row.amountPaid}
                    onChange={(value) => setRowAmount(index, value)}
                    className={inputClassName}
                  />
                </Field>
                <Field label="Fotos del comprobante (opcional)">
                  {row.images.length > 0 && (
                    <div className="flex flex-wrap items-center gap-3">
                      {row.images.map((image, imageIndex) => (
                        <div
                          key={image.previewUrl}
                          className="flex flex-col items-center gap-1"
                        >
                          <img
                            src={image.previewUrl}
                            alt="Vista previa del comprobante"
                            className="h-[42px] w-[42px] rounded border border-border object-cover"
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
                    accept="image/*"
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
                    Agregar foto
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

        <div className="mt-2 flex items-center justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={isSubmitting || isUploadingImages}>
            {isUploadingImages
              ? 'Subiendo fotos…'
              : isSubmitting
                ? 'Registrando…'
                : `Registrar ${installments.length} pagos`}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

const inputClassName =
  'h-[42px] w-full rounded border border-border bg-input px-3.5 text-control text-white placeholder-mid focus:border-subtle focus:outline-none';

// Field now lives in @/components/ui/Field — see DESIGN_TOKENS.md's
// "Component-based centralization" section.
