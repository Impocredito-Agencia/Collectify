import { useEffect, useRef, useState } from 'react';

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  className?: string;
  // Shown in place of a label when no option is selected — same role as
  // a native <select>'s disabled first option, or DatePicker.tsx's own
  // `placeholder` prop. Without this, an unselected required Select (e.g.
  // ClientForm's "Tipo de documento") just renders blank, which reads as
  // broken rather than empty-and-required.
  placeholder?: string;
}

// Replaces a native <select> — the browser draws a native <select>'s
// option list itself (OS chrome, not CSS-stylable to match the app's dark
// theme consistently across browsers), which is why "Todos los estados"
// looked out of place next to everything else. This rebuilds the same
// value/onChange behavior with app-styled markup instead. Shared between
// LoansListPage.tsx and MessageLogsPage.tsx's "Estado" filters (and any
// future dropdown filter — reuse this rather than another native <select>).
export function Select({
  value,
  onChange,
  options,
  className = '',
  placeholder,
}: SelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selected = options.find((option) => option.value === value);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };
    const handleClickOutside = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {/* Style cleanup (2026-09-02) — client compared this against Linear's
          own dropdowns: ours had no hover state at all on the closed
          trigger (only the open option list did, via `hover:bg-border
          hover:text-white`). Linear lights up both the box and the text on
          hover — text goes from its muted tone (#8A8F98) to the `strong`
          tone (#D0D6E0), not all the way to white. Reused `hover:bg-border`
          rather than inventing a new box color — it's the same wash this
          same component's own option list already uses for its highlight,
          so the trigger and its menu now share one hover language instead
          of the trigger having none. `group` + `group-hover` so the
          chevron icon lights up together with the label, not just the
          label alone. */}
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((current) => !current)}
        className="group flex h-[38px] w-full items-center justify-between gap-2 rounded bg-input px-3 text-small text-muted hover:bg-border hover:text-strong focus:outline-none"
      >
        <span className="truncate">{selected?.label ?? placeholder ?? ''}</span>
        <svg
          className={`size-3 shrink-0 text-muted transition-transform group-hover:text-strong ${isOpen ? 'rotate-180' : ''}`}
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
        >
          <path
            d="M5 7.5l5 5 5-5"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {isOpen && (
        <div
          role="listbox"
          // `max-h-[264px] overflow-y-auto` added (style cleanup,
          // 2026-09-02) — a long option list (e.g. the month picker's 12
          // entries) had no cap, so it could grow tall enough to push
          // AppLayout.tsx's `<main>` into needing to scroll itself,
          // surfacing the browser's unstyled default scrollbar — see
          // index.css's "Themed scrollbars" note for the full picture.
          // 264px ≈ 6.5 rows at this list's own `py-2` row height, enough
          // to show most short lists (Estado filters, etc.) with no
          // scrollbar at all, while capping the long ones. Was
          // `overflow-hidden`, which only clipped extra rows instead of
          // making them reachable — silently hid the tail of long lists.
          className="absolute left-0 top-[calc(100%+4px)] z-10 max-h-[264px] w-full min-w-max overflow-y-auto rounded border border-border bg-input shadow-lg"
        >
          {/* Option hover corrected (style cleanup, 2026-09-02) — same fix
              as FilterTab.tsx, same day: this used to jump straight from
              unselected (`text-muted`) to the same look as selected
              (`text-white`/`bg-border`) on hover, a 2-state binary instead
              of Linear's real off/hover/selected progression. Hover now
              lands on the middle tier — `strong` text, `white/[0.05]`
              box — leaving `white`/`bg-border` exclusively for the
              option that's actually selected. See FilterTab.tsx for the
              full writeup; this is the same component shape (unselected /
              hover / selected). */}
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              onClick={() => {
                onChange(option.value);
                setIsOpen(false);
              }}
              className={`block w-full px-3 py-2 text-left text-small ${
                option.value === value
                  ? 'bg-border font-medium text-white'
                  : 'text-muted hover:bg-white/[0.05] hover:text-strong'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
