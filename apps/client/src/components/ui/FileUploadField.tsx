import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/Button';

import type { ChangeEvent } from 'react';

interface FileUploadFieldProps {
  // Currently staged file, not yet uploaded — the caller owns this state
  // and only actually uploads it (via lib/imageUpload.ts) once the parent
  // form submits, same deferred-upload pattern as
  // RegisterPaymentDialog.tsx's imageFile. Controlled rather than
  // self-contained so the parent form can include this file in its own
  // validation/submit flow.
  file: File | null;
  onFileChange: (file: File | null) => void;
  // Already-uploaded URL from a previous save (edit mode) — shown as the
  // current value until the admin picks a replacement file. Ignored once
  // `file` is set.
  existingUrl?: string | null;
  accept?: string;
  disabled?: boolean;
}

// Phase 21 — the same "pick a file, preview it, remove it, upload only on
// submit" interaction RegisterPaymentDialog.tsx already built for payment
// receipts, extracted into a shared component since this phase needs it
// four times on ClientForm.tsx (ID front/back, selfie, consent evidence)
// plus once on LoanForm.tsx (co-debtor ID document) — see
// docs/phasesClient/PHASE_21_CLIENT_PROFILE.md. Widened beyond
// RegisterPaymentDialog's image-only version to also handle PDFs (the ID
// document fields accept a single combined PDF as an alternative to two
// photos): a picked PDF can't be shown as an <img> preview, so it's shown
// as a filename chip instead of a thumbnail.
export function FileUploadField({
  file,
  onFileChange,
  existingUrl = null,
  accept = 'image/*,application/pdf',
  disabled = false,
}: FileUploadFieldProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // object URLs must be revoked explicitly or they leak — mirrors
  // RegisterPaymentDialog.tsx's cleanup effect.
  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    onFileChange(event.target.files?.[0] ?? null);
  };

  if (file) {
    const isImage = file.type.startsWith('image/');
    return (
      <div className="flex items-center gap-3">
        {isImage && previewUrl ? (
          <img
            src={previewUrl}
            alt={`Vista previa de ${file.name}`}
            className="h-[42px] w-[42px] rounded border border-border object-cover"
          />
        ) : (
          <span className="rounded border border-border bg-input px-2.5 py-1.5 text-meta text-muted">
            {file.name}
          </span>
        )}
        <button
          type="button"
          disabled={disabled}
          onClick={() => onFileChange(null)}
          className="text-meta text-subtle hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          Quitar
        </button>
      </div>
    );
  }

  if (existingUrl) {
    return (
      <div className="flex items-center gap-3">
        <a
          href={existingUrl}
          target="_blank"
          rel="noreferrer"
          className="text-meta text-muted hover:text-white hover:underline"
        >
          Ver archivo actual
        </a>
        <label className="cursor-pointer text-meta text-muted hover:text-white">
          Reemplazar
          <input
            type="file"
            accept={accept}
            disabled={disabled}
            onChange={handleFileChange}
            className="hidden"
          />
        </label>
      </div>
    );
  }

  // 2026-09-05: same Button migration applied to ImportClientsDialog.tsx,
  // RegisterPaymentDialog.tsx and BulkRegisterPaymentDialog.tsx — the native
  // picker button had a different size/shape/hover than every other button
  // in the app. Real input stays mounted but visually hidden, triggered via
  // ref; the filename text is rendered separately since hiding the input
  // also hides the browser's own placeholder text.
  return (
    <div className="flex items-center gap-3">
      <input
        ref={fileInputRef}
        type="file"
        accept={accept}
        disabled={disabled}
        onChange={handleFileChange}
        className="hidden"
      />
      <Button
        type="button"
        variant="secondary"
        disabled={disabled}
        onClick={() => fileInputRef.current?.click()}
        className="w-fit"
      >
        Elegir archivo
      </Button>
      <span className="text-meta text-muted">Ningún archivo seleccionado</span>
    </div>
  );
}
