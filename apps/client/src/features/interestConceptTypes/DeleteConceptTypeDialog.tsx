import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { ApiError } from '@/lib/apiClient';
import { useEscapeKey } from '@/lib/useEscapeKey';

interface DeleteConceptTypeDialogProps {
  conceptTypeName: string;
  onConfirm: () => Promise<unknown>;
  onClose: () => void;
}

// Human request, 2026-09-03 — styled after DeleteUserDialog.tsx (same
// confirm-with-inline-error pattern). Only ever opened for an
// already-deactivated concept type (InterestConceptTypesPage.tsx only
// shows "Eliminar" on the Desactivados tab) — the server is the real
// enforcement for the "never used on a loan" rule, so a type that turns
// out to have been used surfaces as an inline error here instead of
// failing silently. See InterestConceptTypesService.remove().
export function DeleteConceptTypeDialog({
  conceptTypeName,
  onConfirm,
  onClose,
}: DeleteConceptTypeDialogProps) {
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
          : 'No se pudo eliminar el cargo. Intenta de nuevo.',
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal maxWidth="max-w-[420px]">
      <h2 className="text-[16px] font-medium text-white">Eliminar cargo</h2>
      <p className="mt-2.5 text-small text-muted">
        ¿Estás seguro de que deseas eliminar "{conceptTypeName}"? Esta acción es
        permanente y no se puede deshacer. Solo es posible si este cargo nunca
        se usó en ningún préstamo — si ya se usó, seguirá bloqueado y solo podrá
        quedar desactivado.
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
