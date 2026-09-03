import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { useEscapeKey } from '@/lib/useEscapeKey';

interface DeactivateClientDialogProps {
  clientName: string;
  onConfirm: () => Promise<unknown>;
  onClose: () => void;
}

// Matches Figma frame 40:484 ("F-13 / Desactivar — Dialog Desktop").
export function DeactivateClientDialog({
  clientName,
  onConfirm,
  onClose,
}: DeactivateClientDialogProps) {
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
        Desactivar cliente
      </h2>
      <p className="mt-2.5 text-small text-muted">
        ¿Estás seguro de que deseas desactivar a {clientName}? No podrá recibir
        cobros hasta que sea reactivado.
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
