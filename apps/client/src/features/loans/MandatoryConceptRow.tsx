// Redesign, 2026-09-03 — this used to be the row for a catalog concept
// flagged "mandatory usury-rate concept". That flag is gone: the loan's
// own corriente/moratorio interest is now a system field, not a catalog
// pick — see LoansService.resolveConceptsWithInterest. This row now just
// shows that field's fixed name ("Intereses corrientes"/"Intereses
// moratorios") next to its editable value. Not a Select (nothing to pick)
// and no "Quitar" (it can't be removed) — the trailing label fills that
// space instead, so the row still lines up with the removable catalog
// rows below it. Value can be lowered from the usury ceiling but never
// raised above it ("editable solo hacia abajo", confirmed with the human)
// — see usuryCeiling.ts's exceedsUsuryCeiling for the check callers run.
export function SystemInterestRateRow({
  name,
  value,
  onChange,
  exceedsCeiling,
}: {
  name: string;
  value: number | '';
  onChange: (value: number) => void;
  exceedsCeiling?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      {/* h-[38px] to match Select's own trigger height (see Select.tsx) —
          was h-9 (36px), a couple pixels short, which misaligned this row
          against the catalog concept rows below it (style fix, 2026-09-03). */}
      <div className="flex h-[38px] flex-1 items-center rounded border border-border bg-input px-2.5 text-small text-white">
        {name}
      </div>
      <input
        type="number"
        min={0}
        // step="any" (not "0.01") — the monthly usury rate this value
        // defaults to/is capped by can legitimately carry up to 4 decimals
        // (annual→monthly conversion, ratePercentage's own DB scale). A
        // fixed step="0.01" rejected the browser's own autofilled value
        // some months, silently blocking submit before React ever saw it.
        step="any"
        value={value}
        onChange={(event) => onChange(parseFloat(event.target.value) || 0)}
        title="Autocompletado con la tasa de usura vigente — puedes bajarlo, pero no superarlo."
        placeholder="%"
        className={`h-[38px] w-24 rounded border bg-input px-2.5 text-small text-white focus:outline-none ${
          exceedsCeiling
            ? 'border-danger focus:border-danger'
            : 'border-border focus:border-subtle'
        }`}
      />
      <span className="w-[42px] shrink-0 text-center text-meta text-subtle">
        Sistema
      </span>
    </div>
  );
}
