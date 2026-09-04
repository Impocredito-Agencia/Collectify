# Phase 23 — Unified Dynamic Charges (Client)

## Goal

Render the loan detail view's charge breakdown as a dynamic per-charge table instead of a vertical list of concepts under each installment amount, let the admin pick a fixed-amount concept's distribution mode, and clean up the amortizador panel's readability. See `docs/phases/PHASE_23_DYNAMIC_CHARGES.md` for the backend model this consumes.

## Scope

### Interest concept type management
- [x] `InterestConceptTypesPage`/`InterestConceptTypeForm`: added the `category` selector (`corriente` / `moratorio`) when creating/editing a concept type; the catalog list shows each type's category as a badge.
- [x] When `calculationType` is `fixed_amount` **and** `category` is `corriente`, show the two distribution options (repartir entre todas las cuotas vs. cobrar solo en la primera cuota) and require a choice — no silent default. Hidden entirely for a `moratorio` fixed-amount concept, which is always charged once, flat (confirmed with the human — see the backend phase doc's resolved open questions).

### Loan detail — dynamic charge table
- [x] Replaced the "list of concepts under the installment amount" rendering with a real table: one column per charge assigned to the loan (dynamic, driven entirely by `conceptBreakdown` — corriente and moratorio unified, tagged by category badge), one row per installment.
- [x] Horizontal scroll lives inside the table's own container (`overflow-x-auto` + `min-w-max`), not the page.

### Amortizador panel
- [x] Added borders/grid lines to the cells (both the in-form `LoanForm`/`RefinanceLoanForm` preview and the standalone `/cotizador` — the latter also got a bigger panel/headline figure).
- [x] Enlarged the `/cotizador` subwindow/panel.
- [x] Numeric discrepancy fix — **dropped from this round's scope**, see the backend phase doc's resolved open questions ("el número era muy pequeño").
- [x] Verified no client-side recalculation exists anywhere in these panels — every number rendered comes straight from the API response.

### Permissions
- [x] Loan creation form renders and submits successfully for a collector who has the `loans` module grant but not `interest_concept_types` — verified manually: the live-preview/breakdown section (`LoanForm`'s "Previsualizar cronograma de cuotas" block) is what's hidden, the concept pickers and the rest of the form stay usable. Also fixed `LoansListPage`'s "Nuevo préstamo" button, which was still gated on `role === 'admin'` even after the backend permission change.

### Tests
- No component-level frontend tests were added — `docs/TESTING.md` explicitly scopes "what must be tested" to the `api`'s service layer only ("Frontend testing conventions will be added once the `client` test setup is defined"), and no React component test exists anywhere in this codebase to follow as precedent. Verified instead via the project's established manual-browser-testing practice (Playwright + headless Chromium against the real running stack) — every scope item above was exercised end-to-end and screenshotted: concept-type category/distribution UI, both concept repeaters on `LoanForm`, the dynamic charge table with real overdue data, the amortizador panel, and the collector permission boundary (sidebar nav, "Nuevo préstamo" button, hidden preview section).

## Definition of done for this phase

- [x] The loan detail view shows charges as a dynamic per-charge table.
- [x] A fixed-amount concept's distribution mode is selectable and required (when applicable).
- [x] The amortizador panel is visually fixed (borders, size) and shows figures matching the backend, no independent client-side math.
- [x] A collector without `interest_concept_types` permission can still create a loan through the UI.
- [x] All items in `docs/DEFINITION_OF_DONE.md` checklist pass.

## Related documents

- `docs/phases/PHASE_23_DYNAMIC_CHARGES.md` — backend model and API shape this phase consumes
- `docs/phasesClient/PHASE_14_INTEREST_CONCEPTS.md` — the amortizador/concept UI this phase extends

## Follow-up, 2026-09-03

Replaced "cobrar solo en la primera cuota" with "cobrar el mismo monto en cada cuota" in `InterestConceptTypeForm`'s distribution picker (item 2 above) — the client had no use for the old option. See `docs/phases/PHASE_23_DYNAMIC_CHARGES.md`'s own follow-up note.
