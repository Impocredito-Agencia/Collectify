import { useEffect, useLayoutEffect, useRef, useState } from 'react';

interface MonthPickerProps {
  // '' or 'YYYY-MM' — matches the native <input type="month"> value shape
  // this replaces (UsuryRatesPage.tsx's effectiveMonth), so it's a drop-in
  // replacement.
  value: string;
  onChange: (value: string) => void;
  className: string;
  ariaLabel?: string;
  placeholder?: string;
}

// Bug fix, 2026-09-03 (client screenshot) — UsuryRatesPage.tsx's "Mes
// certificado" field was a bare native <input type="month">, the one date
// field in the app DatePicker.tsx's sweep (task list item "Build custom
// DatePicker, replace native date inputs app-wide") never reached, since
// DatePicker itself is day-granular and has no month-only mode. Same
// underlying problem the client flagged then: clicking it highlights/
// selects the text instead of giving any hover feedback, the browser's own
// tiny calendar-icon glyph doesn't pick up the app's colors, and the
// dropdown that opens is the OS/browser's own generic date picker — can't
// be restyled to match the app's dark theme at all.
//
// Deliberately its own component rather than extending DatePicker with a
// "month-only" prop: DatePicker's whole structure is built around a day
// grid with month/year as stepping-stones back to it; a month-only field
// has no day grid at all, so bolting that mode on would mean threading a
// flag through every view instead of just not rendering the one that
// doesn't apply here. Mirrors DatePicker's visual language and positioning
// logic (trigger button, outside-click/Escape handling, edge-aware
// left/right flip) so it reads as the same design system, just with
// 'months' as the top-level view instead of a stepping-stone to 'days'.
const MONTH_LABELS = [
  'Ene',
  'Feb',
  'Mar',
  'Abr',
  'May',
  'Jun',
  'Jul',
  'Ago',
  'Sep',
  'Oct',
  'Nov',
  'Dic',
];

const POPOVER_WIDTH_PX = 260;
const YEARS_PER_PAGE = 12;

function parseMonthString(
  value: string,
): { year: number; month: number } | null {
  if (!value) {
    return null;
  }
  const [year, month] = value.split('-').map(Number);
  return { year, month: month - 1 };
}

