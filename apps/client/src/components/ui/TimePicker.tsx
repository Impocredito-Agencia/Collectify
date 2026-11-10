import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import {
  formatTimeOfDay,
  minuteOptions,
  pad2,
  toHour12,
  toHour24,
} from '@/lib/timeOfDay';

import type { DayPeriod } from '@/lib/timeOfDay';
import type { ReactNode } from 'react';

interface TimePickerProps {
  // 0–23 / 0–59, the values the cron schedules store.
  hour: number;
  minute: number;
  onChange: (hour: number, minute: number) => void;
  // Full className for the trigger, like DatePicker — each call site sizes
  // its own field.
  className: string;
  ariaLabel?: string;
  // Minutes offered in the list (an off-grid saved value is still shown).
  minuteStep?: number;
}

const POPOVER_WIDTH_PX = 220;
const HOURS = Array.from({ length: 12 }, (_, index) => index + 1);
const PERIODS: { value: DayPeriod; label: string }[] = [
  { value: 'am', label: 'a. m.' },
  { value: 'pm', label: 'p. m.' },
];

function optionClassName(isSelected: boolean): string {
  return `flex h-7 w-full shrink-0 items-center justify-center rounded text-small ${
    isSelected
      ? 'bg-white font-semibold text-background'
      : 'text-white hover:bg-border'
  }`;
}

// Custom time picker replacing native <input type="time"> — same reasoning
// as DatePicker/Select: the browser draws its own popup (and a clock icon
// that barely showed on the dark theme), which can't be styled to match the
// app (human request, 2026-11-09). Hour / minute / a. m.–p. m. columns, in
// the same look as DatePicker's calendar. Used by CronScheduleForm, i.e.
// every automatic-send schedule (WhatsApp and Correo y SMS).
export function TimePicker({
  hour,
  minute,
  onChange,
  className,
  ariaLabel,
  minuteStep = 5,
}: TimePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [align, setAlign] = useState<'left' | 'right'>('left');
  const containerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const { hour: hour12, period } = toHour12(hour);

  // Same edge detection as DatePicker: hang from the right edge only when
  // the left-aligned panel would run off-screen.
  useLayoutEffect(() => {
    if (!isOpen || !containerRef.current) {
      return;
    }
    const rect = containerRef.current.getBoundingClientRect();
    const fitsOnLeft = rect.left + POPOVER_WIDTH_PX <= window.innerWidth;
    const fitsOnRight = rect.right - POPOVER_WIDTH_PX >= 0;
    setAlign(!fitsOnLeft && fitsOnRight ? 'right' : 'left');
    // Center the selected hour and minute in their own columns — moving
    // only the column's scroll, never the page (scrollIntoView would).
    panelRef.current
      ?.querySelectorAll<HTMLElement>('[aria-selected="true"]')
      .forEach((option) => {
        const column = option.parentElement;
        if (column) {
          column.scrollTop =
            option.offsetTop -
            column.offsetTop -
            (column.clientHeight - option.offsetHeight) / 2;
        }
      });
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

  const setHour12 = (nextHour: number) =>
    onChange(toHour24({ hour: nextHour, period }), minute);
  const setPeriod = (nextPeriod: DayPeriod) =>
    onChange(toHour24({ hour: hour12, period: nextPeriod }), minute);

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
        <span>{formatTimeOfDay(hour, minute)}</span>
        {/* text-strong, not DatePicker's dimmer text-mid: the old native
            clock icon was nearly invisible on this background. */}
        <svg
          className="size-4 shrink-0 text-strong transition-colors group-hover:text-white"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          aria-hidden="true"
        >
          <circle cx="10" cy="10" r="7.25" strokeWidth="1.5" />
          <path
            d="M10 6v4.25l2.75 1.75"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {isOpen && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label={ariaLabel ?? 'Elegir hora'}
          className={`absolute z-10 w-[220px] rounded border border-border bg-input p-3 shadow-lg ${
            align === 'left' ? 'left-0' : 'right-0'
          } top-[calc(100%+4px)]`}
        >
          <div className="grid grid-cols-3 gap-2">
            <TimeColumn label="Hora">
              {HOURS.map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-selected={option === hour12}
                  onClick={() => setHour12(option)}
                  className={optionClassName(option === hour12)}
                >
                  {pad2(option)}
                </button>
              ))}
            </TimeColumn>
            <TimeColumn label="Min">
              {minuteOptions(minuteStep, minute).map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-selected={option === minute}
                  onClick={() => onChange(hour, option)}
                  className={optionClassName(option === minute)}
                >
                  {pad2(option)}
                </button>
              ))}
            </TimeColumn>
            <TimeColumn label="">
              {PERIODS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-selected={option.value === period}
                  onClick={() => setPeriod(option.value)}
                  className={optionClassName(option.value === period)}
                >
                  {option.label}
                </button>
              ))}
            </TimeColumn>
          </div>
          <button
            type="button"
            onClick={() => setIsOpen(false)}
            className="mt-2.5 w-full rounded border border-border bg-surface py-1.5 text-label text-muted hover:bg-border hover:text-white"
          >
            Listo
          </button>
        </div>
      )}
    </div>
  );
}

function TimeColumn({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="flex h-5 items-center justify-center text-label text-mid">
        {label}
      </span>
      <div
        role="listbox"
        aria-label={label || 'a. m. / p. m.'}
        className="flex max-h-[168px] flex-col gap-0.5 overflow-y-auto pr-0.5"
      >
        {children}
      </div>
    </div>
  );
}
