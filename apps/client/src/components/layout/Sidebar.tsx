import { NavLink } from 'react-router-dom';

import { CollectifyMark } from '@/components/ui/CollectifyMark';
import { useAuth } from '@/features/auth/useAuth';
import { USER_ROLE_LABELS } from '@/features/users/usersApi';
import { useConversationTickets } from '@/features/whatsappInboundMessages/useWhatsappInboundMessages';
import { WhatsappTicketStatus } from '@/features/whatsappInboundMessages/whatsappConversationTicketsApi';
import { formatSidebarName, getInitials } from '@/lib/format';

import type { AppModule, UserRole } from '@/features/auth/authApi';
import type { ReactNode } from 'react';

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
  // Style cleanup (2026-09-01): small line icon rendered before the label —
  // see the icon components below. Hand-rolled inline SVGs, matching this
  // app's existing convention (CloseButton.tsx, the "+" icon in
  // InterestConceptTypesPage.tsx) instead of adding an icon-library
  // dependency for 11 icons.
  icon: ReactNode;
  // Style cleanup (2026-09-01): set on the first item of a new group to
  // print a small section label above it, making the daily-ops /
  // catálogos / administración grouping (see comment below) visible
  // instead of only living in this file's comments. The first group
  // (Dashboard..Proyector rápido) is intentionally left unlabeled, matching
  // the pattern in both Stripe's and Linear's sidebars (the "current work"
  // items up top have no header; only the groups below them do).
  groupLabel?: string;
}

// Style cleanup (2026-09-01): one small line icon per nav item, added after
// comparing our sidebar against Stripe's and Linear's (both use an icon next
// to every label, which helps scanning a list this long without reading
// every word — most useful for the two easily-confused "Envíos fallidos" /
// "Mensajes entrantes" pair). Same visual language as the rest of the app's
// hand-rolled icons: 20x20 viewBox, currentColor stroke, no fill except a
// couple of small solid accent dots.
function IconBase({ children }: { children: ReactNode }) {
  return (
    <svg
      className="size-4 shrink-0"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
    >
      {children}
    </svg>
  );
}

function DashboardIcon() {
  return (
    <IconBase>
      <rect x="3" y="3" width="6" height="6" rx="1" strokeWidth="1.5" />
      <rect x="11" y="3" width="6" height="6" rx="1" strokeWidth="1.5" />
      <rect x="3" y="11" width="6" height="6" rx="1" strokeWidth="1.5" />
      <rect x="11" y="11" width="6" height="6" rx="1" strokeWidth="1.5" />
    </IconBase>
  );
}

function ClientsIcon() {
  return (
    <IconBase>
      <circle cx="10" cy="7" r="3" strokeWidth="1.5" />
      <path
        d="M4.5 17c0-3.3 2.5-6 5.5-6s5.5 2.7 5.5 6"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </IconBase>
  );
}

function LoansIcon() {
  return (
    <IconBase>
      <rect x="2.5" y="6" width="15" height="9" rx="1.5" strokeWidth="1.5" />
      <circle cx="10" cy="10.5" r="2" strokeWidth="1.5" />
    </IconBase>
  );
}

function InboundMessagesIcon() {
  return (
    <IconBase>
      <path d="M3 8l1.5-4h11L17 8" strokeWidth="1.5" strokeLinecap="round" />
      <rect x="3" y="8" width="14" height="8" rx="1.5" strokeWidth="1.5" />
      <path
        d="M3 12h4l1.2 2h3.6l1.2-2h4"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </IconBase>
  );
}

function FailedSendsIcon() {
  return (
    <IconBase>
      <path
        d="M3 5.5A1.5 1.5 0 014.5 4h11A1.5 1.5 0 0117 5.5v7a1.5 1.5 0 01-1.5 1.5H8l-3.5 3v-3H4.5A1.5 1.5 0 013 12.5v-7z"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M10 7.3v3" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="10" cy="12" r="0.5" fill="currentColor" stroke="none" />
    </IconBase>
  );
}

function QuickQuoteIcon() {
  return (
    <IconBase>
      <rect x="4" y="3" width="12" height="14" rx="1.5" strokeWidth="1.5" />
      <rect x="6" y="5.5" width="8" height="3" rx="0.5" strokeWidth="1.5" />
      <path
        d="M6.5 12h1M6.5 14.5h1M10 12h1M10 14.5h1M13.5 12h1M13.5 14.5h1"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </IconBase>
  );
}

