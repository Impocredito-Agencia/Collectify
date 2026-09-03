import { Link } from 'react-router-dom';

import type { ReactNode } from 'react';

interface RowActionButtonProps {
  children: ReactNode;
  onClick?: () => void;
  to?: string;
  tone?: 'muted' | 'subtle';
  className?: string;
  // Button-only (a <Link> can't be meaningfully "disabled") — used by
  // LoanDetailPage's "Pagar" action, locked until earlier installments are
  // paid. disabled:hover:text-muted cancels the hover-lit state while
  // locked, same idea as the pre-existing disabled:opacity-40.
  disabled?: boolean;
  title?: string;
}

// Small pill-style action button used in every table's last column ("Ver",
// "Ver detalle", "Editar", "Desactivar", "Reactivar", the audit/message
// logs' "Ver detalle"...) — style cleanup, 2026-09-02. Was 3 near-identical
// local `RowAction` components (`ClientRow.tsx`, `UserRow.tsx`,
// `LoanRow.tsx`) plus the same className string repeated inline in 6 more
// files (`DashboardPage`, `ClientDetailPage`, `LoanDetailPage`,
// `MessageLogsPage`, `AuditLogsPage`). Centralized so a fix like this one
// lands everywhere at once instead of a 9-file sweep.
//
// Client compared this against the Select dropdown fix from the same
// session: text already lit up on hover (`hover:text-white` /
// `hover:text-muted`), but the box never did. Added `hover:bg-border` —
// same wash Select's trigger and option list already use for their own
// hover — to every tone, so both the box and the text light up together.
export function RowActionButton({
  children,
  onClick,
  to,
  tone = 'muted',
  className = '',
  disabled = false,
  title,
}: RowActionButtonProps) {
  const toneClassName =
    tone === 'subtle'
      ? 'text-subtle hover:bg-border hover:text-muted'
      : 'text-muted hover:bg-border hover:text-white';
  const fullClassName = `rounded-[3px] border border-border bg-input px-1.75 py-1 text-meta ${toneClassName} ${className}`;

  if (to) {
    return (
      <Link to={to} className={fullClassName}>
        {children}
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`${fullClassName} disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted`}
    >
      {children}
    </button>
  );
}
