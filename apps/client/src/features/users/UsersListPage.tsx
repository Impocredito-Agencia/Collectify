import { useState } from 'react';

import { Header } from '@/components/layout/Header';
import { Button } from '@/components/ui/Button';
import { FilterTab } from '@/components/ui/FilterTab';
import { Th } from '@/components/ui/Table';
import { useAuth } from '@/features/auth/useAuth';
import { DeactivateUserDialog } from '@/features/users/DeactivateUserDialog';
import { UserForm } from '@/features/users/UserForm';
import { UserPermissionsDialog } from '@/features/users/UserPermissionsDialog';
import { UserRow } from '@/features/users/UserRow';
import {
  useCreateUser,
  useDeactivateUser,
  useReactivateUser,
  useUpdateUserPermissions,
  useUsers,
} from '@/features/users/useUsers';
import { ApiError } from '@/lib/apiClient';

import type { User } from '@/features/users/usersApi';
import type { ReactNode } from 'react';

// Company (collector/admin) account management — never had a frontend
// despite the backend supporting it fully since Phase 2. Mirrors
// ClientsListPage.tsx's shell (Header, tabs, table, row actions), minus
// search and pagination: QueryUsersDto only supports isActive, and a
// company user list is expected to stay small. See
// docs/phasesClient/PHASE_19_USER_MANAGEMENT.md.
export function UsersListPage() {
  const { user: currentUser } = useAuth();

  const [showInactive, setShowInactive] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [deactivatingUser, setDeactivatingUser] = useState<User | null>(null);
  const [editingPermissionsUser, setEditingPermissionsUser] =
    useState<User | null>(null);
  const [reactivateError, setReactivateError] = useState<string | null>(null);

  const {
    data: users,
    isLoading,
    isError,
  } = useUsers({
    isActive: !showInactive,
  });

  const createUser = useCreateUser();
  const deactivateUser = useDeactivateUser();
  const reactivateUser = useReactivateUser();
  const updateUserPermissions = useUpdateUserPermissions();

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <Header
          title="Usuarios"
          subtitle="Solo ADMIN — gestión de cuentas de cobradores y administradores"
        />
        <Button onClick={() => setIsCreating(true)}>+ Nuevo usuario</Button>
      </div>

      <div className="border-t border-border" />

      <div className="flex items-center gap-1">
        <FilterTab
          label="Activos"
          isActive={!showInactive}
          onClick={() => setShowInactive(false)}
        />
        <FilterTab
          label="Inactivos"
          isActive={showInactive}
          onClick={() => setShowInactive(true)}
        />
      </div>

      <div className="overflow-hidden rounded-lg bg-surface">
        <table className="w-full">
          <thead className="bg-input">
            <tr>
              <Th>Nombre</Th>
              <Th>Correo</Th>
              <Th>Rol</Th>
              <Th>Estado</Th>
              <Th>Acciones</Th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <EmptyRow>Cargando…</EmptyRow>}
            {isError && (
              <EmptyRow tone="error">
                No se pudo cargar la lista de usuarios.
              </EmptyRow>
            )}
            {!isLoading && !isError && users?.length === 0 && (
              <EmptyRow>
                {showInactive
                  ? 'No hay usuarios desactivados.'
                  : 'No se encontraron usuarios.'}
              </EmptyRow>
            )}
            {users?.map((user) => (
              <UserRow
                key={user.id}
                user={user}
                isOwnAccount={user.id === currentUser?.id}
                onDeactivate={() => setDeactivatingUser(user)}
                onEditPermissions={() => setEditingPermissionsUser(user)}
                onReactivate={async () => {
                  setReactivateError(null);
                  try {
                    await reactivateUser.mutateAsync(user.id);
                  } catch (err) {
                    setReactivateError(
                      err instanceof ApiError
                        ? err.message
                        : 'No se pudo reactivar el usuario.',
                    );
                  }
                }}
              />
            ))}
          </tbody>
        </table>
      </div>

      {reactivateError && (
        <p className="text-small text-danger" role="alert">
          {reactivateError}
        </p>
      )}

      {isCreating && (
        <UserForm
          onSubmit={(input) => createUser.mutateAsync(input)}
          onSetPermissions={(userId, modules) =>
            updateUserPermissions.mutateAsync({ id: userId, modules })
          }
          onClose={() => setIsCreating(false)}
        />
      )}

      {deactivatingUser && (
        <DeactivateUserDialog
          userName={deactivatingUser.fullName}
          onClose={() => setDeactivatingUser(null)}
          onConfirm={() => deactivateUser.mutateAsync(deactivatingUser.id)}
        />
      )}

      {editingPermissionsUser && (
        <UserPermissionsDialog
          user={editingPermissionsUser}
          onClose={() => setEditingPermissionsUser(null)}
          onSubmit={(modules) =>
            updateUserPermissions.mutateAsync({
              id: editingPermissionsUser.id,
              modules,
            })
          }
        />
      )}
    </div>
  );
}

function EmptyRow({
  children,
  tone = 'muted',
}: {
  children: ReactNode;
  tone?: 'muted' | 'error';
}) {
  return (
    <tr>
      <td
        colSpan={5}
        className={`p-6 text-center text-small ${tone === 'error' ? 'text-danger' : 'text-muted'}`}
      >
        {children}
      </td>
    </tr>
  );
}