function toMonthString(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}`;
}

function formatMonthYear(year: number, month: number): string {
  const label = new Date(Date.UTC(year, month, 1)).toLocaleDateString('es-CO', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function MonthPicker({
  value,
  onChange,
  className,
  ariaLabel,
  placeholder = 'mes de aaaa',
}: MonthPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [view, setView] = useState<'months' | 'years'>('months');
  const [yearsPageStart, setYearsPageStart] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const [align, setAlign] = useState<'left' | 'right'>('left');

  const parsedValue = parseMonthString(value);
  const today = new Date();
  const [viewYear, setViewYear] = useState(
    parsedValue?.year ?? today.getFullYear(),
  );

  // Same "jump back to the selected value on open" behavior as DatePicker —
  // a fresh `now` computed inside the effect (not the outer `today`), so
  // exhaustive-deps is satisfied with just [isOpen, value] and this never
  // uses a `today` captured at some earlier render.
  useEffect(() => {
    if (isOpen) {
      const parsed = parseMonthString(value);
      const now = new Date();
      setViewYear(parsed?.year ?? now.getFullYear());
      setView('months');
    }
  }, [isOpen, value]);

  useLayoutEffect(() => {
    if (!isOpen || !containerRef.current) {
      return;
    }
    const rect = containerRef.current.getBoundingClientRect();
    const fitsOnLeft = rect.left + POPOVER_WIDTH_PX <= window.innerWidth;
    const fitsOnRight = rect.right - POPOVER_WIDTH_PX >= 0;
    setAlign(!fitsOnLeft && fitsOnRight ? 'right' : 'left');
  }, [isOpen]);

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

  const goToPreviousYear = () => setViewYear((current) => current - 1);
  const goToNextYear = () => setViewYear((current) => current + 1);
  const goToPreviousYearsPage = () =>
    setYearsPageStart((current) => current - YEARS_PER_PAGE);
  const goToNextYearsPage = () =>
    setYearsPageStart((current) => current + YEARS_PER_PAGE);

  const panelPositionClassName =
    align === 'left'
      ? 'left-0 top-[calc(100%+4px)]'
      : 'right-0 top-[calc(100%+4px)]';

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((current) => !current)}
        className={`group flex items-center justify-between gap-2 text-left hover:bg-border focus:outline-none ${className}`}
      >
        <span className={value ? '' : 'text-mid'}>
          {parsedValue
            ? formatMonthYear(parsedValue.year, parsedValue.month)
            : placeholder}
        </span>
        <svg
          className="size-3.5 shrink-0 text-mid transition-colors group-hover:text-strong"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
        >
          <rect x="3" y="4" width="14" height="13" rx="1.5" strokeWidth="1.5" />
          <path d="M3 8h14" strokeWidth="1.5" />
          <path d="M7 2.5v3M13 2.5v3" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>

      {isOpen && view === 'months' && (
        <div
          className={`absolute z-10 w-[260px] rounded border border-border bg-input p-3 shadow-lg ${panelPositionClassName}`}
        >
          <div className="flex items-center justify-between">
            <button
              type="button"
              aria-label="Año anterior"
              onClick={goToPreviousYear}
              className="flex size-6 items-center justify-center rounded text-muted hover:text-white"
            >
              ‹
            </button>
            <button
              type="button"
              onClick={() => {
                setYearsPageStart(viewYear - (viewYear % YEARS_PER_PAGE));
                setView('years');
              }}
              className="rounded px-2 py-0.5 text-small font-medium text-white hover:bg-border"
            >
              {viewYear}
            </button>
            <button
              type="button"
              aria-label="Año siguiente"
              onClick={goToNextYear}
              className="flex size-6 items-center justify-center rounded text-muted hover:text-white"
            >
              ›
            </button>
          </div>

          <div className="mt-2.5 grid grid-cols-3 gap-1.5">
            {MONTH_LABELS.map((label, index) => {
              const isSelected =
                parsedValue?.year === viewYear && parsedValue.month === index;
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => {
                    onChange(toMonthString(viewYear, index));
                    setIsOpen(false);
                  }}
                  className={`rounded py-1.5 text-small ${
                    isSelected
                      ? 'bg-white font-semibold text-background'
                      : 'text-white hover:bg-border'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {isOpen && view === 'years' && (
        <div
          className={`absolute z-10 w-[260px] rounded border border-border bg-input p-3 shadow-lg ${panelPositionClassName}`}
        >
          <div className="flex items-center justify-between">
            <button
              type="button"
              aria-label="Años anteriores"
              onClick={goToPreviousYearsPage}
              className="flex size-6 items-center justify-center rounded text-muted hover:text-white"
            >
              ‹
            </button>
            <span className="text-small font-medium text-white">
              {yearsPageStart} – {yearsPageStart + YEARS_PER_PAGE - 1}
            </span>
            <button
              type="button"
              aria-label="Años siguientes"
              onClick={goToNextYearsPage}
              className="flex size-6 items-center justify-center rounded text-muted hover:text-white"
            >
              ›
            </button>
          </div>

          <div className="mt-2.5 grid grid-cols-3 gap-1.5">
            {Array.from({ length: YEARS_PER_PAGE }, (_, index) => {
              const year = yearsPageStart + index;
              return (
                <button
                  key={year}
                  type="button"
                  onClick={() => {
                    setViewYear(year);
                    setView('months');
                  }}
                  className={`rounded py-1.5 text-small ${
                    year === viewYear
                      ? 'bg-white font-semibold text-background'
                      : 'text-white hover:bg-border'
                  }`}
                >
                  {year}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
