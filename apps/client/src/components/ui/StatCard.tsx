interface StatCardProps {
  label: string;
  value: string;
  // Human request, 2026-09-27 — LoanDetailPage's "Total vencido hoy" needs
  // to stand out from the other, neutral figures around it (a cobrador
  // scanning the page for what to actually collect), rather than blend in
  // as one more equally-weighted number. Same danger tokens StatusBadge's
  // own 'danger' tone already uses — reusing the app's existing semantic
  // color instead of inventing a new one. Defaults to 'default', so every
  // existing call site is unaffected.
  tone?: 'default' | 'danger';
}

// KPI/metric card (style cleanup, 2026-09-02) — DashboardPage's stats grid
// ("Clientes con préstamos activos", "Cuotas en mora", "Monto total en
// mora"...) and ClientDetailPage's per-client stats grid ("Préstamos
// totales", "Monto prestado", "En mora"...) were two separate, byte-
// identical local `StatCard` components — same markup, same tokens, just
// copy-pasted into two files instead of shared once. One import here
// instead, so any future "cards with a label and a big number" spot in the
// app (there will be more) reuses this instead of a third copy.
export function StatCard({ label, value, tone = 'default' }: StatCardProps) {
  return (
    <div
      className={
        tone === 'danger'
          ? 'rounded border border-danger bg-danger-bg p-5'
          : 'rounded border border-border bg-surface p-5'
      }
    >
      {/* Style cleanup, 2026-09-04 — briefly reserved 2 lines' worth of
          height here after "Incremento consolidado en caso de mora" wrapped
          in LoanDetailPage's 6-column grid and pushed that card's value out
          of alignment. Reverted once the label itself was shortened to
          "Incremento en mora" (see GLOSSARY.md) — every label in the app
          fits on one line now, so cards stay at their natural, smaller
          height instead of reserving space no longer needed. */}
      <p
        className={`text-small ${tone === 'danger' ? 'text-danger' : 'text-muted'}`}
      >
        {label}
      </p>
      <p
        className={`mt-1 text-kpi font-light ${tone === 'danger' ? 'text-danger' : 'text-white'}`}
      >
        {value}
      </p>
    </div>
  );
}
