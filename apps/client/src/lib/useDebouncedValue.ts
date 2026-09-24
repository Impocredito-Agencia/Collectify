import { useEffect, useState } from 'react';

// Returns `value` only after it has stopped changing for `delayMs` — lets a
// search box drive a server query without firing one request per keystroke.
export function useDebouncedValue<T>(value: T, delayMs = 350): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
