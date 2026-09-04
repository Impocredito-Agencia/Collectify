import type { ReactNode } from 'react';

import { Button } from './Button';

interface ChipButtonProps {
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  children: ReactNode;
}

// Centralized 2026-09-04 — was a byte-identical local function copy-pasted
// into LoanForm.tsx, RefinanceLoanForm.tsx, and LoanQuotePage.tsx (plus a
// fourth inline copy in ClientForm.tsx's "+ Agregar referencia" button),
// each with its own hover className that had drifted from the shared
// Button component's "secondary" variant (border-only hover, no bg wash —
// same "box doesn't light up" bug reported and fixed there). Built on top
// of Button now instead of re-declaring the look a fifth time, so this and
// every other secondary-style button share one definition and one hover
// fix going forward — "todos los botones en la misma bolsa."
export function ChipButton({
  onClick,
  disabled,
  title,
  children,
}: ChipButtonProps) {
  return (
    <Button
      variant="secondary"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="flex items-center gap-1.5 self-start"
    >
      {children}
    </Button>
  );
}
