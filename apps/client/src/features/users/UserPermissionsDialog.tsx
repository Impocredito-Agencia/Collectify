import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { CloseButton } from '@/components/ui/CloseButton';
import { Modal } from '@/components/ui/Modal';
import { ModuleChecklist } from '@/features/users/ModuleChecklist';
import { ApiError } from '@/lib/apiClient';
import { useEscapeKey } from '@/lib/useEscapeKey';

import type { AppModule } from '@/features/auth/authApi';
import type { User } from '@/features/users/usersApi';

interface UserPermissionsDialogProps {
  user: User;
  onSubmit: (modules: AppModule[]) => Promise<User>;
  onClose: () => void;
}

// Only ever opened for a collector row (see UserRow.tsx) — an admin has
// full access unconditionally, so editing their modules would do nothing.
// See docs/phasesClient/PHASE_20_MODULE_PERMISSIONS.md.
export function UserPermissionsDialog({
  user,
  onSubmit,
  onClose,
}: UserPermissionsDialogProps) {
  const [modules, setModules] = useState<AppModule[]>(user.modules);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEscapeKey(onClose);

  const handleSave = async () => {
    setFormError(null);
    setIsSubmitting(true);
    try {
      await onSubmit(modules);
      onClose();
    } catch (err) {
      setFormError(
        err instanceof ApiError
          ? err.message
          : 'No se pudieron guardar los permisos. Intenta de nuevo.',
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal maxWidth="max-w-[480px]">
      <div className="flex items-center justify-between">
        <h2 className="text-[16px] font-medium text-white">
          Permisos de {user.fullName}
        </h2>
        <CloseButton onClick={onClose} />
      </div>
      <p className="mt-1 text-label text-muted">
        Módulos del panel que este usuario puede ver y usar.
      </p>

      <div className="mt-5 border-t border-border" />

      <div className="mt-5">
        <ModuleChecklist selected={modules} onChange={setModules} />
      </div>

      {formError && (
        <p className="mt-3 text-small text-danger" role="alert">
          {formError}
        </p>
      )}

      <div className="mt-5 border-t border-border" />

      <div className="mt-5 flex items-center justify-end gap-3">
        <Button variant="secondary" onClick={onClose}>
          Cancelar
        </Button>
        <Button onClick={() => void handleSave()} disabled={isSubmitting}>
          {isSubmitting ? 'Guardando…' : 'Guardar permisos'}
        </Button>
      </div>
    </Modal>
  );
}
