# Phase 23 — Unified Dynamic Charges (Cargos Corrientes y Moratorios)

## Goal

Stop treating moratory interest as a single hardcoded rate/formula (`loans.interest_rate`, the `installmentCalculations.ts` overdue formula) and price it through the same admin-managed concept engine Phase 14 already built for ordinary ("corriente") interest — so the admin can add, remove, or reprice moratory charges the same way they already do for corriente ones, without a code change. Also fixes how a fixed-amount concept distributes across a loan's installments, and how the loan detail view displays the resulting charges.

## Resolved — confirmed directly with the human (reunión 2026-08-25)

1. **Moratory interest becomes dynamic:** "los intereses moratorios se agreguen exactamente igual a como se agregan los intereses corrientes... que sean dinámicos." Moratory charges are no longer a single fixed rate applied by a hardcoded formula — they're one or more `InterestConceptType` rows the admin manages, the same catalog used for corriente concepts, distinguished by a new category so the app knows which concepts apply on-time vs. only once an installment is overdue.
2. **Fixed-amount distribution mode:** when a concept's `calculation_type` is `fixed_amount`, the admin must choose between two modes — **split the total evenly across every installment**, or **charge the full amount only on the first installment**. This replaces the original, vaguer "repartir vs. copiar a cada mes" framing from the initial meeting notes — the human's final answer above is authoritative.
3. **Loan detail charge table:** "la tabla en el valor de la cuota no debe mostrarse cada concepto debajo del valor sino en una tabla dinámica en la que el header tendría el cargo asignado y el valor a la cuota." One column per charge actually assigned to the loan (dynamic, not a fixed set of named columns like the original "Cuota sin incremento / Tasa de interés / Gastos de cobranza / Gestión por mora / Firma electrónica / Cuota a pagar" sketch from the meeting notes) — that fixed-column sketch is superseded by this dynamic-table answer.
4. **Amortizador fixes:** add borders/grid lines to the cells, make the panel bigger (currently reported as looking bad/cramped), and investigate why its calculation comes out slightly different from the figure Juan uses manually — resolve the discrepancy, don't just document it.
5. **Permission gap:** a collector must be able to create a loan even where module permissions hide the amortizador's detail from them — "los cobradores no miren el amortizador pero pues sí deben poder crear el crédito." `ModulePermissionsGuard`'s current `loans` module grant is apparently gating the amortizador view in a way that also blocks loan creation for a collector without the `interest_concept_types` grant; these need to be decoupled.

## Open questions — resolved (confirmed with the human, 2026-08-28)

