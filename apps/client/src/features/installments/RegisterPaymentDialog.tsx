import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { CurrencyInput } from '@/components/ui/CurrencyInput';
import { DatePicker } from '@/components/ui/DatePicker';
import { Field } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { ApiError } from '@/lib/apiClient';
import { formatCurrency } from '@/lib/format';
import { ImageUploadError, uploadPaymentReceipt } from '@/lib/imageUpload';
import { useEscapeKey } from '@/lib/useEscapeKey';

import type { Installment } from '@/features/installments/installmentsApi';
import type { ChangeEvent, FormEvent } from 'react';

interface RegisterPaymentDialogProps {
  // The installment this payment applies to. The API only accepts
  // payments per-installment (POST /installments/:id/payments) — there is
  // no loan-level "apply to whatever's next" endpoint, unlike what F-20's
  // simple "Préstamo #P-001 — Saldo: $800" header implies. The caller
  // decides which installment (see LoanDetailPage: the top "Registrar
  // pago" button targets the oldest pending one automatically, matching
  // Figma's no-picker flow; the cuotas table also offers a "Pagar" action
  // per row for when a specific installment needs to be targeted).
  installment: Installment;
  loanLabel: string;
  onClose: () => void;
  onConfirm: (input: {
    amountPaid: number;
    paidAt: string;
    observation?: string;
    imageUrls?: string[];
  }) => Promise<unknown>;
}

