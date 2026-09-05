import { buildPageWindow } from '@/components/ui/buildPageWindow';
import { FilterTab } from '@/components/ui/FilterTab';

interface PagerProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

// Extracted (2026-09-05) from ClientsListPage.tsx, where this started as a
// local buildPageWindow() + inline ←/window/→ JSX. LoansListPage,
// MessageLogsPage, AuditLogsPage and DashboardPage each had their own copy
// of the OLD, un-truncated version (one FilterTab per page, no window) —
// the client asked to bring all of them up to the same 50/page + 5-window
// treatment Clientes already had, so this is now the one shared
// implementation instead of a 5th near-identical copy.
//
// Sliding window of up to 5 CONSECUTIVE page numbers centered on the
// current page, clamped to [1, total] — no pinned first/last, no "…". This
// exact design was chosen over two rejected alternatives (pinned
// first/last with double "…", client: "eso no se ve mal?") — see the
// original comment history on ClientsListPage.tsx for the full mockup
// comparison. buildPageWindow() itself moved to its own file 2026-09-05 —
// having it here alongside the Pager component tripped ESLint's
// react-refresh/only-export-components warning.
export function Pager({ page, totalPages, onPageChange }: PagerProps) {
  return (
    <div className="flex items-center gap-1">
      <FilterTab
        label="←"
        isActive={false}
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
      />
      {buildPageWindow(page, totalPages).map((entry) => (
        <FilterTab
          key={entry}
          label={entry}
          isActive={entry === page}
          onClick={() => onPageChange(entry)}
        />
      ))}
      <FilterTab
        label="→"
        isActive={false}
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
      />
    </div>
  );
}
