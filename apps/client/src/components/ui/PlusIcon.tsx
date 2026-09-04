// Centralized 2026-09-04 — was defined identically 3 times (LoanForm.tsx,
// RefinanceLoanForm.tsx, LoanQuotePage.tsx) and once more inline in
// ClientForm.tsx's "+ Agregar referencia" button. A literal "+" character
// renders visibly clipped at this size; this SVG doesn't — see the
// comment that originally justified it in ClientForm.tsx.
export function PlusIcon() {
  return (
    <svg
      className="size-3.5 shrink-0"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
    >
      <path d="M10 4v12M4 10h12" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}
