import type { ReactNode } from 'react';

interface ThProps {
  children?: ReactNode;
  className?: string;
  // See TdProps.compact — same shorter-row opt-in, kept in sync so a
  // compact table's header and body cells still line up.
  compact?: boolean;
}

interface TdProps {
  children: ReactNode;
  className?: string;
  // Every data table in this app has exactly one "identifying" column per
  // row (a name, an ID, an amount) rendered white/font-medium, and every
  // other column rendered as quieter supporting detail — same relationship
  // as a table row's "title" vs "subtitle". `muted` picks the latter.
  muted?: boolean;
  // Shorter row height (h-8 vs the default h-11/h-[38px]) for a table that
  // lives inside a constrained, scrollable panel rather than a full page —
  // e.g. LoanForm/RefinanceLoanForm/LoanQuotePage's schedule-preview table,
  // where a shorter row means more installments visible without scrolling.
  // Opt-in and per-call-site (not a global height change) so every other
  // table's row height is untouched — confirmed with the human, 2026-09-03.
  compact?: boolean;
}

// Table cells (style cleanup, 2026-09-02) — every list/detail table in the
// app (Clientes, Préstamos, Usuarios, Auditoría, Mensajes, Proyector
// rápido, the loans/installments tables inside LoanDetailPage and
// ClientDetailPage) had its own hand-copied `Th`/`Td` pair, or in
// ClientDetailPage's case no component at all, just repeated inline
// `<td className="...">`. Auditing all of them turned up real drift, not
// just duplication:
//   - LoanQuotePage's Th/Td used `h-11 px-4`/`h-12 px-4` — visibly taller,
//     wider-padded rows than every other table (`h-[38px] px-3.5`/`h-11
//     px-3.5`).
//   - UsuryRatesPage didn't use the `text-label`/`text-small` size tokens
//     or `text-muted` at all — plain `px-5 py-3`, default text color.
//   - LoanDetailPage's muted `Td` used `text-mid`, one shade darker than
//     every other table's `text-muted` for the same "secondary column"
//     role.
//   - UsersListPage's `Td` had no `muted` prop — the muted look was the
//     default, and the one white/bold column was reached by overriding
//     className instead, the opposite API from ClientRow/LoanRow's `Td`.
//   - AuditLogsPage/MessageLogsPage's `Td` had no `muted` prop either —
//     "secondary" columns got a `className="text-muted"` override on top
//     of the default `font-medium`, so those cells ended up bold-and-muted
//     instead of the regular-weight-and-muted every other table uses for
//     the same role.
// One shared pair, matching the majority pattern (ClientRow.tsx/
// LoanRow.tsx, byte-identical to each other already), fixes all of the
// above at once and gives future tables one obvious import instead of a
// new copy to hand-roll.
// Font size bumped text-label (11px) → text-small (12px), style cleanup
// 2026-09-02 — client devtools-inspected a real Linear column header
// directly: 12px, color #8A8F98. Our `text-muted` was already that exact
// hex (see index.css), only the size was off. Changed once, here, so it
// applies to every table in the app that imports this `Th` — that's the
// whole point of having centralized it.
export function Th({ children, className = '', compact = false }: ThProps) {
  return (
    <th
      className={`${compact ? 'h-8' : 'h-[38px]'} px-3.5 text-left text-small font-normal tracking-normal text-muted ${className}`}
    >
      {children}
    </th>
  );
}

// Default-cell color changed text-white (#F7F8F8) → text-strong
// (#D0D6E0), style cleanup 2026-09-02 — client devtools-inspected a real
// Linear table cell directly: 12px (already matched, text-small), color
// #D0D6E0. That's our existing `strong` token (see index.css — "Linear's
// emphasized secondary tone"), not pure white; even a table's primary
// column isn't full white in Linear. `muted` branch untouched.
export function Td({
  children,
  className = '',
  muted = false,
  compact = false,
}: TdProps) {
  const height = compact ? 'h-8' : 'h-11';
  return (
    <td
      className={
        muted
          ? `${height} px-3.5 text-small text-muted ${className}`
          : `${height} px-3.5 text-small font-medium text-strong ${className}`
      }
    >
      {children}
    </td>
  );
}
