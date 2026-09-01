# Phase 31 — Loan Section Terminology and Copy (Client)

## Goal

Apply the confirmed label renames across the loan section, and add a "saldo capital a la fecha" card to the loan detail view. See `docs/phases/PHASE_31_LOAN_TERMINOLOGY.md` for the backend field this consumes, and for why the justification note originally scoped here was dropped entirely.

## Scope

- [x] Rename every occurrence in the loan section:
  - "Tasa de interés" (mora rate) → "Incremento consolidado en caso de mora" — `LoanDetailPage.tsx`'s KPI card and `EditLoanDialog.tsx`'s edit field (same ambiguity as the card, extended during implementation). Left `LoanForm.tsx`/`RefinanceLoanForm.tsx`'s "Tasa de interés moratorio (%)" as-is — already unambiguous.
  - "Saldo pendiente" → "Saldo pendiente con incremento" — `LoanDetailPage.tsx` KPI card.
  - "Monto original" → "Monto original sin incremento" — `LoanDetailPage.tsx` KPI card.
  - Extended for consistency: `LoansListPage.tsx`/`ClientDetailPage.tsx`'s abbreviated table columns "Monto"/"Saldo" → "Monto (s/inc.)"/"Saldo (c/inc.)".
- [x] Add a "Saldo capital a la fecha" card to `LoanDetailPage.tsx`'s KPI grid (now 6 cards), sourced from `loan.currentPrincipalBalance` on `GET /loans/:id` — no client-side recalculation. Deliberately a separate card from "Saldo pendiente con incremento" — the new one excludes accrued interest, the existing one doesn't (see `docs/phases/PHASE_31_LOAN_TERMINOLOGY.md`'s "Resolved during implementation").

### Tests (per `docs/TESTING.md` conventions for this app)
- [x] Renamed labels appear correctly everywhere the old ones did — grepped the codebase for the old exact strings (`label="Tasa de interés"`, `label="Saldo pendiente"`, `label="Monto original"`), zero matches remain.
- [x] The new card renders `loan.currentPrincipalBalance` (verified manually — no frontend unit tests, per `docs/TESTING.md`'s scope for this app).

## Definition of done for this phase

- [x] The three renames are applied consistently across the loan section, with no old label left behind.
- [x] The "saldo capital a la fecha" card is visible on the loan detail view.
- All items in `docs/DEFINITION_OF_DONE.md` checklist pass.

## Related documents

- `docs/phases/PHASE_31_LOAN_TERMINOLOGY.md` — backend field this phase consumes
