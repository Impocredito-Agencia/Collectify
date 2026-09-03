// Bug fix, 2026-09-03 — the mandatory, non-removable usury-rate concept's
// row, shared by LoanForm.tsx and RefinanceLoanForm.tsx (both render it
// above the removable concepts in "Cargos adicionales"/"Cargos
// moratorios"). Not a Select (nothing to pick, it's fixed) and no
// "Quitar" — the trailing label fills that space instead, so the row
// still lines up with the removable ones below it.
export function MandatoryConceptRow({
  name,
  ratePercentage,
}: {
  name: string;
  ratePercentage: number | undefined;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex h-9 flex-1 items-center rounded border border-border bg-input px-2.5 text-small text-white">
        {name}
      </div>
      <input
        type="number"
        disabled
        value={ratePercentage ?? ''}
        title="Cargo obligatorio de tasa de usura — no se puede quitar."
        placeholder="%"
        className="h-9 w-24 rounded border border-border bg-input px-2.5 text-small text-white disabled:cursor-not-allowed disabled:opacity-60"
      />
      <span className="w-[42px] shrink-0 text-center text-meta text-subtle">
        Fijo
      </span>
    </div>
  );
}
