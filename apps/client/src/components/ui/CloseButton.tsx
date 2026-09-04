interface CloseButtonProps {
  onClick: () => void;
  className?: string;
}

// Fixes a real bug, not just a refactor: the "×" (multiplication sign)
// text glyph isn't optically centered inside a flex box at small sizes —
// glyph metrics vary by character and font, so `items-center
// justify-center` alone doesn't guarantee it looks centered the way it
// does for a vector icon. An SVG X is centered by construction instead.
// Shared across every modal's close button (ClientForm, LoanForm,
// MessageTemplateForm, MessageLogDrawer) so this is fixed once, not
// per-copy.
//
// hover:bg-border added 2026-09-04 — same fix as Button.tsx's secondary
// variant and RowActionButton: this rests on a visible bg-input box, but
// hover only lit up the text, leaving the box looking inert. bg-border is
// the same translucent white wash used everywhere else for this.
export function CloseButton({ onClick, className = '' }: CloseButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Cerrar"
      className={`flex size-6 shrink-0 items-center justify-center rounded bg-input text-muted hover:bg-border hover:text-white ${className}`}
    >
      <svg
        className="size-3"
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
      >
        <path
          d="M5 5l10 10M15 5L5 15"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    </button>
  );
}
