import { useNavigate, useParams } from 'react-router-dom';

import { Header } from '@/components/layout/Header';
import { MODULE_LABELS } from '@/features/auth/authApi';
import { useUser } from '@/features/users/useUsers';
import { USER_ROLE_LABELS } from '@/features/users/usersApi';
import { formatMemberSince, getInitials } from '@/lib/format';

import type { AppModule } from '@/features/auth/authApi';

// "Ver perfil" (Phase 20 follow-up) — UserRow.tsx's row action for any
// user, active or not. Read-only: there's no PATCH /users/:id on the
// backend, so unlike ClientDetailPage/LoanDetailPage this page has no
// "Editar" — changes still go through Desactivar/Reactivar/Permisos/
// Eliminar on the Usuarios list itself. Mirrors ProfilePage.tsx's
// "Información de cuenta" card (same fields, same layout), minus
// ChangePasswordCard, which only makes sense for your own account.
//
// The "Volver" link below uses navigate(-1) (browser history), not a
// static Link to /usuarios — raised by the human (2026-09-03): Usuarios
// is the only place this page is reached from today, but the same
// history-based back is used on ProfilePage's Cancelar for consistency,
// so both always return to wherever the admin actually came from.
export function UserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: user, isLoading, isError } = useUser(id ?? '');

  if (isLoading) {
    return <p className="text-small text-muted">Cargando…</p>;
  }

  if (isError || !user) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-small text-danger">
          No se pudo cargar este usuario. Puede que no exista.
        </p>
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="w-fit text-small text-muted hover:text-white"
        >
          ← Volver
        </button>
      </div>
    );
  }

  const initials = getInitials(user.fullName);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-1.5 text-label">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="text-muted hover:text-white"
        >
          Usuarios
        </button>
        <span className="text-mid">/</span>
        <span className="font-medium text-white">{user.fullName}</span>
      </div>

      <Header title="Perfil de usuario" subtitle="Información de la cuenta" />

      <div className="border-t border-border" />

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <div className="rounded border border-border bg-surface p-5">
          <span className="text-[10px] font-normal tracking-normal text-muted">
            INFORMACIÓN DE CUENTA
          </span>

          <div className="mt-3.5 flex items-center gap-3">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-border">
              <span className="text-small font-medium text-muted">
                {initials}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-body font-medium text-white">
                {user.fullName}
              </span>
              <span className="text-label text-muted">
                {USER_ROLE_LABELS[user.role]}
              </span>
            </div>
          </div>

          <div className="mt-4 border-t border-border" />

          <div className="mt-4 flex flex-col gap-3">
            <InfoField label="Nombre" value={user.fullName} />
            <InfoField label="Correo" value={user.email} />
            <InfoField label="Rol" value={USER_ROLE_LABELS[user.role]} />
            <InfoField
              label="Estado"
              value={user.isActive ? 'Activo' : 'Inactivo'}
            />
            <InfoField
              label="Desde"
              value={formatMemberSince(user.createdAt)}
            />
          </div>
        </div>

        <div className="rounded border border-border bg-surface p-5">
          <span className="text-[10px] font-normal tracking-normal text-muted">
            MÓDULOS
          </span>

          <div className="mt-3.5">
            {user.role === 'admin' ? (
              <p className="text-small text-muted">
                Acceso total — un administrador no depende de módulos asignados.
              </p>
            ) : user.modules.length === 0 ? (
              <p className="text-small text-muted">
                Sin módulos asignados todavía.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {user.modules.map((module: AppModule) => (
                  <span
                    key={module}
                    className="rounded-[3px] border border-muted bg-border px-2 py-[3px] text-meta font-medium text-white"
                  >
                    {MODULE_LABELS[module]}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function InfoField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-meta text-mid">{label}</span>
      <span className="text-small text-white">{value}</span>
    </div>
  );
}
