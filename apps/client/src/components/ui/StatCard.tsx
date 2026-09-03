interface StatCardProps {
  label: string;
  value: string;
}

// KPI/metric card (style cleanup, 2026-09-02) — DashboardPage's stats grid
// ("Clientes con préstamos activos", "Cuotas en mora", "Monto total en
// mora"...) and ClientDetailPage's per-client stats grid ("Préstamos
// totales", "Monto prestado", "En mora"...) were two separate, byte-
// identical local `StatCard` components — same markup, same tokens, just
// copy-pasted into two files instead of shared once. One import here
// instead, so any future "cards with a label and a big number" spot in the
// app (there will be more) reuses this instead of a third copy.
export function StatCard({ label, value }: StatCardProps) {
  return (
    <div className="rounded border border-border bg-surface p-5">
      <p className="text-small text-muted">{label}</p>
      <p className="mt-1 text-kpi font-light text-white">{value}</p>
    </div>
  );
}
