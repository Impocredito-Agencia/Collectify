import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { useEscapeKey } from '@/lib/useEscapeKey';

interface DeactivateConceptTypeDialogProps {
  conceptTypeName: string;
  onConfirm: () => Promise<unknown>;
  onClose: () => void;
}

// Style cleanup, 2026-09-03 (human report — the old "Desactivar" button
// called the mutation directly, no confirmation step at all, unlike every
// other deactivate action in the app: DeactivateClientDialog.tsx,
// DeactivateUserDialog.tsx). Mirrors those.
//
// Copy fixed 2026-09-07 (human report) — this dialog originally said "no
// hay forma de reactivarlo desde aquí", written before reactivation existed
// at all. InterestConceptTypesService.activate() (2026-09-05) added exactly
// that — the "Desactivados" tab's "Activar" button — so the old wording was
// stale/wrong from the day it shipped. Updated to describe what's actually
// true today.
export function DeactivateConceptTypeDialog({
  conceptTypeName,
  onConfirm,
  onClose,
}: DeactivateConceptTypeDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEscapeKey(onClose);

  const handleConfirm = async () => {
    setIsSubmitting(true);
    try {
      await onConfirm();
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal maxWidth="max-w-[400px]">
      <h2 className="text-card-title font-medium text-white">
        Desactivar cargo
      </h2>
      <p className="mt-2.5 text-small text-muted text-justify">
        ¿Está seguro de que desea desactivar "{conceptTypeName}"? Dejará de
        estar disponible para préstamos nuevos, sin afectar los que ya lo usan.
        Puede reactivarlo luego desde "Desactivados"; eliminarlo es un paso
        aparte, solo posible si nunca se usó.
      </p>

      <div className="mt-6 border-t border-border" />

      <div className="mt-5 flex items-center justify-end gap-3">
        <Button variant="secondary" onClick={onClose}>
          Cancelar
        </Button>
        <Button
          variant="neutral"
          onClick={() => void handleConfirm()}
          disabled={isSubmitting}
        >
          {isSubmitting ? 'Desactivando…' : 'Sí, desactivar'}
        </Button>
      </div>
    </Modal>
  );
}
