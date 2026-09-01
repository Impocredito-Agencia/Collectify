import { NavLink } from 'react-router-dom';

import { useAuth } from '@/features/auth/useAuth';
import { getInitials } from '@/lib/format';

import type { AppModule, UserRole } from '@/features/auth/authApi';

interface NavItem {
  label: string;
  to: string;
  // Omitted = visible to every role. Mutually exclusive with `module` in
  // practice — an item migrated to Phase 20's permissions uses `module`
  // instead, not both.
  roles?: UserRole[];
  // Phase 20 — visible if the current user is an admin, or has been
  // granted this module. Set only for a route whose backend controller has
  // migrated to @RequireModule() — see
  // docs/phases/PHASE_20_MODULE_PERMISSIONS.md.
  module?: AppModule;
}

// Full nav per the Figma "Design System" file (sidebar in frame 40:3) has 8
// items: Dashboard, Clientes, Préstamos, Mensajes, Plantillas, Reportes,
// Gestionar usuarios, Configuración. Only items with a real route are
// listed here — uncomment/add each as its phase ships (see
// docs/phasesClient). Gestionar usuarios and Configuración are admin-only
// per docs/PROJECT_ROADMAP.md Phase 8.
const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', to: '/' },
  { label: 'Clientes', to: '/clientes' },
  { label: 'Préstamos', to: '/prestamos' },
  { label: 'Mensajes', to: '/mensajes' },
  // Phase 14's "amortizador proyector" — open to every role, same as the
  // three items above, since it's a stateless calculator with no client
  // data and nothing persisted. See
  // docs/phasesClient/PHASE_14_INTEREST_CONCEPTS.md.
  // Phase 32 — renamed to "Proyector rápido" (label only; route/path left
  // as /cotizador, matching this project's precedent of not renaming URL
  // slugs for copy-only changes — see docs/phases/PHASE_31_LOAN_TERMINOLOGY.md).
  { label: 'Proyector rápido', to: '/cotizador' },
  { label: 'Plantillas', to: '/plantillas', module: 'message_templates' },
  // Phase 23 — migrated from roles: ['admin'] to module, matching
  // InterestConceptTypesController's move to @RequireModule(). See
  // docs/phases/PHASE_23_DYNAMIC_CHARGES.md.
  {
    label: 'Cargos adicionales',
    to: '/cargos-adicionales',
    module: 'interest_concept_types',
  },
  // Not in the original Figma nav (no frame exists for Phase 11) —
  // admin-only, same treatment as Plantillas. See
  // docs/phases/PHASE_11_AUDIT_LOG.md.
  { label: 'Auditoría', to: '/auditoria', roles: ['admin'] },
  // Not in the original Figma nav (no frame exists for Phase 15) —
  // admin-only. See docs/phases/PHASE_15_USURY_RATE.md.
  { label: 'Tasa de usura', to: '/tasa-de-usura', roles: ['admin'] },
  // "Gestionar usuarios" from the original Figma nav, finally built in
  // Phase 19 — see docs/phasesClient/PHASE_19_USER_MANAGEMENT.md.
  { label: 'Usuarios', to: '/usuarios', roles: ['admin'] },
  // Not in the original Figma nav (no frame exists for Phase 22) —
  // admin-only, same treatment as Auditoría. See
  // docs/phasesClient/PHASE_22_WHATSAPP_WEBHOOK.md.
  { label: 'Mensajes entrantes', to: '/mensajes-entrantes', roles: ['admin'] },
];

export function Sidebar() {
  const { user, logout } = useAuth();

  const visibleItems = NAV_ITEMS.filter((item) => {
    if (item.roles) {
      return Boolean(user && item.roles.includes(user.role));
    }
    if (item.module) {
      return Boolean(
        user && (user.role === 'admin' || user.modules.includes(item.module)),
      );
    }
    return true;
  });

  return (
    <aside className="flex w-[220px] shrink-0 flex-col border-r border-border bg-surface">
      <div className="flex items-center gap-2.5 p-5">
        <div className="flex size-7 shrink-0 items-center justify-center rounded bg-white">
          <span className="text-[13px] font-semibold text-background">C</span>
        </div>
        <span className="text-[15px] font-semibold text-white">Collectify</span>
      </div>

      <div className="border-t border-border" />

      <div className="px-5 pb-1 pt-2">
        <span className="text-[8px] font-medium tracking-[0.64px] text-mid">
          MENÚ
        </span>
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 px-2">
        {visibleItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            // `end` restricts the active match to an exact path — needed
            // on "/" (Dashboard) only, since without it every route would
            // match (every path starts with "/"). Every other item should
            // stay highlighted on its nested detail routes too (e.g.
            // /clientes/:id, /prestamos/:id), so the sidebar keeps
            // answering "where am I" one level deep, not just on the
            // exact list page.
            end={item.to === '/'}
            className={({ isActive }) =>
              [
                'flex items-center gap-2.5 rounded px-4 py-2.5 text-small',
                isActive
                  ? 'bg-border font-medium text-white'
                  : 'font-normal text-muted hover:text-white',
              ].join(' ')
            }
          >
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-border" />

      {/* User block — the real design puts this in the sidebar footer, not
          a top header bar (there isn't one, see AppLayout.tsx). Links to
          /perfil ("Mi perfil"), which now also holds "Cambiar
          contraseña" — the client shared that design after an initial
          version of this put a key icon here instead. Shows the real
          name/initials now that GET /auth/me exposes fullName (see
          apps/client/docs/DESIGN_TOKENS.md "Known design/backend gaps") —
          previously fell back to email initials. */}
      <div className="flex items-center gap-2 px-3.5 py-3">
        <NavLink
          to="/perfil"
          className={({ isActive }) =>
            `flex flex-1 items-center gap-2 overflow-hidden rounded ${isActive ? 'text-white' : ''}`
          }
        >
          <div className="flex size-[26px] shrink-0 items-center justify-center rounded-full bg-border">
            <span className="text-[9px] font-medium text-muted">
              {user ? getInitials(user.fullName) : ''}
            </span>
          </div>
          <div className="flex flex-1 flex-col gap-0.5 overflow-hidden">
            <span className="truncate text-label font-medium text-white">
              {user?.fullName}
            </span>
            <span className="text-[8px] tracking-[0.32px] text-muted">
              {user?.role.toUpperCase()}
            </span>
          </div>
        </NavLink>
        <button
          type="button"
          onClick={logout}
          className="shrink-0 text-meta text-subtle hover:text-muted"
        >
          Salir
        </button>
      </div>
    </aside>
  );
}
