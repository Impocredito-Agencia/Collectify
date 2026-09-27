import { useSessionState } from '@/lib/useSessionState';

export type SortDirection = 'asc' | 'desc';

// Shared column-sort state for a list page's table (human report,
// 2026-09-22 — Clientes/Préstamos: "que se pueda filtrar por columna...
// que se organice según esa columna de menor a mayor y si la vuelve a
// tocar de mayor a menor"). Only holds WHICH column and direction — the
// page passes them to the list query as sortBy/sortDirection so the
// server orders the whole result before paginating (2026-09-25: it used
// to reorder just the loaded page client-side, so Z→A still started with
// an "E"). Generic over `T`, the column-key union each page defines for
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
