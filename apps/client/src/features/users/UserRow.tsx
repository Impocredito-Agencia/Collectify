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
  onDelete: () => void;
}

// "Ver perfil" (Phase 20 follow-up) — read-only, shown for every row
// regardless of active state, backed by the new GET /users/:id. See
// UserDetailPage.tsx. Still no "Editar" — there's no PATCH /users/:id on
// the backend, only create, deactivate, reactivate, permissions, and
// (Phase 20 follow-up) delete. See docs/phases/PHASE_19_USER_MANAGEMENT.md.
//
// "Permisos" (Phase 20) only shows for an active collector — an admin has
// full access unconditionally, so there's nothing to edit for one. See
// docs/phasesClient/PHASE_20_MODULE_PERMISSIONS.md.
//
// "Eliminar" (Phase 20 follow-up) only shows on an already-deactivated
// row — UsersService.remove rejects deleting an account that's still
// active, so this mirrors that rule instead of offering an action that's
// guaranteed to fail.
export function UserRow({
  user,
  isOwnAccount,
  onDeactivate,
  onReactivate,
  onEditPermissions,
  onDelete,
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
            <RowActionButton to={`/usuarios/${user.id}`}>
              Ver perfil
            </RowActionButton>
            {user.role === 'collector' && (
              <RowActionButton onClick={onEditPermissions}>
                Permisos
              </RowActionButton>
            )}
            {isOwnAccount ? (
              // Static placeholder, not a real action — see
              // RowActionButton's own comment on the no-onClick/no-to
              // branch. Same box as Desactivar so this row doesn't look
              // off-center next to Ver perfil/Permisos.
              <RowActionButton tone="subtle">Su cuenta</RowActionButton>
            ) : (
              <RowActionButton onClick={onDeactivate} tone="subtle">
                Desactivar
              </RowActionButton>
            )}
          </div>
        ) : (
          <div className="flex gap-2">
            <RowActionButton to={`/usuarios/${user.id}`}>
              Ver perfil
            </RowActionButton>
            <RowActionButton onClick={onReactivate}>Reactivar</RowActionButton>
            <RowActionButton onClick={onDelete} tone="subtle">
              Eliminar
            </RowActionButton>
          </div>
        )}
      </Td>
    </tr>
  );
}
