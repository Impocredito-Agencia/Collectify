import type { ReactNode } from 'react';

export type StatusBadgeTone = 'success' | 'danger' | 'neutral';

// Style cleanup (2026-09-01): the exact markup below
// (`rounded-[3px] border px-2 py-[3px] text-meta font-medium` + a
// success/danger color triplet) was copy-pasted identically into
// MessageLogDrawer.tsx, ClientDetailPage.tsx (twice), MessageLogsPage.tsx
// and LoanDetailPage.tsx — five places to keep in sync by hand whenever the
// badge's look changes. Extracted once here instead, backed by the new
// success/danger tokens in index.css (see DESIGN_TOKENS.md "Semantic color
// tokens") instead of each copy's own hardcoded hex. Covers every
// success/danger pill in the app: Enviado/Fallido, Autorización
// firmada/Sin autorización, Bloqueado por mora.
const TONE_CLASSES: Record<StatusBadgeTone, string> = {
  success: 'border-success bg-success-bg text-success',
  danger: 'border-danger bg-danger-bg text-danger',
  // Pending/inapplicable state (e.g. "no message sent yet") — the neutral
  // palette tokens, not a status color, since nothing went right or wrong.
  neutral: 'border-muted bg-border text-muted',
};

interface StatusBadgeProps {
  tone: StatusBadgeTone;
  children: ReactNode;
  className?: string;
  title?: string;
}

export function StatusBadge({
  tone,
  children,
  className = '',
  title,
}: StatusBadgeProps) {
  return (
    <span
      title={title}
      className={`rounded-[3px] border px-2 py-[3px] text-meta font-medium ${TONE_CLASSES[tone]} ${className}`}
    >
      {children}
    </span>
  );
}