// `new Date().toISOString().slice(0, 10)` (the obvious way to get
// "today") is wrong here: .toISOString() converts the current instant to
// UTC before formatting, which rolls the calendar date forward for any
// timezone behind UTC — e.g. America/Bogota (UTC-5) turns 21 jul 8:00pm
// local into 22 jul 1:00am UTC, showing tomorrow's date as the default.
// This reads the LOCAL calendar day directly instead (same bug class as
// formatDateOnly/dueDateMath.ts, opposite direction: those force UTC to
// stop the date from rolling BACK; this forces local to stop it rolling
// FORWARD).
function todayDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Matched Figma F-20 "Registrar pago — Modal Desktop" exactly through
// Phase 4. Phase 12 (docs/phasesClient/PHASE_12_PAYMENT_ATTACHMENTS.md)
// adds the receipt-photo file input below, which has no Figma frame at
// all — documented as a gap in DESIGN_TOKENS.md.
export function RegisterPaymentDialog({
  installment,
  loanLabel,
  onClose,
  onConfirm,
}: RegisterPaymentDialogProps) {
  // totalDue is amount + accrued interest (interestRate / 30 × overdueDays)
  // — that division routinely produces long repeating decimals (e.g.
  // 108333.3333333333). The business only ever deals in whole pesos
  // (formatCurrency's convention everywhere else in the app), so the
  // default shown here is rounded the same way rather than dumping the raw
  // float into the field. Still fully editable — this only affects the
  // pre-filled default. Math.ceil, not Math.round: rounding to nearest can
  // round DOWN (e.g. 108333.33 → 108333), pre-filling an amount a fraction
  // of a peso short of the real balance — rounding up never does.
  const [amountPaid, setAmountPaid] = useState(Math.ceil(installment.totalDue));
  const [paidAt, setPaidAt] = useState(todayDateString());
  const [observation, setObservation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Kept separate from the files themselves: each file is uploaded to
  // Cloudinary BEFORE the payment is submitted (per
  // docs/phasesClient/PHASE_12_PAYMENT_ATTACHMENTS.md), so by the time
  // handleSubmit runs, every entry here has already been turned into a URL
  // — that's what actually gets sent to onConfirm. Phase 28 widens this
  // from a single file to a list — a client often sends more than one
  // receipt photo for the same cuota.
  const [images, setImages] = useState<{ file: File; previewUrl: string }[]>(
    [],
  );
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEscapeKey(onClose);

  // object URLs must be revoked explicitly or they leak — this covers
  // unmounting the dialog with files still picked. Removing/replacing a
  // single file revokes its own URL inline instead (see handlers below).
  useEffect(() => {
    return () => {
      for (const image of images) {
        URL.revokeObjectURL(image.previewUrl);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) {
      return;
    }
    setUploadError(null);
    setImages((current) => [
      ...current,
      ...files.map((file) => ({ file, previewUrl: URL.createObjectURL(file) })),
    ]);
    // Allows picking the same file again after removing it — otherwise the
    // input's own value blocks a re-selection of an identical file.
    event.target.value = '';
  };

  const handleRemoveImage = (index: number) => {
    setImages((current) => {
      URL.revokeObjectURL(current[index].previewUrl);
      return current.filter((_, i) => i !== index);
    });
    setUploadError(null);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    const amount = amountPaid;
    if (!(amount > 0)) {
      setError('El monto del pago debe ser mayor a 0.');
      return;
    }
    if (!paidAt) {
      setError('La fecha de pago es obligatoria.');
      return;
    }

    // An upload failure must never let the payment submit silently without
    // the photos (docs/phasesClient/PHASE_12_PAYMENT_ATTACHMENTS.md's
    // explicit requirement) — so this resolves every imageUrl first,
    // sequentially (so a failure identifies which specific file failed),
    // entirely separate from isSubmitting, and bails out before touching
    // onConfirm if any upload fails.
    let imageUrls: string[] | undefined;
    if (images.length > 0) {
      setUploadError(null);
      setIsUploadingImage(true);
      const uploaded: string[] = [];
      try {
        for (const image of images) {
          uploaded.push(await uploadPaymentReceipt(image.file));
        }
      } catch (err) {
        setUploadError(
          err instanceof ImageUploadError
            ? err.message
            : 'No se pudo subir una de las fotos del comprobante. Intenta de nuevo.',
        );
        setIsUploadingImage(false);
        return;
      }
      setIsUploadingImage(false);
      imageUrls = uploaded;
    }

    setIsSubmitting(true);
    try {
      await onConfirm({
        amountPaid: amount,
        paidAt,
        observation: observation.trim() || undefined,
        imageUrls,
      });
      onClose();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'No se pudo registrar el pago. Intenta de nuevo.',
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal maxWidth="max-w-[440px]">
      <h2 className="text-[16px] font-medium text-white">Registrar pago</h2>
      <p className="mt-1 text-label text-muted">
        {loanLabel} — Cuota {installment.installmentNumber} · Saldo{' '}
        {formatCurrency(installment.totalDue)}
      </p>

      <div className="mt-5 border-t border-border" />

      <form onSubmit={handleSubmit} className="mt-5 flex flex-col gap-3.5">
        <div className="flex gap-4">
          <Field label="Monto del pago">
            <CurrencyInput
              value={amountPaid}
              onChange={setAmountPaid}
              className={inputClassName}
            />
          </Field>
          <Field label="Fecha de pago">
            <DatePicker
              value={paidAt}
              onChange={setPaidAt}
              className={inputClassName}
            />
          </Field>
        </div>

        <Field label="Observación (opcional)">
          <textarea
            value={observation}
            onChange={(event) => setObservation(event.target.value)}
            placeholder="Ej: pago recibido en efectivo"
            rows={3}
            // Not inputClassName — that has a fixed h-[42px] meant for
            // single-line inputs, which fights with rows={3} and squeezes
            // the text with no vertical padding. py-2.5 instead lets the
            // textarea size itself naturally.
            className="w-full resize-none rounded border border-border bg-input px-3.5 py-2 text-control text-white placeholder-mid focus:border-subtle focus:outline-none"
          />
        </Field>

        <Field label="Fotos del comprobante (opcional)">
          {images.length > 0 && (
            <div className="flex flex-wrap items-center gap-3">
              {images.map((image, index) => (
                <div
                  key={image.previewUrl}
                  className="relative flex flex-col items-center gap-1"
                >
                  <img
                    src={image.previewUrl}
                    alt="Vista previa del comprobante"
                    className="h-[42px] w-[42px] rounded border border-border object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => handleRemoveImage(index)}
                    className="text-meta text-subtle hover:text-white"
                  >
                    Quitar
                  </button>
                </div>
              ))}
            </div>
          )}
          {/* 2026-09-05: raw <input type="file"> replaced with the shared
              Button (same "misma bolsa de todos los botones" pass applied to
              ImportClientsDialog.tsx) — the native picker button had a
              different size/shape/hover than every other button here. The
              real input stays mounted but visually hidden and is triggered
              via ref; the thumbnails above already show what's picked, so no
              separate filename text is needed. */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={handleFileChange}
            className="hidden"
          />
          <Button
            type="button"
            variant="secondary"
            onClick={() => fileInputRef.current?.click()}
            className="w-fit"
          >
            Agregar foto
          </Button>
          {uploadError && (
            <p className="text-small text-danger" role="alert">
              {uploadError}
            </p>
          )}
        </Field>

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
          <Button type="submit" disabled={isSubmitting || isUploadingImage}>
            {isUploadingImage
              ? 'Subiendo foto…'
              : isSubmitting
                ? 'Registrando…'
                : 'Registrar pago'}
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
