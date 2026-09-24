import { useEffect, useState } from 'react';

import {
  parseDecimalText,
  reconcileDecimalText,
  sanitizeDecimalText,
} from '@/lib/decimalText';

import type { ChangeEvent } from 'react';

interface DecimalInputProps {
  // '' = the field is empty. Callers decide what an empty value means
  // (usually a validation error on submit), the input never forces a 0.
  value: number | '';
  onChange: (value: number | '') => void;
  className: string;
  placeholder?: string;
  title?: string;
  ariaLabel?: string;
  disabled?: boolean;
}

// A percentage/amount field that edits like a normal text box: it can be
// cleared and retyped, and a comma works as the decimal separator. type=
// "text" + inputMode="decimal" instead of type="number" for the same
// reasons CurrencyInput.tsx and UsuryRatesPage.tsx avoid it (a native
// number input drops a lone "," and can't stay empty-but-focused cleanly).
export function DecimalInput({
  value,
  onChange,
  className,
  placeholder,
  title,
  ariaLabel,
  disabled,
}: DecimalInputProps) {
  const [text, setText] = useState(() => (value === '' ? '' : String(value)));

  useEffect(() => {
    setText((current) => reconcileDecimalText(current, value));
  }, [value]);

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const next = sanitizeDecimalText(event.target.value);
    if (next === null) {
      return;
    }
    setText(next);
    onChange(parseDecimalText(next));
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      value={text}
      onChange={handleChange}
      placeholder={placeholder}
      title={title}
      aria-label={ariaLabel}
      disabled={disabled}
      className={className}
    />
  );
}
