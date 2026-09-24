import { useSessionState } from '@/lib/useSessionState';

export type SortDirection = 'asc' | 'desc';

// Shared column-sort state for a list page's table (human report,
// 2026-09-22 — Clientes/Préstamos: "que se pueda filtrar por columna...
// que se organice según esa columna de menor a mayor y si la vuelve a
// tocar de mayor a menor"). Sorts client-side over whatever page of rows
// is currently loaded — the list's own server-side pagination/search/
// status filters are untouched by this, it only reorders what's already
// on screen. Generic over `T`, the column-key union each page defines for
// its own table (see ClientsListPage.tsx/LoansListPage.tsx call sites).
//
// storageKey (human report, 2026-09-23) — when set, the sort survives
// leaving the page and coming back, same as that page's search/filters;
// see useSessionState.
export function useSortableColumn<T extends string>(storageKey?: string) {
  const [column, setColumn] = useSessionState<T | null>(
    storageKey ? `${storageKey}.column` : null,
    null,
  );
  const [direction, setDirection] = useSessionState<SortDirection>(
    storageKey ? `${storageKey}.direction` : null,
    'asc',
  );

  // Clicking the already-active column flips asc ↔ desc; clicking a
  // different column starts it fresh at asc — same behavior as every
  // other sortable table convention (spreadsheets, admin panels).
  const toggle = (next: T) => {
    if (column === next) {
      setDirection((current) => (current === 'asc' ? 'desc' : 'asc'));
    } else {
      setColumn(next);
      setDirection('asc');
    }
  };

  // What Th's own `sortDirection` prop expects for a given column: this
  // column's current direction if it's the one sorted, null otherwise (Th
  // renders that as a dim, unobtrusive "sortable but not active" hint).
  const directionFor = (candidate: T): SortDirection | null =>
    column === candidate ? direction : null;

  return { column, direction, toggle, directionFor };
}
