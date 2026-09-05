// Extracted from Pager.tsx (2026-09-05) — a pure function living in the
// same file as the Pager component tripped
// react-refresh/only-export-components (Fast Refresh only works when a
// file exports components exclusively). Splitting the plain function out
// into its own file is the fix; see Pager.tsx for the full history of
// where this window logic came from and why this exact windowing design
// (5-wide, centered, clamped, no pinned first/last) was chosen.
export function buildPageWindow(current: number, total: number): number[] {
  const windowSize = Math.min(5, total);
  let start = current - Math.floor(windowSize / 2);
  start = Math.max(1, Math.min(start, total - windowSize + 1));
  return Array.from({ length: windowSize }, (_, i) => start + i);
}
