import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { CurrencyInput } from '@/components/ui/CurrencyInput';
import { DatePicker } from '@/components/ui/DatePicker';
import { Field } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { ApiError } from '@/lib/apiClient';
import { formatCurrency } from '@/lib/format';
import { ImageUploadError, uploadPaymentReceipt } from '@/lib/imageUpload';
import { maxWaivableMora, requiredPaymentWithWaiver } from '@/lib/moraWaiver';
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
  // Human report, 2026-09-11 — lets a caller (RegisterPaymentFromWhatsappModal)
  // pre-attach a comprobante that's already hosted on Cloudinary, so the
  // admin doesn't have to download it from WhatsApp and re-upload it by
  // hand. Shown alongside any newly-picked files, removable the same way,
  // and included in onConfirm's imageUrls without going through
  // uploadPaymentReceipt again.
  initialImageUrls?: string[];
  onClose: () => void;
  onConfirm: (input: {
    amountPaid: number;
    paidAt: string;
    observation?: string;
    imageUrls?: string[];
    moraWaivedAmount?: number;
    moraWaiverReason?: string;
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
  initialImageUrls,
  onClose,
  onConfirm,
}: RegisterPaymentDialogProps) {
  // Human report, 2026-09-09 — this used to pre-fill with the cuota's full
  // remaining balance (Math.ceil(installment.totalDue), see git history),
  // so a worker who received a PARTIAL payment but didn't think to edit
  // the field before hitting "Guardar" silently registered a full payment
  // instead, closing a cuota that should have stayed pending with a real
  // balance owed. Starting empty (CurrencyInput treats 0 as empty, see its
  // own comment) forces typing the actual amount received every time — the
  // cuota's real balance is still shown just below the field instead, for
  // quick reference without it being the thing that gets silently
  // submitted unedited.
  const [amountPaid, setAmountPaid] = useState(0);
  const [paidAt, setPaidAt] = useState(todayDateString());
  const [observation, setObservation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Redesign, 2026-09-09 (human decision, same pattern as LoanForm.tsx's
  // ConfirmCreateLoanDialog) — "Guardar" below no longer registers the
  // payment directly; it only validates/uploads photos and opens
  // ConfirmRegisterPaymentDialog with a summary of exactly what the cuota
  // will look like afterward. onConfirm (the actual mutation, which is
  // what triggers the WhatsApp confirmation message server-side once it
  // closes the cuota) only ever fires from that dialog's own confirm
  // button — see performConfirm below.
  const [pendingInput, setPendingInput] = useState<{
    amountPaid: number;
    paidAt: string;
    observation?: string;
    imageUrls?: string[];
    moraWaivedAmount?: number;
    moraWaiverReason?: string;
  } | null>(null);

  // Human request, 2026-09-25 — forgiving part of the accrued mora together
  // with this payment. Only offered when the cuota is charging mora
  // (maxWaivable > 0), and only ever for a payment that settles the cuota
  // completely: while a waiver is set the amount is not typed but computed
  // as balance − waiver, exactly, and shown locked — never "pay a bit,
  // forgive a bit, leave a balance". See lib/moraWaiver.ts.
  const maxWaivable = maxWaivableMora(installment);
  const [isWaiverOpen, setIsWaiverOpen] = useState(false);
  const [moraWaiver, setMoraWaiver] = useState(0);
  const [moraWaiverReason, setMoraWaiverReason] = useState('');
  const waiverActive = isWaiverOpen && moraWaiver > 0;
  const effectiveAmount = waiverActive
    ? requiredPaymentWithWaiver(installment, moraWaiver)
    : amountPaid;

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
  // Already-hosted URLs handed in via initialImageUrls (see that prop's
  // own comment) — kept in their own state so removing one is just a
  // local filter, no upload/revoke bookkeeping needed like `images` above.
  const [preAttachedImageUrls, setPreAttachedImageUrls] = useState<string[]>(
    initialImageUrls ?? [],
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

  const handleRemovePreAttachedImage = (index: number) => {
    setPreAttachedImageUrls((current) => current.filter((_, i) => i !== index));
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    if (isWaiverOpen && moraWaiver > maxWaivable) {
      setError(
        `La mora a condonar no puede superar ${formatCurrency(maxWaivable)}.`,
      );
      return;
    }
    const amount = effectiveAmount;
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
    // onConfirm if any upload fails. preAttachedImageUrls are already
    // hosted (see that state's own comment) — included as-is, no upload.
    const uploaded: string[] = [];
    if (images.length > 0) {
      setUploadError(null);
      setIsUploadingImage(true);
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
    }
    const imageUrls =
      preAttachedImageUrls.length > 0 || uploaded.length > 0
        ? [...preAttachedImageUrls, ...uploaded]
        : undefined;

    setPendingInput({
      amountPaid: amount,
      paidAt,
      observation: observation.trim() || undefined,
      imageUrls,
      ...(waiverActive
        ? {
            moraWaivedAmount: moraWaiver,
            moraWaiverReason: moraWaiverReason.trim() || undefined,
          }
        : {}),
    });
  };

  // Takes `input` as a parameter rather than reading pendingInput from
  // state — the confirm dialog's own onConfirm below clears pendingInput
  // immediately on click (same pattern as LoanForm.tsx's
  // ConfirmCreateLoanDialog: the confirm dialog closes right away either
  // way, any failure surfaces back on this form via `error`), so this
  // would otherwise read a stale null on the very call it's meant to act
  // on.
  const performConfirm = async (input: NonNullable<typeof pendingInput>) => {
    setIsSubmitting(true);
    try {
      await onConfirm(input);
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
              value={effectiveAmount}
              onChange={setAmountPaid}
              className={inputClassName}
              disabled={waiverActive}
            />
            {/* Human report, 2026-09-09 — the field used to pre-fill this
                exact figure; now it's shown here for reference only, so
                the collector still has it at a glance without it being
                the thing that gets submitted unedited. */}
            <span className="mt-1 text-meta text-muted">
              Saldo de la cuota: {formatCurrency(installment.totalDue)}
            </span>
          </Field>
          <Field label="Fecha de pago">
            <DatePicker
              value={paidAt}
              onChange={setPaidAt}
              className={inputClassName}
            />
          </Field>
        </div>

        {maxWaivable > 0 &&
          (isWaiverOpen ? (
            <div className="flex flex-col gap-3 rounded border border-border bg-input/40 p-3.5">
              <Field label="Mora a condonar (opcional)" layout="stack">
                <div className="flex items-center gap-2.5">
                  <div className="flex-1">
                    <CurrencyInput
                      value={moraWaiver}
                      onChange={setMoraWaiver}
                      className={inputClassName}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setMoraWaiver(maxWaivable)}
                  >
                    Toda la mora
                  </Button>
                </div>
                <span className="mt-1 text-meta text-muted">
                  Máximo {formatCurrency(maxWaivable)} — la mora que se le está
                  cobrando a esta cuota.
                </span>
              </Field>
              <Field label="Motivo (opcional)" layout="stack">
                <input
                  value={moraWaiverReason}
                  onChange={(event) => setMoraWaiverReason(event.target.value)}
                  placeholder="Ej: pagó todo de contado"
                  maxLength={500}
                  className={inputClassName}
                />
              </Field>
              {waiverActive && (
                <p className="text-small text-muted">
                  Se registrará un pago de{' '}
                  <strong className="text-white">
                    {formatCurrency(effectiveAmount)}
                  </strong>{' '}
                  y se condonarán{' '}
                  <strong className="text-white">
                    {formatCurrency(moraWaiver)}
                  </strong>{' '}
                  de mora. La cuota queda pagada por completo.
                </p>
              )}
              <Button
                type="button"
                variant="secondary"
                className="w-fit"
                onClick={() => {
                  setIsWaiverOpen(false);
                  setMoraWaiver(0);
                  setMoraWaiverReason('');
                }}
              >
                Quitar condonación
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              variant="secondary"
              className="w-fit"
              onClick={() => setIsWaiverOpen(true)}
            >
              Condonar mora
            </Button>
          ))}

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
          {preAttachedImageUrls.length > 0 && (
            <div className="flex flex-wrap items-center gap-3">
              {preAttachedImageUrls.map((url, index) => (
                <div
                  key={url}
                  className="relative flex flex-col items-center gap-1"
                >
                  <img
                    src={url}
                    alt="Comprobante de WhatsApp"
                    className="h-[42px] w-[42px] rounded border border-border object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => handleRemovePreAttachedImage(index)}
                    className="text-meta text-subtle hover:text-white"
                  >
                    Quitar
                  </button>
                </div>
              ))}
            </div>
          )}
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

      {pendingInput && (
        <ConfirmRegisterPaymentDialog
          installment={installment}
          amountPaid={pendingInput.amountPaid}
          moraWaived={pendingInput.moraWaivedAmount ?? 0}
          isSubmitting={isSubmitting}
          onCancel={() => setPendingInput(null)}
          onConfirm={() => {
            const input = pendingInput;
            setPendingInput(null);
            void performConfirm(input);
          }}
        />
      )}
    </Modal>
  );
}

const inputClassName =
  'h-[42px] w-full rounded border border-border bg-input px-3.5 text-control text-white placeholder-mid focus:border-subtle focus:outline-none';

// Redesign, 2026-09-09 (human decision) — mirrors LoanForm.tsx's
// ConfirmCreateLoanDialog: a payment that fully closes its cuota sends
// the WhatsApp confirmation message immediately (InstallmentsService.
// registerPayment's sendPaymentConfirmationSafely), so this is where that
// send is now visibly triggered from, not the form's own "Registrar
// pago" button above. A payment that leaves a saldo pendiente never
// sends anything — the summary reflects that distinction directly rather
// than showing a WhatsApp disclaimer that wouldn't apply.
function ConfirmRegisterPaymentDialog({
  installment,
  amountPaid,
  moraWaived,
  isSubmitting,
  onCancel,
  onConfirm,
}: {
  installment: Installment;
  amountPaid: number;
  // Mora forgiven together with this payment (0 = none) — it settles part
  // of the balance just like cash does, see the waiver block above.
  moraWaived: number;
  isSubmitting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEscapeKey(onCancel);

  // Math.ceil to match the exact figure this dialog's own field used to
  // pre-fill as "the amount that fully closes this cuota" — see
  // amountPaid's own comment above.
  const totalDue = Math.ceil(installment.totalDue);
  const remainingAfter = Math.max(0, totalDue - amountPaid - moraWaived);
  const willCloseCuota = remainingAfter === 0;
  // Human report, 2026-09-14 — a payment exceeding what this cuota owes is
  // no longer rejected: the backend caps this installment's own Payment at
  // totalDue and routes the rest into the client's saldo a favor
  // automatically (InstallmentsService.registerPayment). This is the one
  // place that has to say so before the fact — the backend never asks for
  // a second confirmation.
  const excess = Math.max(0, amountPaid + moraWaived - totalDue);

  return (
    <Modal maxWidth="max-w-[420px]">
      <h2 className="text-[16px] font-medium text-white">
        Confirmar registro de pago
      </h2>
      <p className="mt-2.5 text-small text-muted">
        Vas a registrar un pago de{' '}
        <strong className="text-white">{formatCurrency(amountPaid)}</strong>{' '}
        para la cuota {installment.installmentNumber}
        {moraWaived > 0 && (
          <>
            , condonando{' '}
            <strong className="text-white">{formatCurrency(moraWaived)}</strong>{' '}
            de mora
          </>
        )}
        .
      </p>
      <p className="mt-2 text-small text-muted">
        Con este pago, la cuota quedará{' '}
        {willCloseCuota ? (
          <strong className="text-white">PAGADA POR COMPLETA</strong>
        ) : (
          <>
            con un saldo pendiente de{' '}
            <strong className="text-white">
              {formatCurrency(remainingAfter)}
            </strong>
          </>
        )}
        .
      </p>
      {willCloseCuota && (
        <p className="mt-2.5 text-small text-muted">
          Al confirmar, se le enviará automáticamente al cliente un mensaje de
          WhatsApp confirmando el pago.
        </p>
      )}
      {excess > 0 && (
        <p className="mt-2.5 text-small text-muted">
          El excedente de{' '}
          <strong className="text-white">{formatCurrency(excess)}</strong>{' '}
          quedará como saldo a favor del cliente, disponible para aplicar a
          cualquiera de sus cuotas.
        </p>
      )}

      <div className="mt-6 border-t border-border" />

      <div className="mt-5 flex items-center justify-end gap-3">
        <Button variant="secondary" onClick={onCancel} disabled={isSubmitting}>
          Cancelar
        </Button>
        <Button onClick={onConfirm} disabled={isSubmitting}>
          {isSubmitting ? 'Registrando…' : 'Sí, registrar pago'}
        </Button>
      </div>
    </Modal>
  );
}

// Field now lives in @/components/ui/Field — see DESIGN_TOKENS.md's
// "Component-based centralization" section.
