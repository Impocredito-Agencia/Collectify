import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { useEscapeKey } from '@/lib/useEscapeKey';

interface DeactivateUserDialogProps {
  userName: string;
  onConfirm: () => Promise<unknown>;
  onClose: () => void;
}

// Mirrors DeactivateClientDialog.tsx — same confirm-before-lockout pattern,
// applied here to a company account instead of a client.
export function DeactivateUserDialog({
  userName,
  onConfirm,
  onClose,
}: DeactivateUserDialogProps) {
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
        Desactivar usuario
      </h2>
      <p className="mt-2.5 text-small text-muted">
        ¿Está seguro de que desea desactivar a {userName}? No podrá iniciar
        sesión hasta que sea reactivado.
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
