interface StatCardProps {
  label: string;
  value: string;
  // Human request, 2026-09-27 — LoanDetailPage's "Total vencido hoy" needs
  // to stand out from the other, neutral figures around it (a cobrador
  // scanning the page for what to actually collect). First tried tinting
  // the whole card (border+background+label+value) — human feedback:
  // "muy llamativa", deja nomas el número en rojo, de resto los mismos
  // colores que las demás — so 'danger' only tints the value now; the
  // card's border/background/label stay identical to 'default'. Defaults
  // to 'default', so every existing call site is unaffected.
  //
  // 'accent' (client request, 2026-10-23) — the one figure that matters
  // most in a group, in the same soft brand-orange box PayoffDialog's
  // "Total a pagar hoy" uses (border-accent/30 bg-accent/5).
  tone?: 'default' | 'danger' | 'accent';
}

const VALUE_TONE_CLASSES: Record<NonNullable<StatCardProps['tone']>, string> = {
  default: 'text-white',
  danger: 'text-danger',
  accent: 'text-accent',
};

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
      className={`rounded border p-5 ${tone === 'accent' ? 'border-accent/30 bg-accent/5' : 'border-border bg-surface'}`}
    >
      {/* Style cleanup, 2026-09-04 — briefly reserved 2 lines' worth of
          height here after "Incremento consolidado en caso de mora" wrapped
          in LoanDetailPage's 6-column grid and pushed that card's value out
          of alignment. Reverted once the label itself was shortened to
          "Incremento en mora" (see GLOSSARY.md) — every label in the app
          fits on one line now, so cards stay at their natural, smaller
          height instead of reserving space no longer needed. */}
      <p className="text-small text-muted">{label}</p>
      <p className={`mt-1 text-kpi font-light ${VALUE_TONE_CLASSES[tone]}`}>
        {value}
      </p>
    </div>
  );
}