function TemplatesIcon() {
  return (
    <IconBase>
      <rect x="4.5" y="3" width="11" height="14" rx="1.5" strokeWidth="1.5" />
      <path d="M7 7h6M7 10h6M7 13h4" strokeWidth="1.5" strokeLinecap="round" />
    </IconBase>
  );
}

function ChargeTypesIcon() {
  return (
    <IconBase>
      <path
        d="M10.5 3.5H16a1 1 0 011 1v5.5a1 1 0 01-.29.7l-6.5 6.5a1 1 0 01-1.42 0l-5.5-5.5a1 1 0 010-1.42l6.5-6.5a1 1 0 01.71-.28z"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <circle cx="13.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
    </IconBase>
  );
}

function UsuryRateIcon() {
  return (
    <IconBase>
      <circle cx="6" cy="6" r="2" strokeWidth="1.5" />
      <circle cx="14" cy="14" r="2" strokeWidth="1.5" />
      <path d="M15 5L5 15" strokeWidth="1.5" strokeLinecap="round" />
    </IconBase>
  );
}

function AuditIcon() {
  return (
    <IconBase>
      <circle cx="8.5" cy="8.5" r="4.5" strokeWidth="1.5" />
      <path d="M15 15l-3-3" strokeWidth="1.5" strokeLinecap="round" />
    </IconBase>
  );
}

function UsersIcon() {
  return (
    <IconBase>
      <circle cx="7" cy="7" r="2.5" strokeWidth="1.5" />
      <path
        d="M2.5 17c0-2.8 2-5 4.5-5s4.5 2.2 4.5 5"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx="14.5" cy="8" r="2" strokeWidth="1.5" />
      <path
        d="M12 17c.2-2.2 1.5-4 3.5-4s3.5 2 3.5 4.2"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </IconBase>
  );
}

