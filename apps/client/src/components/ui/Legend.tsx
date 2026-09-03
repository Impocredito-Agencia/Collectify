export type LegendTone = 'success' | 'warning' | 'mora-mid' | 'danger';

// Style cleanup (2026-09-01): this exact component was defined identically
// in LoansListPage.tsx, ClientDetailPage.tsx and MessageLogsPage.tsx (used
// for the mora-severity dots and the "X Fallidos" count) — extracted once
// here instead of three copies. Took the color as a raw hex string before;
// now takes a semantic `tone` so callers can't accidentally pass a color
// that isn't one of the app's real status tokens (see index.css and
// DESIGN_TOKENS.md "Semantic color tokens").
const TONE_COLOR_VAR: Record<LegendTone, string> = {
  success: 'var(--color-success)',
  warning: 'var(--color-warning)',
  'mora-mid': 'var(--color-mora-mid)',
  danger: 'var(--color-danger)',
};

interface LegendProps {
  tone: LegendTone;
  label: string;
}

export function Legend({ tone, label }: LegendProps) {
  const color = TONE_COLOR_VAR[tone];
  return (
    <span className="flex items-center gap-1.5">
      <span
        className="size-1.5 rounded-full"
        style={{ backgroundColor: color }}
      />
      <span style={{ color }}>{label}</span>
    </span>
  );
}
