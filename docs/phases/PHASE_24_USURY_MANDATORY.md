# Phase 24 — Usury Rate Becomes Mandatory and Self-Applied

## Goal

Turn the usury ceiling from an admin-informational warning (Phase 15) into the actual, non-editable value used to price a loan's interest-bearing concepts — and block loan creation entirely when the current month's rate hasn't been entered yet.

## Depends on

`docs/phases/PHASE_23_DYNAMIC_CHARGES.md` — moratory interest must already be priced through `InterestConceptType`/`LoanInstallmentConcept` (with the `category` split that phase adds) before this phase can auto-fill both corriente and moratorio concepts with the usury rate. Do not start this phase before Phase 23 ships.

## Resolved — confirmed directly with the human (reunión 2026-08-25)

1. **Hard block on missing rate:** "no se puede crear un crédito sin que se haya agregado la tasa de usura." `LoansService.create()`/`refinance()` must reject the request outright (not just warn) when `UsuryRateService.getCurrentRate().isStale` is true or no rate exists at all — this is a stricter rule than Phase 15's "warning only, creation-time check" design, and explicitly supersedes it.
2. **Remove the exceeded-ceiling warning:** "se debe quitar advertencia cuando se supera la tasa de usura." Once a loan's interest-bearing concepts are priced at exactly the ceiling (see below), they can no longer exceed it by construction, so `Loan.usuryCeilingExceededAtCreation`/`usuryJustification` and the warning banner become dead code paths for interest-bearing concepts specifically.
3. **Auto-applied, non-editable, but visible:** "la tasa de usura se mete automáticamente en los cargos del crédito (intereses corrientes y moratorios). No se puede editar pero se debe mostrar visualmente al crear el crédito." The current month's certified rate becomes the value of every interest-bearing (`category: corriente` or `moratorio`) concept applied to a loan — the admin can no longer type a different percentage for those, though they still see the value at creation time.

## Open questions — resolved (confirmed with the human, 2026-08-28)

- ~~Do fixed-amount concepts stay admin-set, untouched by this rule?~~ → **Resolved: yes, out of scope.** Only `calculationType: percentage` concepts (corriente or moratorio) are auto-filled; a fixed fee like "Gastos de cobranza" stays exactly what the admin typed.
- ~~What happens to `usuryCeilingExceededAtCreation`/`usuryJustification` as columns?~~ → **Resolved: dropped via migration**, not just retired — the human chose full removal over keeping unused historical columns, overriding this doc's own earlier recommendation to keep them.
- ~~Is the auto-filled percentage exactly `UsuryRate.ratePercentage`, or a derived/split value?~~ → **Resolved: each percentage concept individually equals the full current rate.** A loan with both a corriente and a moratorio percentage concept gets each one set to the complete ceiling value independently — not a rate split across concepts.

## Required reading before starting

`docs/phases/PHASE_15_USURY_RATE.md` (the enforcement model this phase replaces), `docs/phases/PHASE_23_DYNAMIC_CHARGES.md` (the concept `category` split this phase relies on), `docs/DATABASE.md` (`usury_rates`, `loans` usury columns).

## Scope (once the open questions above are confirmed)

### Entities and migrations
- [x] No new columns — this phase changed *behavior*, not shape, beyond dropping the two Phase 15 warning columns (see below).
- [x] Migration `DropUsuryWarningFieldsFromLoans`: drops `loans.usury_ceiling_exceeded_at_creation`/`usury_justification`, per the resolved open question above.

### Service and API
- [x] `LoansService.persistLoanWithInstallments()` and `previewSchedule()`: both call a new `getCurrentUsuryRateOrThrow()` first — throws `BadRequestException` when `getCurrentRate()` is `null` or `isStale`.
- [x] `resolveConcepts()`/`resolveMoratoryConcepts()` (corriente and moratorio respectively) force any `calculationType: percentage` concept's `value` to `currentRate.ratePercentage`, ignoring the request's own value; `fixed_amount` concepts pass through untouched.
- [x] `POST /loans/preview-schedule` reflects the same hard block and auto-filled value, via the same `resolveConcepts`/`resolveMoratoryConcepts` calls `persistLoanWithInstallments()` uses.
- [x] Removed entirely: `buildUsuryWarning()`, the `UsuryWarning` interface, `SchedulePreview.usuryWarning`, and `apps/api/src/usuryRates/calculateLoanEffectiveRate.ts` (its sole caller was `buildUsuryWarning`).
- [x] **Permission gap found and fixed (not in the original scope, same shape as a Phase 23 fix):** `GET /usury-rates/current` was admin-only, and a Phase-23-granted collector creating a loan had no way to see the rate/staleness before hitting the new hard block. Opened to any authenticated user — `POST /usury-rates` and `GET /usury-rates` (history) stay admin-only.

