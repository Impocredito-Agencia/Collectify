import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/Button';

import type { ChangeEvent } from 'react';

interface PickedPhoto {
  file: File;
  previewUrl: string;
}

interface ReceiptPhotosFieldProps {
  // Called with the files currently picked, every time the list changes —
  // the caller uploads them itself when the form is confirmed (see
  // uploadPaymentReceipt in lib/imageUpload.ts), same as
  // RegisterPaymentDialog: a photo is never uploaded until the payment is
  // actually being submitted.
  onChange: (files: File[]) => void;
  disabled?: boolean;
}

// The "pick photos of the comprobante, see thumbnails, remove one" control,
// for dialogs that just need the files (PayoffDialog). RegisterPaymentDialog
// and BulkRegisterPaymentDialog each keep their own copy of this same
// behavior because they also carry per-row/pre-attached photo state — left
// alone rather than reworked while adding this one.
export function ReceiptPhotosField({
  onChange,
  disabled = false,
}: ReceiptPhotosFieldProps) {
  const [photos, setPhotos] = useState<PickedPhoto[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Latest list for the unmount cleanup below — a plain `photos` reference
  // inside the effect would only ever see the first (empty) render's value.
  const photosRef = useRef(photos);
  photosRef.current = photos;

  useEffect(
    () => () => {
      for (const photo of photosRef.current) {
        URL.revokeObjectURL(photo.previewUrl);
      }
    },
    [],
  );

  const update = (next: PickedPhoto[]) => {
    setPhotos(next);
    onChange(next.map((photo) => photo.file));
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length > 0) {
      update([
        ...photos,
        ...files.map((file) => ({
          file,
          previewUrl: URL.createObjectURL(file),
        })),
      ]);
    }
    // Lets the same file be picked again after removing it.
    event.target.value = '';
  };

  const handleRemove = (index: number) => {
    URL.revokeObjectURL(photos[index].previewUrl);
    update(photos.filter((_, i) => i !== index));
  };

  return (
    <div className="flex flex-col gap-2.5">
      {photos.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          {photos.map((photo, index) => (
            <div
              key={photo.previewUrl}
              className="flex flex-col items-center gap-1"
            >
              <img
                src={photo.previewUrl}
                alt="Vista previa del comprobante"
                className="h-[42px] w-[42px] rounded border border-border object-cover"
              />
              <button
                type="button"
                onClick={() => handleRemove(index)}
                disabled={disabled}
                className="text-meta text-subtle hover:text-white disabled:opacity-50"
              >
                Quitar
              </button>
            </div>
          ))}
        </div>
      )}
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
        disabled={disabled}
        className="w-fit"
      >
        Agregar foto
      </Button>
    </div>
  );
}
