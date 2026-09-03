import { Header } from '@/components/layout/Header';
import { ChangePasswordCard } from '@/features/auth/ChangePasswordDialog';
import { useAuth } from '@/features/auth/useAuth';
import { getInitials } from '@/lib/format';

// createdAt is a real timestamp (TypeORM @CreateDateColumn), not a
// date-only column — unlike formatDateOnly (lib/format.ts), this should
// convert to the viewer's LOCAL time, per that helper's own doc comment.
// "Enero 2025" matches the Figma design's "Desde" field exactly (month +
// year only, capitalized — toLocaleDateString lowercases the month name
// in es-CO).
function formatMemberSince(isoDateTime: string): string {
  const label = new Date(isoDateTime).toLocaleDateString('es-CO', {
    month: 'long',
    year: 'numeric',
  });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

// Matches the client's "Mi perfil" design: two cards, "Información de
// cuenta" (read-only) and "Cambiar contraseña" (ChangePasswordCard, moved
// here from a Sidebar key-icon modal per client request). Reachable by
// clicking the user block in the Sidebar footer.
export function ProfilePage() {
  const { user } = useAuth();

  const initials = user ? getInitials(user.fullName) : '';

  return (
    <div className="flex flex-col gap-5">
      <Header
        title="Mi perfil"
        subtitle="Gestiona tu información y contraseña"
      />

      <div className="border-t border-border" />

      <div className="grid grid-cols-2 gap-6">
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
                {user?.fullName}
              </span>
              <span className="text-label text-muted">
                {user?.role === 'admin' ? 'Administrador' : 'Cobrador'}
              </span>
            </div>
          </div>

          <div className="mt-4 border-t border-border" />

          <div className="mt-4 flex flex-col gap-3">
            <InfoField label="Nombre" value={user?.fullName ?? '—'} />
            <InfoField label="Correo" value={user?.email ?? '—'} />
            <InfoField
              label="Rol"
              value={user?.role === 'admin' ? 'Administrador' : 'Cobrador'}
            />
            <InfoField
              label="Desde"
              value={user ? formatMemberSince(user.createdAt) : '—'}
            />
          </div>
        </div>

        <ChangePasswordCard />
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