### Tests (mandatory)
- [x] Loan creation/refinance/preview all rejected when no usury rate exists, and when the existing rate is stale (prior month).
- [x] A percentage concept's persisted value always equals the current usury rate, regardless of what the request body sends — verified for both corriente and moratorio, on create, refinance, and preview.
- [x] A fixed-amount concept's value is untouched by the auto-fill.
- [x] Manually verified end-to-end against a real Postgres/API: hard block with the real rate row temporarily removed and restored; a loan created with nonsense percentage values (500%, 999%) persisted the real 2% rate in every `loan_installment_concepts` row instead; the fixed-amount concept kept its typed value.

### Swagger
- [x] `POST /loans`/`POST /loans/:id/refinance`/`POST /loans/preview-schedule` descriptions updated to state the hard-block rule and the auto-filled rate; `GET /usury-rates/current` description updated for the open-access change.

## Definition of done for this phase

- [x] A loan cannot be created, refinanced, or previewed without the current month's usury rate on file.
- [x] Interest-bearing (percentage) concepts are priced at exactly the confirmed auto-filled value, not admin-editable; fixed-amount concepts are unaffected.
- [x] The exceeded-ceiling warning is no longer reachable — the code path and its columns are gone.
- [x] The confirmed rules are implemented exactly as agreed with the human — not guessed on the open questions above.
- [x] All items in `docs/DEFINITION_OF_DONE.md` checklist pass.

## After this phase

Update `docs/DATABASE.md`'s `usury_rates`/`loans` sections and "Enforcement" language in the (retired) Phase 15 warning flow, and `docs/GLOSSARY.md`'s "Tasa de usura" entry to describe the hard-block, self-applied rule.

**Bug fix, 2026-09-03** (human report): "auto-priced whenever a percentage concept exists" left a gap — a loan could still be created with zero moratory concepts at all, silently falling back to the pre-Phase-14 `Loan.interestRate` formula via a separate, confusing UI input the client wanted removed. `interest_concept_types` gained `isUsuryRateConcept`, a mandatory, non-removable concept per category (`corriente`/`moratorio`) that `LoansService` now requires on every create/refinance/preview. See `docs/DATABASE.md`'s "Bug fix, 2026-09-03 — mandatory usury-rate concept" section for the full design.

**Follow-up fix, 2026-09-03** (human report, same day): the mandatory-concept mechanism above still required an admin to manually create and flag a concept before any loan could be created, which the client flagged as a regression — the usury rate was already auto-applying, so this should require no setup. A migration now seeds one flagged "Tasa de usura" concept per category automatically. See `docs/DATABASE.md`'s "Follow-up fix, 2026-09-03" note under the same section.

**Reintroduced then reverted, 2026-09-03** (human follow-up request, same day as "Paused" above): a narrower per-concept cap ("bajar sí, subir no" on a single concept's own value, not a sum) was built and shipped, then reverted the same day at the human's request ("no me entendiste bien" — the requested behavior wasn't what got built).

**Redesigned, 2026-09-03** (final state this session): the root cause of the back-and-forth above was the catalog-flag mechanism itself (`isUsuryRateConcept`) — modeling the loan's own interest as "a concept the admin flags in Tipos de cargo" was the wrong shape. Replaced with a system field: `CreateLoanDto`/`RefinanceLoanDto`/`PreviewScheduleDto.corrienteInterestRate`/`moratoryInterestRate`, capped at the current usury ceiling ("editable solo hacia abajo"), turned into a synthetic `LoanInstallmentConcept` row (`interestConceptTypeId: null`) by `LoansService.resolveConceptsWithInterest`. The catalog (`InterestConceptType`) is optional business fees again, same as pre-Phase-24. See `docs/DATABASE.md`. **Updated 2026-09-30:** when omitted, these fields no longer default to the ceiling itself — see `docs/DATABASE.md`'s "Default corriente/moratorio rate rounded to 2%" note.

## Related documents

- `docs/phases/PHASE_15_USURY_RATE.md` — the warning-only model this phase replaces
- `docs/phases/PHASE_23_DYNAMIC_CHARGES.md` — the concept `category` split this phase depends on
- `docs/DATABASE.md`, `docs/GLOSSARY.md`
