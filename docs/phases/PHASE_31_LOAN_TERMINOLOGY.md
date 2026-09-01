# Phase 31 — Loan Section Terminology and Copy

## Goal

Fix confusing labels across the loan section that the client reported real users misreading — most importantly, "tasa de interés" being mistaken for a rate charged *separately from* mora-related charges, when it's actually the ceiling that already covers them. Also surface the loan's current principal balance as its own card, and add a short note explaining why a loan's total surcharge rate is what it is.

## Depends on

`docs/phases/PHASE_23_DYNAMIC_CHARGES.md` and `docs/phases/PHASE_24_USURY_MANDATORY.md` — the copy below describes the unified, usury-priced charge model those phases build; do not ship this phase's wording ahead of that model actually existing, or the copy will describe behavior the app doesn't have yet.

## Resolved — confirmed directly with the human (reunión 2026-08-25)

1. **Renames**, applied throughout the loan section:
   - "Tasa de interés" (as currently labeling the mora rate) → **"Incremento consolidado en caso de mora"**
   - "Saldo pendiente" → **"Saldo pendiente con incremento"**
   - "Monto original" → **"Monto original sin incremento"**
2. **Why this matters:** "hay confusión con la tasa de mora que es el techo máximo, creen que es por aparte y no que cobija los cargos que se inventan" — users were reading the mora rate as one charge among several, rather than the ceiling that already encompasses every additional charge on top of it. The rename is meant to make that containment explicit in the label itself.
3. **New card:** "saldo capital a la fecha" on the loan detail view — the current-principal-balance figure that already gets computed when refinancing (per `docs/DATABASE.md`), just not currently shown as its own card outside that flow.

## Dropped from scope (confirmed directly with the human, 2026-08-31)

- **Justification note.** The original meeting note ("justificación de tasa total de recargos, ponerle donde se explica por qué se pusieron esos intereses") turned out to be a misremembering of an already-existing field, `Loan.usuryJustification` ("Justificación de la tasa de usura") from Phase 15 — which Phase 24 deliberately dropped (column and all) once the usury rate became self-applied and a loan can no longer exceed the ceiling by construction, making a justification moot. The human reviewed the meeting recording directly and confirmed this: the field "no servía para mucho e iba a ser usado muy pocas veces" — not worth rebuilding from scratch. This item is dropped entirely, not deferred; do not reintroduce `usuryJustification` or an equivalent field without a new confirmation round.

## Resolved during implementation (2026-08-31)

- **Pure principal, not principal+interest:** `calculatePayoff()` (the function this phase reuses) returns several figures — `totalPrincipalOwed` (pure remaining capital) and `totalDue`/`suggestedPrincipalAmount` (capital plus accrued interest, what `RefinanceLoanForm.tsx` shows as "Capital sugerido"). Confirmed with the human: "saldo capital a la fecha" must show `totalPrincipalOwed` — showing `totalDue` would overstate the client's remaining principal by folding in interest. Also confirmed (by inspecting `calculatePayoff.ts`) that `totalPrincipalOwed` is unaffected by the refinance-only `earlyMaturityWindowDays` option, so no distinction is needed between "the payoff-quote calculation" and "the refinance-quote calculation" for this specific figure — they always agree.
- **Rename scope extended beyond the 3 literal strings above**, confirmed reasonable during implementation (not a financial-calculation call, a copy-consistency one): `EditLoanDialog.tsx`'s "Tasa de interés (%)" field (same ambiguity as the KPI card) was renamed too; `LoanForm.tsx`/`RefinanceLoanForm.tsx`'s "Tasa de interés moratorio (%)" were left as-is (already unambiguous); `LoansListPage.tsx`/`ClientDetailPage.tsx`'s abbreviated table columns "Monto"/"Saldo" were changed to "Monto (s/inc.)"/"Saldo (c/inc.)" for consistency with the renamed KPI cards.

## Required reading before starting

`docs/phases/PHASE_23_DYNAMIC_CHARGES.md`, `docs/phases/PHASE_24_USURY_MANDATORY.md` (the model this copy describes), `docs/phases/PHASE_17_REFINANCING_RECALC.md` (where the current-balance calculation already exists).

## Scope

### Service and API
- [x] Expose the current principal balance ("saldo capital a la fecha") on the loan detail response (`GET /loans/:id`) as `currentPrincipalBalance` — computed inline in `LoansService.findOne()` from data already fetched there (pending installments + their moratory concepts), using the same `calculatePayoff()` engine Phase 17's refinance recalculation uses, without re-fetching the loan/concepts a second time via a redundant `getPayoffQuote()` call.

### Tests (mandatory)
- [x] `currentPrincipalBalance` on `GET /loans/:id` equals the sum of pending installments' `principalPortion` only (no interest folded in), and excludes non-pending (paid/cancelled) installments — `loans.service.spec.ts`, `findOne` describe block.

### Swagger
- [x] Updated field documented on the loan detail response (`GET /loans/:id`'s `@ApiOperation` description).

## Definition of done for this phase

- [x] The three renamed labels appear consistently everywhere they're currently shown (plus `EditLoanDialog.tsx` and the two list-table column headers — see "Resolved during implementation" above).
- [x] A loan's current principal balance is available on its detail response and shown as its own card.
- [x] The justification note item is dropped from scope (see above) — not part of this phase's done criteria.
- All items in `docs/DEFINITION_OF_DONE.md` checklist pass.

## After this phase

Update `docs/GLOSSARY.md`'s "Interest rate / Tasa de mora" entry and `docs/DATABASE.md`'s `loans` table description to use the new terminology consistently, so future phase docs don't reintroduce the old, confusing labels.

## Related documents

- `docs/phases/PHASE_23_DYNAMIC_CHARGES.md`, `docs/phases/PHASE_24_USURY_MANDATORY.md` — the model this phase's copy describes
- `docs/phases/PHASE_17_REFINANCING_RECALC.md` — the existing balance calculation this phase reuses
- `docs/DATABASE.md`, `docs/GLOSSARY.md`