- ~~Which existing `interest_concept_types` rows are "moratorio" vs. "corriente"? ... confirm the exact set of moratory concepts the client wants pre-seeded~~ → **Resolved: none are pre-seeded.** "La idea es que queden dinámicos que él pueda agregar los que quiera tal cual los intereses corrientes." A new `category` column (`corriente`/`moratorio`) distinguishes them, defaulting existing rows to `corriente` (what they already implicitly were) — the admin creates his own moratory concepts through the same catalog mechanism as corriente ones, with no forced data migration inventing a specific concept's name/value.
- ~~When does a moratory concept's `computed_amount` get calculated~~ → **Resolved: on read, once an installment is actually overdue** — never projected at generation time, matching the doc's own original reasoning (future overdue days can't be known in advance). A `LoanInstallmentConcept` row for a moratory concept is still created per installment at generation time (recording the assignment, name/calculationType/value snapshotted), but its `computed_amount` is always stored as `0` — the real amount is computed live by `calculateMoratoryCharges` (`installmentCalculations.ts`) whenever that installment is read.
- ~~Exact wording/value for the pre-seeded moratory concept(s)~~ → **Moot — nothing is pre-seeded**, see above.
- **New, resolved during implementation:** a `moratorio` fixed-amount concept is charged once, flat, the moment an installment becomes overdue — it does not scale with `overdueDays` the way a percentage concept does. `fixedAmountDistribution` (split vs. first-installment-only) is therefore only meaningful for a `corriente` fixed-amount concept; it's `NULL`/ignored for `moratorio` ones.
- **New, resolved during implementation:** the amortizador numeric discrepancy (item 4 above) was explicitly dropped from this round's scope — "el número era muy pequeño." Not investigated further; still flagged as an open item if it needs picking up later.

## Required reading before starting

`docs/phases/PHASE_14_INTEREST_CONCEPTS.md` (the engine this phase extends), `docs/phases/PHASE_15_USURY_RATE.md` (Phase 24 will build directly on this phase's category split), `docs/DATABASE.md` (`interest_concept_types`, `loan_installment_concepts`, `installments` overdue formula), `apps/api/src/loans/amortization/generateSchedule.ts`.

## Scope (once the open questions above are confirmed)

### Entities and migrations
- [x] `InterestConceptType.category` (ENUM: `corriente`, `moratorio`) — which side of the engine a concept type belongs to.
- [x] `InterestConceptType.fixedAmountDistribution` (ENUM: `split_across_installments`, `first_installment_only`), nullable — only meaningful when `calculationType` is `fixed_amount` **and** `category` is `corriente` (see resolved open questions above).
- [x] `LoanInstallmentConcept.category` snapshot, mirroring the type's category at generation time (same snapshot precedent as `name_snapshot`/`calculation_type`).
- [x] Migration to add the above columns — additive only, **no data migration seeding a moratory concept forward**, per the resolved open question above (the catalog stays fully admin-driven, nothing pre-seeded).
- [x] `loans.interest_rate` is deprecated once moratory concepts fully replace its role — column not dropped (existing loans, and any new loan with no moratory concepts assigned, still use it as the fallback formula); marked superseded in `docs/DATABASE.md`.

### Service and API
- [x] `generateSchedule.ts`: honors `fixedAmountDistribution` when generating `computed_amount` for a fixed-amount corriente concept.
- [x] New logic (`calculateMoratoryCharges`, `installmentCalculations.ts`) computes moratory concept amounts per overdue installment on read, replacing the hardcoded formula for any loan with at least one moratory concept assigned; the legacy formula remains the fallback otherwise. `enrichInstallment.ts` and `calculatePayoff.ts` (Phase 16) both switch consistently.
- [x] `LoansController`/`InstallmentsController` responses expose the per-installment charge breakdown (`conceptBreakdown`), corriente and moratorio items unified in one array, each tagged with `category`, shaped for the dynamic table the client app renders.
- [ ] Fix the amortizador calculation discrepancy identified against Juan's manual figures — **dropped from this round's scope**, see resolved open questions above.
- [x] `ModulePermissionsGuard`: decoupled "can create a loan" (`POST /loans`, now `@RequireModule(AppModule.Loans)`) from "can manage the concept catalog" (`POST`/`PATCH /interest-concept-types`, now `@RequireModule(AppModule.InterestConceptTypes)`) — `GET /interest-concept-types` and `POST /loans/preview-schedule` are open to any authenticated user (a pre-existing inconsistency with the already-confirmed open `/cotizador` page, fixed as part of this change). "Collectors shouldn't see the amortizador" is a frontend-only UI decision (`LoanForm.tsx` hides the live-preview section), not a new backend restriction.

### Tests (mandatory)
- [x] Fixed-amount concept: `split_across_installments` divides the total correctly across every installment (including remainder handling, same convention as the existing declining-balance rounding rule); `first_installment_only` charges the full amount once, zero on every other installment.
- [x] Moratory concept computation matches the previously-confirmed formula's numeric output (percentage concept at the same rate as the legacy `interestRate` produces an identical number), guaranteeing no silent regression. Also verified manually end-to-end against a real Postgres instance.
- [x] A collector without `interest_concept_types` permission can still call `POST /loans`; one without `loans` permission still cannot — verified manually (no dedicated controller spec exists for this codebase's other `@RequireModule` controllers either; `ModulePermissionsGuard`'s own unit tests, Phase 20, cover the generic mechanism).
- [ ] Amortizador discrepancy: regression test — **dropped from this round's scope**, see resolved open questions above.

### Swagger
- [x] Updated concept/loan/installment DTOs and response shapes documented.

## Definition of done for this phase

**Backend and frontend both done** — backend in PR #59 (`feature/dynamic-charges-backend`), frontend in `feature/dynamic-charges-frontend` — see `docs/phasesClient/PHASE_23_DYNAMIC_CHARGES.md` for the frontend scope.

- Moratory interest is priced through `InterestConceptType`/`LoanInstallmentConcept`, not the hardcoded formula.
- A fixed-amount concept's distribution mode is explicit, correct, and covered by tests.
- The loan detail view's data (charge-by-installment) is shaped for a dynamic per-charge table, not a fixed set of columns, and rendered as one by the client.
- ~~The amortizador's discrepancy against Juan's manual numbers is resolved, not just documented.~~ **Dropped from this round's scope** — see resolved open questions above.
- A collector can create a loan without the `interest_concept_types` permission grant, end to end (backend + UI).
- All items in `docs/DEFINITION_OF_DONE.md` checklist pass.

## After this phase

Update `docs/DATABASE.md` (`interest_concept_types`, `loan_installment_concepts` new columns; mark `loans.interest_rate` superseded) and `docs/GLOSSARY.md` ("Interest / Interés (mora interest)" section, which currently documents the formula this phase replaces).

## Related documents

- `docs/phases/PHASE_14_INTEREST_CONCEPTS.md` — the concept engine this phase extends
- `docs/phases/PHASE_24_USURY_MANDATORY.md` — depends on this phase's `category` split
- `docs/DATABASE.md`, `docs/GLOSSARY.md`

## Follow-up, 2026-09-03

`first_installment_only` (item 2 above) had no real use case for this client — replaced with `repeated_each_installment` (full fixed amount charged on every installment, not divided), via the `RenameFirstInstallmentOnlyToRepeatedEachInstallment` migration. See `docs/DATABASE.md`'s `interest_concept_types` entry and `docs/phasesClient/PHASE_23_DYNAMIC_CHARGES.md`.