// "Salir" — icon-only, not text (style cleanup, 2026-09-02) — the client
// asked to reclaim the width the word "Salir" was taking in the footer row,
// to give the user's full name more room. Smaller than IconBase's nav-icon
// default (size-3.5 vs size-4) since this sits in a tight action slot, not
// a full nav row.
function LogoutIcon() {
  return (
    <svg
      className="size-3.5 shrink-0"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
    >
      <path
        d="M8 17H4.5A1.5 1.5 0 013 15.5v-11A1.5 1.5 0 014.5 3H8"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M13 13.5L17 10l-4-3.5M17 10H8"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Full nav per the Figma "Design System" file (sidebar in frame 40:3) has 8
// items: Dashboard, Clientes, Préstamos, Mensajes, Plantillas, Reportes,
// Gestionar usuarios, Configuración. Only items with a real route are
// listed here — uncomment/add each as its phase ships (see
// docs/phasesClient). Gestionar usuarios and Configuración are admin-only
// per docs/PROJECT_ROADMAP.md Phase 8.
// Reordered outside the phase roadmap (style cleanup, 2026-09-01) — grouped
// by how often each module is actually touched instead of build order:
// daily operation (Dashboard through Proyector rápido) → catalogs/config
// admins set up once and rarely revisit (Plantillas through Tasa de usura)
// → administration/oversight (Auditoría, Usuarios). Within the daily group,
// Mensajes entrantes sits right before Envíos fallidos so inbound/outbound
// WhatsApp read together, and Proyector rápido sits right after (a loan
// tool, grouped with daily items since it's used constantly, not a
// messaging one). Each item now also carries an `icon` and the last two
// groups carry a `groupLabel` — a visible header for the grouping described
// above, matching how Stripe's and Linear's sidebars label their non-top
// sections (see the icon components above this array).
// Human report, 2026-09-13 — "Mensajes entrantes" is the one nav item that
// carries a live count, matching how Intercom/WhatsApp Business badge
// their own inbox nav entry.
const MESSAGES_NAV_PATH = '/mensajes-entrantes';

const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', to: '/', icon: <DashboardIcon /> },
  { label: 'Clientes', to: '/clientes', icon: <ClientsIcon /> },
  { label: 'Préstamos', to: '/prestamos', icon: <LoansIcon /> },
  // Not in the original Figma nav (no frame exists for Phase 22). Phase 20
  // — migrated from roles: ['admin'] to module: 'messages', matching
  // WhatsappController's move to @RequireModule() (folded into the same
  // module as Envíos fallidos, per the human's decision). See
  // docs/phasesClient/PHASE_22_WHATSAPP_WEBHOOK.md and
  // docs/phases/PHASE_20_MODULE_PERMISSIONS.md.
  {
    label: 'Mensajes entrantes',
    to: '/mensajes-entrantes',
    module: 'messages',
    icon: <InboundMessagesIcon />,
  },
  // Style cleanup (2026-09-01): was "Mensajes" — misleading on its own,
  // and doubly so once placed next to "Mensajes entrantes" above. This
  // page (MessageLogsPage.tsx) is specifically the failed/unsent-send
  // retry queue, not a general message inbox — see that file's own
  // header subtitle. Renamed to say what it actually is.
  { label: 'Envíos fallidos', to: '/mensajes', icon: <FailedSendsIcon /> },
  // Phase 14's "amortizador proyector" — open to every role, same as the
  // three items above, since it's a stateless calculator with no client
  // data and nothing persisted. See
  // docs/phasesClient/PHASE_14_INTEREST_CONCEPTS.md.
  // Phase 32 — renamed to "Proyector rápido" (label only; route/path left
  // as /cotizador, matching this project's precedent of not renaming URL
  // slugs for copy-only changes — see docs/phases/PHASE_31_LOAN_TERMINOLOGY.md).
  { label: 'Proyector rápido', to: '/cotizador', icon: <QuickQuoteIcon /> },
  {
    label: 'Plantillas',
    to: '/plantillas',
    module: 'message_templates',
    icon: <TemplatesIcon />,
    groupLabel: 'Catálogos',
  },
  // Phase 23 — migrated from roles: ['admin'] to module, matching
  // InterestConceptTypesController's move to @RequireModule(). See
  // docs/phases/PHASE_23_DYNAMIC_CHARGES.md.
  // Style cleanup (2026-09-01): was "Cargos adicionales" — this is the
  // admin-managed catalog of concept TYPES available when building a
  // loan, not a record of charges already applied to one (that's the
  // "Cargos adicionales" field inside LoanForm/RefinanceLoanForm, a
  // different and correctly-named thing). Renamed to distinguish them.
  {
    label: 'Tipos de cargo',
    to: '/cargos-adicionales',
    module: 'interest_concept_types',
    icon: <ChargeTypesIcon />,
  },
  // Not in the original Figma nav (no frame exists for Phase 15). Phase 20
  // — migrated from roles: ['admin'] to module, matching
  // UsuryRatesController's move to @RequireModule(). See
  // docs/phases/PHASE_15_USURY_RATE.md and
  // docs/phases/PHASE_20_MODULE_PERMISSIONS.md.
  {
    label: 'Tasa de usura',
    to: '/tasa-de-usura',
    module: 'usury_rates',
    icon: <UsuryRateIcon />,
  },
  // Not in the original Figma nav (no frame exists for Phase 11). Phase 20
  // — migrated from roles: ['admin'] to module, matching
  // AuditLogController's move to @RequireModule(). See
  // docs/phases/PHASE_11_AUDIT_LOG.md and
  // docs/phases/PHASE_20_MODULE_PERMISSIONS.md.
  {
    label: 'Auditoría',
    to: '/auditoria',
    module: 'audit_log',
    icon: <AuditIcon />,
    groupLabel: 'Administración',
  },
  // "Gestionar usuarios" from the original Figma nav, finally built in
  // Phase 19 — see docs/phasesClient/PHASE_19_USER_MANAGEMENT.md. Stays
  // roles: ['admin'], deliberately never migrated to module (Phase 20):
  // account management is the one hardcoded admin-only exception the human
  // confirmed — see docs/phases/PHASE_20_MODULE_PERMISSIONS.md.
  {
    label: 'Usuarios',
    to: '/usuarios',
    roles: ['admin'],
    icon: <UsersIcon />,
  },
];

export function Sidebar() {
  const { user, logout } = useAuth();
  const hasMessagesAccess = Boolean(
    user && (user.role === 'admin' || user.modules.includes('messages')),
  );
  // enabled: false for a user with no "messages" access — same reasoning
  // as AppLayout's WhatsappTicketWatcher gate, so this doesn't fire a
  // pointless 403 on every page load for a cobrador who was never granted
  // this module.
  const { data: tickets } = useConversationTickets({
    enabled: hasMessagesAccess,
  });
  const pendingTicketsCount = (tickets ?? []).filter(
    (ticket) => ticket.status === WhatsappTicketStatus.Pending,
  ).length;

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
      <div className="flex items-center gap-3 px-5 py-3">
        {/* Style cleanup (2026-09-02): bumped from size-7/text-[15px]
            (seventeenth pass: size-9/text-[19px]; eighteenth pass:
            size-10/text-[22px]) — the client compared this against a
            screenshot and asked for the header to fill more of the card
            instead of a small logo + name sitting in empty space. Bigger
            tile + bigger wordmark, the way Linear's own sidebar header
            does.
            Nineteenth pass: growing the logo/text grew the row's own
            height too, since the row's height is just content + padding.
            Client wants the row shorter without shrinking the logo/text
            back down — so vertical padding came down instead: `p-5` →
            `px-5 py-3` (horizontal padding, and the divider right below,
            both untouched).
            Twentieth pass: tried `justify-center` on the row, centering
            the logo+wordmark as a unit rather than left-aligning them.
            Twenty-first pass: dropped the `bg-input` tile around the mark,
            since the tile's own box (bigger than the mark itself, for
            padding) was adding asymmetric weight on the icon's side that
            threw the centering off by eye.
            Twenty-second pass: reverted the centering — client compared it
            against every nav item below (all left-aligned) and the
            centered header against a left-aligned list read as more
            "off" than a header that just isn't full-width. Back to the
            row's default left alignment; the tile-less mark from the
            twenty-first pass stays. */}
        <CollectifyMark className="size-8 shrink-0" />
        <span className="text-[22px] font-semibold text-white">Collectify</span>
      </div>

      <div className="border-t border-border" />

      <div className="px-5 pb-1 pt-2">
        {/* Uses text-nav-group-label, not text-section-label — the client
            wants the Sidebar's 3 module-group titles (Menú, Catálogos,
            Administración) treated as their own thing, decoupled from the
            in-page section titles (Kpis, Referencias, etc.), since those
            are getting a different format later. See index.css. */}
        <span className="text-nav-group-label font-normal tracking-normal text-subtle">
          Menú
        </span>
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 px-2">
        {visibleItems.map((item) => (
          <div key={item.to}>
            {item.groupLabel && (
              // mb-2, not mb-1 (style cleanup, 2026-09-02, seventh pass) —
              // compensates for the NavLink padding reduction below so
              // this specific gap (title → its own first module) stays
              // exactly where it was; the client said not to touch it.
              <div className="mb-2 mt-3 px-4 first:mt-0">
                <span className="text-nav-group-label font-normal tracking-normal text-subtle">
                  {/* Was .toUpperCase() — the source strings ('Catálogos',
                      'Administración') are already in the sentence-case
                      the client asked for; the transform was actively
                      undoing that. */}
                  {item.groupLabel}
                </span>
              </div>
            )}
            <NavLink
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
                  // text-nav-item, not text-small (style cleanup,
                  // 2026-09-02, sixth pass) — decoupled per the client's
                  // request; see index.css. Real Linear value is 13px.
                  // py-1.5, not py-2.5 (seventh pass) — client compared
                  // against Linear's own nav directly and asked for
                  // modules within the same group to sit closer together
                  // (Linear's Pulse/Inbox/My issues/Reviews vs. our
                  // Dashboard/Clientes/Préstamos). This shrinks the gap
                  // between consecutive items from 22px to 14px effective
                  // whitespace (10+2+10 → 6+2+6). The group label's own
                  // mb-1→mb-2 change above compensates so title→first-item
                  // spacing (14px) is unchanged, as asked.
                  //
                  // `sidebar-nav-link` marker class (style cleanup,
                  // 2026-09-02) — items sit only `gap-0.5` (2px) apart, too
                  // tight for the app's normal outward-facing focus ring
                  // (2px offset + 2px width = 4px reach) without spilling
                  // into whichever neighbor is on the other side of that
                  // 2px gap. See index.css for the inset-ring override this
                  // class hooks.
                  'sidebar-nav-link flex items-center gap-2.5 rounded-lg px-4 py-1.5 text-nav-item',
                  // Visual polish (2026-09-02): active item used to be a
                  // flat neutral `bg-border` highlight — same tone as
                  // every other gray surface, so it was easy to miss at a
                  // glance. Now tinted with the brand accent (approximated
                  // from the client's own Publi Mark logo — see
                  // index.css's `--color-accent` comment) instead.
                  // Inactive color is now `strong` (#D0D6E0), not `muted`
                  // — devtools-matched against Linear's own nav item text;
                  // active stays `white`, matching how Linear's own
                  // selected item reads brighter than its neighbors.
                  isActive
                    ? 'bg-accent/15 font-medium text-white'
                    : 'font-normal text-strong hover:text-white',
                ].join(' ')
              }
            >
              {item.icon}
              {item.label}
              {item.to === MESSAGES_NAV_PATH && pendingTicketsCount > 0 && (
                <span className="ml-auto flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-danger px-1 text-[10px] font-medium text-white">
                  {pendingTicketsCount}
                </span>
              )}
            </NavLink>
          </div>
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
      {/* Avatar centered against the 2-line block again, lines pulled
          tighter (thirteenth pass, style cleanup, 2026-09-02) — splitting
          into two rows fixed alignment/width but cost two things the
          client wanted back: the avatar used to sit centered against the
          combined name+role height (visually "between" the two lines);
          once name got its own row, the avatar only centered against
          that one line instead, and looked squashed against the top.
          Restructured once more: avatar is now a sibling of a name+role
          column (not nested inside the name's own link), so `items-center`
          on this outer row centers it against the column's full 2-line
          height, same as originally. Only the name text itself is a
          NavLink now (not the avatar) — the avatar is decorative, and
          Salir still can't be nested inside any <a> — so this is the
          minimal restructure that gets the avatar back to spanning both
          lines. gap-0 between the two lines (was gap-0.5) for "pega un
          poco más las dos líneas". One real behavior change worth
          flagging: clicking the avatar itself no longer navigates to
          /perfil — only the name text does. The name is still a large,
          obvious target right next to it, so this should read as a minor
          trade-off rather than a regression. */}
      <div className="flex items-center gap-2 px-3.5 py-2">
        <div className="flex size-[26px] shrink-0 items-center justify-center rounded-full bg-border">
          <span className="text-[9px] font-medium text-muted">
            {user ? getInitials(user.fullName) : ''}
          </span>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-0 overflow-hidden">
          {/* formatSidebarName, not the raw fullName (style cleanup,
              2026-09-02) — a plain CSS truncate cutting a long name off
              mid-character ("Juan Miguel Rincón H...") looked bad;
              formatSidebarName's word-boundary abbreviation is the
              graceful fallback, `truncate` remains the safety net.
              text-nav-item, not text-label (ninth pass) — matches the nav
              items' own size/weight/color instead of a smaller, separate
              style, per the client's request that this block read as a
              continuation of the module list above it. `block`, not the
              NavLink's usual `flex` — this NavLink now wraps only the
              name text (not the avatar), so it just needs to behave like
              a normal truncating text line. */}
          <NavLink
            to="/perfil"
            className="block truncate rounded text-nav-item font-medium text-white"
          >
            {user ? formatSidebarName(user.fullName) : ''}
          </NavLink>
          <div className="flex items-center justify-between gap-2">
            {/* USER_ROLE_LABELS, not .toUpperCase() — was "ADMIN"/shouty
                caps, inconsistent with the sentence-case rule applied to
                every other label this pass. Reuses the same mapping
                UserForm.tsx's role dropdown already uses ("Admin" /
                "Cobrador") instead of inventing a second label set.
                text-nav-group-label, not text-meta (ninth pass) — reuses
                the exact token/weight/color the Sidebar's own "Menú" /
                "Catálogos" / "Administración" labels use. Plain text, not
                a second link to /perfil — the name above already covers
                that; this row's only interactive element is Salir. */}
            <span className="truncate text-nav-group-label font-normal tracking-normal text-subtle">
              {user && USER_ROLE_LABELS[user.role]}
            </span>
            <button
              type="button"
              onClick={logout}
              // Icon-only, not the word "Salir" (style cleanup,
              // 2026-09-02) — client chose this over moving/removing the
              // button, to give the name room above more space. A true
              // flex sibling of the role text, so `items-center` aligns
              // them exactly — no manually-tuned offset to drift out of
              // place. Not nested inside the name's <a> — a <button>
              // inside an <a> is invalid HTML and would make clicking
              // Salir also navigate to /perfil.
              // p-0.5, not p-1 (fifteenth pass — reverted the fourteenth
              // pass's leading-none, which touched the wrong element).
              // This button's own padding (p-1 ≈ 22px tall with the 14px
              // icon) was taller than a plain text line, which is what
              // was actually making the role row — and so the whole
              // 2-line column — taller than it looked, skewing the
              // avatar's centering low. Shrinking the padding here is the
              // real fix; leading-none on the text didn't touch this at
              // all, which is why it changed nothing about the avatar.
              aria-label="Salir"
              title="Salir"
              className="shrink-0 rounded p-0.5 text-subtle hover:text-muted"
            >
              <LogoutIcon />
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
