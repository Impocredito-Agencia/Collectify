import { useRef } from 'react';

import type { ChangeEvent } from 'react';

interface CurrencyInputProps {
  // Whole pesos, matching every other monetary value in the app
  // (formatCurrency/formatDateOnly's sibling — see lib/format.ts). 0 is
  // treated as "empty" and shows the placeholder instead of "$0".
  value: number;
  onChange: (value: number) => void;
  className: string;
  placeholder?: string;
}

// Real-time "$1.000.000"-style formatting for every manually-typed
// monetary field in the app (Monto del pago, Capital del préstamo, montos
// por cuota — "Capital" as of the 2026-09-03 terminology fix, see
// docs/GLOSSARY.md "Loan / Pagaré"). Purely client-side string formatting
// on each keystroke — no network calls, no measurable cost — so it's
// applied everywhere a peso amount is typed by hand, per the client's
// request.
//
// Approach: the input is type="text" (not type="number", which can't
// display "$" or "."), and on every change we strip everything but digits,
// parse to a number, and hand that plain number back via onChange — callers
// never see the formatted string, only the underlying value. The display
// string is derived straight from `value` using the same
// `Math.round(amount).toLocaleString('es-CO')` convention already used to
// build {{grandTotal}} in apps/api/src/whatsapp/messageRenderer.ts, with
// "$" prefixed manually (Intl's currency style inserts a space after "$"
// in es-CO — the same reason the backend bakes the "$" on rather than
// using currency style there).
//
// Cursor handling: after each keystroke the cursor is forced to the end of
// the field. Reformatting can insert/remove thousand-separator dots before
// the caret, which would otherwise make the caret drift — forcing it to
// the end keeps typing continuous digit-entry (append/backspace at the
// end), which is how these fields are actually used. Mirrors the existing
// requestAnimationFrame cursor-restore pattern in
// MessageTemplateForm.tsx's insertVariable.
export function CurrencyInput({
  value,
  onChange,
  className,
  placeholder = '$0',
}: CurrencyInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const displayValue = value > 0 ? `$${value.toLocaleString('es-CO')}` : '';

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const digitsOnly = event.target.value.replace(/\D/g, '');
    onChange(digitsOnly === '' ? 0 : parseInt(digitsOnly, 10));
    requestAnimationFrame(() => {
      const input = inputRef.current;
      if (input) {
        input.setSelectionRange(input.value.length, input.value.length);
      }
    });
  };

  return (
    <input
      ref={inputRef}
      type="text"
      inputMode="numeric"
      value={displayValue}
      onChange={handleChange}
      placeholder={placeholder}
      className={className}
    />
  );
}
