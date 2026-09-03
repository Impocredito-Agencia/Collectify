// Centralizes the input className every form in the app previously
// redeclared as its own identical local `inputClassName` function
// (ClientForm, LoanForm, UserForm, RefinanceLoanForm,
// InterestConceptTypeForm, ChangePasswordDialog — byte-identical copies).
// Import this instead of redefining it locally, so a future style change
// is a one-line edit here instead of a grep across every form.
export function inputClassName(hasError: boolean): string {
  const base =
    'h-[42px] w-full rounded border bg-input px-3.5 text-control text-white placeholder-mid focus:outline-none';
  return hasError
    ? `${base} border-danger focus:border-danger`
    : `${base} border-border focus:border-subtle`;
}
