import { RowActionButton } from '@/components/ui/RowActionButton';
import { Td } from '@/components/ui/Table';
import { USER_ROLE_LABELS } from '@/features/users/usersApi';

import type { User } from '@/features/users/usersApi';

interface UserRowProps {
  user: User;
  // The logged-in admin can't deactivate their own account (enforced
  // server-side too, see UsersService.deactivate) — hiding the action for
  // that one row avoids sending a request that's guaranteed to 400.
  isOwnAccount: boolean;
  onDeactivate: () => void;
  onReactivate: () => void;
  onEditPermissions: () => void;
}

// No "Ver detalle"/"Editar" actions — unlike ClientRow.tsx, there's no
// GET /users/:id or PATCH /users/:id on the backend, only create,
// deactivate, and reactivate. See docs/phases/PHASE_19_USER_MANAGEMENT.md.
//
// "Permisos" (Phase 20) only shows for an active collector — an admin has
// full access unconditionally, so there's nothing to edit for one. See
// docs/phasesClient/PHASE_20_MODULE_PERMISSIONS.md.
export function UserRow({
  user,
  isOwnAccount,
  onDeactivate,
  onReactivate,
  onEditPermissions,
}: UserRowProps) {
  return (
    <tr className="border-t border-border">
      <Td>{user.fullName}</Td>
      <Td>{user.email}</Td>
      <Td>{USER_ROLE_LABELS[user.role]}</Td>
      <Td>
        <span
          className={
            user.isActive
              ? 'rounded-[3px] border border-muted bg-border px-2 py-[3px] text-meta font-medium text-white'
              : 'rounded-[3px] border border-mid bg-border px-2 py-[3px] text-meta font-medium text-mid'
          }
        >
          {user.isActive ? 'Activo' : 'Inactivo'}
        </span>
      </Td>
      <Td>
        {user.isActive ? (
          <div className="flex gap-2">
            {user.role === 'collector' && (
              <RowActionButton onClick={onEditPermissions}>
                Permisos
              </RowActionButton>
            )}
            {isOwnAccount ? (
              <span className="text-meta text-mid">Tu cuenta</span>
            ) : (
              <RowActionButton onClick={onDeactivate} tone="subtle">
                Desactivar
              </RowActionButton>
            )}
          </div>
        ) : (
          <RowActionButton onClick={onReactivate}>Reactivar</RowActionButton>
        )}
      </Td>
    </tr>
  );
}
