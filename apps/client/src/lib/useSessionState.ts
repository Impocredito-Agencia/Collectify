import { useEffect, useState } from 'react';

import type { Dispatch, SetStateAction } from 'react';

// Every key this hook writes is namespaced under this prefix, so logout
// can wipe them all (see clearSessionState) without knowing each page's
// own keys.
const KEY_PREFIX = 'collectify.sessionState.';

// Human report, 2026-09-23 — "cuando están buscando en el panel de
// clientes a alguien o en el panel de préstamos, si entran algún pagaré o
// cliente y regresan se tienen que volver a buscar". A drop-in useState
// that survives the list page unmounting: opening a detail page and
// coming back (via "← Volver", the browser's back button, or the sidebar)
// restores the same search/filter/page/sort. sessionStorage, not the URL
// or localStorage — scoped to this tab and gone once it closes, so a
// forgotten filter never follows the user into tomorrow's session.
//
// `key: null` opts out entirely (plain useState), so a shared hook like
// useSortableColumn can make persistence optional without calling hooks
// conditionally. Storage access is wrapped — private mode or a full quota
// just falls back to in-memory state, never breaks the page.
export function useSessionState<T>(
  key: string | null,
  initialValue: T,
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() =>
    key === null ? initialValue : readSessionValue(key, initialValue),
  );

  useEffect(() => {
    if (key === null) return;
    try {
      sessionStorage.setItem(KEY_PREFIX + key, JSON.stringify(value));
    } catch {
      // Storage unavailable — the in-memory state above still works.
    }
  }, [key, value]);

  return [value, setValue];
}

function readSessionValue<T>(key: string, fallback: T): T {
  try {
    const stored = sessionStorage.getItem(KEY_PREFIX + key);
    return stored === null ? fallback : (JSON.parse(stored) as T);
  } catch {
    return fallback;
  }
}

// Called on logout — another user signing in on the same tab must not
// inherit the previous user's searches.
export function clearSessionState(): void {
  try {
    for (const storageKey of Object.keys(sessionStorage)) {
      if (storageKey.startsWith(KEY_PREFIX)) {
        sessionStorage.removeItem(storageKey);
      }
    }
  } catch {
    // Storage unavailable — nothing was persisted to clear.
  }
}
