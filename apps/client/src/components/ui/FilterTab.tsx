interface FilterTabProps {
  label: string;
  isActive: boolean;
  onClick: () => void;
}

// Filter/segment tab (style cleanup, 2026-09-02) — was two byte-identical
// local copies (ClientsListPage's "Todos/Activos/Inactivos",
// UsersListPage's same pattern). Also fixes a real value gap found by
// inspecting Linear's own filter tab ("Popular"/"Recent") directly:
// devtools showed its resting-state background as `#FFFFFF08` — a barely-
// there ~3% white wash — not a flat solid fill. Ours used `bg-input`
// (#16171a), a flat opaque gray, which reads heavier/darker than Linear's
// version at the same spot. `bg-white/[0.03]` matches the inspected value;
// the active tab already used `bg-border` (rgba(255,255,255,0.08)), the
// same "translucent white over whatever's underneath" idea, just a
// stronger wash for the selected state.
//
// Hover added later (style cleanup, 2026-09-02) — client compared these
// against the row-action buttons/Select dropdown fixed earlier: this had
// no hover at all. First attempt jumped straight from the inactive
// (muted/3% wash) look to the same look as active (white/bg-border) on
// hover — 2 states, not 3.
//
// Corrected same day: client pointed out Linear actually runs this as a
// real 3-tier progression — off < hover < on — for both the text and the
// box, not a binary "not selected vs. selected-or-hovered" split. Text:
// off `#8A8F98` (`muted`) → hover `#D0D6E0` (`strong`) → selected
// `#F7F8F8` (`white`) — all three already exist as tokens, they just
// weren't wired up as three distinct steps. Box: off is the already-
// inspected `bg-white/[0.03]`; selected is `bg-border` (8%); hover now
// sits at a genuine middle value, `bg-white/[0.05]`, not reusing either
// endpoint. Selected tab still has no hover of its own — it's already at
// the brightest tier, nothing above it to transition to.
export function FilterTab({ label, isActive, onClick }: FilterTabProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded px-3 py-[7px] text-small ${
        isActive
          ? 'bg-border font-medium text-white'
          : 'bg-white/[0.03] text-muted hover:bg-white/[0.05] hover:text-strong'
      }`}
    >
      {label}
    </button>
  );
}
