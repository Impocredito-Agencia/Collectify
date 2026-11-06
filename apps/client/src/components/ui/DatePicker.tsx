import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { formatDateOnly } from '@/lib/format';

interface DatePickerProps {
  // '' or 'YYYY-MM-DD', same value shape a native <input type="date"> used
  // — every call site already stores/sends dates in this format (see
  // dueDateMath.ts, formatDateOnly), so this is a drop-in replacement.
  value: string;
  onChange: (value: string) => void;
  // Full className for the trigger button, same as how each call site
  // already built its own className for the native input it's replacing —
  // filters (MessageLogsPage) and form fields (LoanForm,
  // RegisterPaymentDialog) use different heights/borders/colors, so this
  // component doesn't hardcode any of that itself.
  className: string;
  ariaLabel?: string;
  placeholder?: string;
  // Optional 'YYYY-MM-DD' bounds — days outside them are shown but can't be
  // picked (e.g. a payment date can't be in the future, nor before the
  // pagaré's disbursement).
  min?: string;
  max?: string;
}

interface CalendarCell {
  year: number;
  month: number;
  day: number;
  dateString: string;
  inCurrentMonth: boolean;
}

const WEEKDAY_LABELS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

// Matches the `w-[260px]` on every popover panel below — kept as a
// constant so the edge-detection math and the panel width can't drift
// apart from each other.
const POPOVER_WIDTH_PX = 260;

// How many years to show per page of the year grid (matches the 3x4
// month grid's cell count, for a consistent popover height across views).
const YEARS_PER_PAGE = 12;

// Short month labels for the month-grid view below — es-CO 'MMM' via
// toLocaleDateString would work too, but a fixed array avoids 12 Date
// allocations on every render and guarantees consistent casing.
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

function toDateString(year: number, month: number, day: number): string {
  return new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
}

function parseDateString(
  value: string,
): { year: number; month: number; day: number } | null {
  if (!value) {
    return null;
  }
  const [year, month, day] = value.split('-').map(Number);
  return { year, month: month - 1, day };
}

// Always 42 cells (6 full weeks), Monday-first — the simplest way to get a
// visually stable grid height across months without special-casing 4/5/6
// week months. Built entirely with Date.UTC arithmetic (same approach as
// dueDateMath.ts) so month/year rollovers and leap years are handled by
// the JS Date engine itself, not hand-rolled clamping logic.
function buildCalendarGrid(year: number, month: number): CalendarCell[] {
  const firstWeekday = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const mondayFirstOffset = (firstWeekday + 6) % 7;

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(Date.UTC(year, month, 1 - mondayFirstOffset + index));
    const cellYear = date.getUTCFullYear();
    const cellMonth = date.getUTCMonth();
    const cellDay = date.getUTCDate();
    return {
      year: cellYear,
      month: cellMonth,
      day: cellDay,
      dateString: toDateString(cellYear, cellMonth, cellDay),
      inCurrentMonth: cellMonth === month && cellYear === year,
    };
  });
}

