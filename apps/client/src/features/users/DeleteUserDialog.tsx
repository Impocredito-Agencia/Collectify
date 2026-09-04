import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { ApiError } from '@/lib/apiClient';
import { useEscapeKey } from '@/lib/useEscapeKey';

interface DeleteUserDialogProps {
  userName: string;
  onConfirm: () => Promise<unknown>;
  onClose: () => void;
}

// Phase 20 follow-up — styled after DeleteLoanDialog.tsx (same
// confirm-with-inline-error pattern), applied here to a company account.
// Only ever opened for an already-deactivated user (UserRow.tsx only shows
// "Eliminar" on an inactive row) — worded to make clear this is a second,
// permanent step past deactivation, not a substitute for it.
export function DeleteUserDialog({
  userName,
  onConfirm,
  onClose,
}: DeleteUserDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEscapeKey(onClose);

  const handleConfirm = async () => {
    setError(null);
    setIsSubmitting(true);
    try {
      await onConfirm();
      onClose();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'No se pudo eliminar el usuario. Intenta de nuevo.',
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal maxWidth="max-w-[420px]">
      <h2 className="text-[16px] font-medium text-white">Eliminar usuario</h2>
      <p className="mt-2.5 text-small text-muted">
        ¿Estás seguro de que deseas eliminar a {userName}? Esta acción es
        permanente y no se puede deshacer — la cuenta desaparece por completo, a
        diferencia de desactivarla.
      </p>

      <div className="mt-6 border-t border-border" />

      {error && (
        <p className="mt-4 text-small text-danger" role="alert">
          {error}
        </p>
      )}

      <div className="mt-5 flex items-center justify-end gap-3">
        <Button variant="secondary" onClick={onClose}>
          Cancelar
        </Button>
        <Button
          variant="danger"
          onClick={() => void handleConfirm()}
          disabled={isSubmitting}
        >
          {isSubmitting ? 'Eliminando…' : 'Sí, eliminar'}
        </Button>
      </div>
    </Modal>
  );
}
