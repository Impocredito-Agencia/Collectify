// Pure helpers behind DecimalInput.tsx. The field keeps what the user typed
// as text (so "", "2.", ".5" and "03.1" are all reachable while editing) and
// derives the number from it, instead of round-tripping through a number on
// every keystroke — which is what used to turn a cleared field into a 0 the
// user then couldn't delete.

// Accepts a comma as the decimal separator (normalized to a dot). Returns
// null when the text isn't a plain non-negative decimal, so the caller can
// ignore the keystroke.
export function sanitizeDecimalText(raw: string): string | null {
  const normalized = raw.replace(',', '.');
  return /^\d*\.?\d*$/.test(normalized) ? normalized : null;
}

// '' means "nothing usable typed yet" (empty, or just a lone dot).
export function parseDecimalText(text: string): number | '' {
  if (text === '' || text === '.') {
    return '';
  }
  return Number(text);
}

// Text to show after `value` changed from outside (pre-fill, reset). Keeps
// the user's own text when it already means the same number, so typing
// "2." or "03.1" isn't rewritten under their fingers.
export function reconcileDecimalText(
  currentText: string,
  value: number | '',
): string {
  if (parseDecimalText(currentText) === value) {
    return currentText;
  }
  return value === '' ? '' : String(value);
}