function formatMonthYear(year: number, month: number): string {
  const label = new Date(Date.UTC(year, month, 1)).toLocaleDateString('es-CO', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

// Custom calendar replacing native <input type="date"> — same reasoning as
// components/ui/Select.tsx: the browser draws its own date picker popup
// (calendar grid, month navigation), which can't be restyled to match the
// app's dark theme. Shared across every date field in the app: Mensajes'
// Desde/Hasta filters, RegisterPaymentDialog's "Fecha de pago", and
// LoanForm's "Fecha de la primera cuota".
export function DatePicker({
  value,
  onChange,
  className,
  ariaLabel,
  placeholder = 'dd/mm/aaaa',
  min,
  max,
}: DatePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  // 'days' is the normal grid; 'months' is reached by clicking the
  // "agosto de 2026"-style header — lets the admin jump the year/month
  // directly instead of clicking the ‹ › arrows one month at a time,
  // which is painful for e.g. a client's fecha de nacimiento decades back.
  // 'years' is reached from 'months' by clicking the year itself, for
  // jumping further than the ‹ › (one-year-at-a-time) arrows allow.
  const [view, setView] = useState<'days' | 'months' | 'years'>('days');
  // First year shown in the 'years' grid — a 12-year page, re-centered on
  // viewYear each time the grid is opened (see the button below), then
  // paged independently via its own ‹ › arrows.
  const [yearsPageStart, setYearsPageStart] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  // Which edge of the trigger button the popover hangs from. Defaults to
  // 'left' (matches a native date input), but flips to 'right' when the
  // panel wouldn't fit within the viewport otherwise — e.g. "Fecha de
  // expedición" sitting at the right edge of the client form, where a
  // fixed left-aligned panel used to run off-screen.
  const [align, setAlign] = useState<'left' | 'right'>('left');

  const parsedValue = parseDateString(value);
  const today = new Date();
  const [viewYear, setViewYear] = useState(
    parsedValue?.year ?? today.getFullYear(),
  );
  const [viewMonth, setViewMonth] = useState(
    parsedValue?.month ?? today.getMonth(),
  );

  // Jump the visible month back to the selected value whenever the picker
  // is (re)opened, rather than remembering wherever it was last navigated
  // to — matches how a native date input always opens on the selected date.
  useEffect(() => {
    if (isOpen) {
      const parsed = parseDateString(value);
      const now = new Date();
      setViewYear(parsed?.year ?? now.getFullYear());
      setViewMonth(parsed?.month ?? now.getMonth());
      setView('days');
    }
  }, [isOpen, value]);

  // Measures the trigger button's position against the viewport every
  // time the popover opens (and stays correct across the modal's own
  // scrolling/resizing, since it's a real DOM measurement rather than a
  // one-off guess). Runs before paint (useLayoutEffect) so the panel
  // never flashes at the wrong alignment first.
  useLayoutEffect(() => {
    if (!isOpen || !containerRef.current) {
      return;
    }
    const rect = containerRef.current.getBoundingClientRect();
    const fitsOnLeft = rect.left + POPOVER_WIDTH_PX <= window.innerWidth;
    const fitsOnRight = rect.right - POPOVER_WIDTH_PX >= 0;
    // Prefer left-aligned (the default); only flip to right-aligned when
    // left-aligned would actually overflow the viewport and right-aligned
    // wouldn't. If neither fits, fall back to left rather than guessing.
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

  const goToPreviousMonth = () => {
    const totalMonths = viewYear * 12 + viewMonth - 1;
    setViewYear(Math.floor(totalMonths / 12));
    setViewMonth(((totalMonths % 12) + 12) % 12);
  };

  const goToNextMonth = () => {
    const totalMonths = viewYear * 12 + viewMonth + 1;
    setViewYear(Math.floor(totalMonths / 12));
    setViewMonth(((totalMonths % 12) + 12) % 12);
  };

  const goToPreviousYear = () => setViewYear((current) => current - 1);
  const goToNextYear = () => setViewYear((current) => current + 1);

  const goToPreviousYearsPage = () =>
    setYearsPageStart((current) => current - YEARS_PER_PAGE);
  const goToNextYearsPage = () =>
    setYearsPageStart((current) => current + YEARS_PER_PAGE);

  const todayDateString = toDateString(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );
  const cells = buildCalendarGrid(viewYear, viewMonth);
  // Shared by every popover panel below so 'days', 'months', and 'years'
  // always agree on which side they hang from — see the useLayoutEffect
  // above for how `align` itself is decided.
  const panelPositionClassName =
    align === 'left'
      ? 'left-0 top-[calc(100%+4px)]'
      : 'right-0 top-[calc(100%+4px)]';

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger hover added (style cleanup, 2026-09-02), then corrected
          same day — same gap as Select.tsx's closed trigger before its
          own fix: this button opens a popover, same as Select does, but
          had no hover state at all. First attempt copied Select's
          `hover:bg-border hover:text-strong` verbatim, but Select's own
          resting text is `text-muted` (dimmer than `text-strong`), while
          every DatePicker call site's `className` sets `text-white` for
          the filled-in value (`inputClassName`/`formStyles.ts`) —
          `text-strong` (#D0D6E0) is dimmer than white, so on hover the
          date text visibly *darkened*, the opposite of the intended
          effect. Client caught this. Dropped `hover:text-strong` from
          the button itself; kept `hover:bg-border` for the box. The icon
          keeps its own `group-hover:text-strong` — its resting color is
          always the dimmer `text-mid` regardless of call site, so
          brightening it on hover is correct everywhere, unlike the value
          text whose resting color isn't ours to assume. */}
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((current) => !current)}
        className={`group flex items-center justify-between gap-2 text-left hover:bg-border focus:outline-none ${className}`}
      >
        <span className={value ? '' : 'text-mid'}>
          {value ? formatDateOnly(value) : placeholder}
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

      {isOpen && view === 'days' && (
        <div
          className={`absolute z-10 w-[260px] rounded border border-border bg-input p-3 shadow-lg ${panelPositionClassName}`}
        >
          <div className="flex items-center justify-between">
            <button
              type="button"
              aria-label="Mes anterior"
              onClick={goToPreviousMonth}
              className="flex size-6 items-center justify-center rounded text-muted hover:text-white"
            >
              ‹
            </button>
            {/* Jumps to the month/year grid below — the ‹ › arrows above
                only step one month at a time, which is impractical for
                dates decades away (e.g. fecha de nacimiento). */}
            <button
              type="button"
              onClick={() => setView('months')}
              className="rounded px-2 py-0.5 text-small font-medium text-white hover:bg-border"
            >
              {formatMonthYear(viewYear, viewMonth)}
            </button>
            <button
              type="button"
              aria-label="Mes siguiente"
              onClick={goToNextMonth}
              className="flex size-6 items-center justify-center rounded text-muted hover:text-white"
            >
              ›
            </button>
          </div>

          <div className="mt-2.5 grid grid-cols-7 gap-y-1">
            {WEEKDAY_LABELS.map((label) => (
              <span
                key={label}
                className="flex h-6 items-center justify-center text-meta text-mid"
              >
                {label}
              </span>
            ))}
            {cells.map((cell) => {
              const isSelected = cell.dateString === value;
              const isToday = cell.dateString === todayDateString;
              const isOutOfRange =
                (max !== undefined && cell.dateString > max) ||
                (min !== undefined && cell.dateString < min);
              return (
                <button
                  key={cell.dateString}
                  type="button"
                  disabled={isOutOfRange}
                  onClick={() => {
                    onChange(cell.dateString);
                    setIsOpen(false);
                  }}
                  className={`flex size-7 items-center justify-center rounded text-small ${
                    isSelected
                      ? 'bg-white font-semibold text-background'
                      : isOutOfRange
                        ? 'cursor-not-allowed text-mid opacity-40'
                        : cell.inCurrentMonth
                          ? `text-white hover:bg-border ${isToday ? 'border border-subtle' : ''}`
                          : 'text-mid hover:bg-border'
                  }`}
                >
                  {cell.day}
                </button>
              );
            })}
          </div>

          {value && (
            <button
              type="button"
              onClick={() => {
                onChange('');
                setIsOpen(false);
              }}
              className="mt-2.5 w-full rounded border border-border bg-surface py-1.5 text-meta text-muted hover:bg-border hover:text-white"
            >
              Limpiar
            </button>
          )}
        </div>
      )}

      {/* Month/year picker — reached via the header button above. The
          ‹ › arrows step a year at a time; clicking the year itself opens
          the year grid below for jumping further in one step. Picking a
          month jumps straight back to the day grid for that year+month. */}
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
            {MONTH_LABELS.map((label, index) => (
              <button
                key={label}
                type="button"
                onClick={() => {
                  setViewMonth(index);
                  setView('days');
                }}
                className={`rounded py-1.5 text-small ${
                  index === viewMonth
                    ? 'bg-white font-semibold text-background'
                    : 'text-white hover:bg-border'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Year picker — reached by clicking the year in the month grid
          above. Pages 12 years at a time via its own ‹ › arrows; picking
          a year returns to the month grid for that year, same as how
          picking a month returns to the day grid. */}
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
