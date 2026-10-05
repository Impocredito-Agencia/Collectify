interface ReceiptFilePreviewProps {
  file: File;
  // The object URL the caller already created for this file (and revokes
  // itself) — the thumbnail's src for a photo, the link target for a PDF.
  previewUrl: string;
}

// One just-picked comprobante, before it's uploaded: a thumbnail for a
// photo, or a "PDF" tile that opens the file in a new tab — a PDF can't
// render as an <img>. Shared by every dialog that attaches a comprobante
// to a payment (RegisterPaymentDialog, BulkRegisterPaymentDialog,
// ReceiptPhotosField).
export function ReceiptFilePreview({
  file,
  previewUrl,
}: ReceiptFilePreviewProps) {
  if (file.type === 'application/pdf') {
    return (
      <a
        href={previewUrl}
        target="_blank"
        rel="noreferrer"
        title={file.name}
        aria-label={`Abrir ${file.name}`}
        className="flex h-[42px] w-[42px] items-center justify-center rounded border border-border bg-input text-meta text-muted hover:border-subtle hover:text-white"
      >
        PDF
      </a>
    );
  }
  return (
    <img
      src={previewUrl}
      alt="Vista previa del comprobante"
      className="h-[42px] w-[42px] rounded border border-border object-cover"
    />
  );
}
