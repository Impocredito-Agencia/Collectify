# Phase 25 — Refinancing With Overdue Installments

## Goal

Remove `LoansService.refinance()`'s current block on refinancing a loan with overdue/unpaid installments (`findBlockingInstallmentNumbers`, see `docs/phases/PHASE_17_REFINANCING_RECALC.md`), and correctly fold the interest already accrued on those overdue installments into the new loan's principal — instead of rejecting the refinance outright.

## Depends on

`docs/phases/PHASE_23_DYNAMIC_CHARGES.md` — the new principal calculation needs both corriente and moratory interest computed through the unified concept engine, not the old hardcoded mora formula.

## Resolved — confirmed directly with the human (reunión 2026-08-25)

- **The block is removed entirely:** "ya no lo bloqueamos si se refinancia con cuotas vencidas o con fecha de corte ya pasada."
- **New principal formula:** "se deben sumar intereses corrientes y moratorios más el cálculo que ya se hace del capital" — i.e., on top of whatever `LoansService.refinance()`/Phase 17's recalculation already computes for remaining principal, add: (a) the corriente interest already caused on the overdue installments, and (b) the moratory interest/mora already accrued on those same overdue installments, both as of the refinance date.

## Open questions — resolved

- [x] **Reconciliation with Phase 17:** confirmed no reconciliation was actually needed — `LoansService.getRefinanceQuote()`'s existing `calculatePayoff()` reuse already computes exactly this: for a matured (due-today-or-overdue) installment, `totalDue` already sums principal + corriente concept interest + moratory interest. The two were never competing formulas; the only real change needed was removing the block that prevented this calculation from ever running against an overdue installment in the first place.
- [x] **"Fecha de corte ya pasada":** confirmed with the human this is a distinct, new rule — not a rephrasing of "overdue," and not the same "5 días" as `MessageTemplate.upcomingDueReminderDays` (Phase 9's Aviso reminder threshold, which only ever triggers a WhatsApp message and has no bearing on money — an initial mix-up between the two was clarified during confirmation). The actual rule, as first understood: an installment due within the next 5 calendar days — even though not yet actually overdue — is also folded into the new principal when refinancing, contributing only its corriente/concept interest (no moratory interest, since none has genuinely accrued yet). Confirmed via a worked example: refinancing on day 16, with a cuota due the 20th (4 days out, within the 5-day window) folds that cuota's corriente interest into the new principal too. Implemented as `calculatePayoff()`'s new `earlyMaturityWindowDays` option (`REFINANCE_EARLY_MATURITY_WINDOW_DAYS = 5` in `loans.service.ts`), passed only by `getRefinanceQuote()` — `getPayoffQuote()`/`payoff()` (the real early-payoff endpoints) never pass it, so a real payoff quote is never inflated by a not-yet-due cuota. **Corrected 2026-09-30** — this "days before due date" framing was itself wrong; see `docs/DATABASE.md`'s 2026-09-30 note for the confirmed rule (counts forward from when the installment's period started, not backward from its due date) and the renamed `interestAccrualGraceDays`/`INTEREST_ACCRUAL_GRACE_DAYS`.

## Required reading before starting

`docs/phases/PHASE_6_REFINANCING.md`, `docs/phases/PHASE_17_REFINANCING_RECALC.md` (the recalculation this phase extends), `docs/phases/PHASE_23_DYNAMIC_CHARGES.md`, `docs/GLOSSARY.md` ("Imputación del pago", "Refinanciado").

## Scope (once the open questions above are confirmed)

### Service and API
- [x] `LoansService.refinance()`: removed the `findBlockingInstallmentNumbers` rejection entirely, along with the now-dead `blockingInstallmentNumbers`/`findBlockingInstallmentNumbers` private methods (no remaining callers).
- [x] New-principal calculation: `calculatePayoff()` gained an `earlyMaturityWindowDays` option; `getRefinanceQuote()` passes `REFINANCE_EARLY_MATURITY_WINDOW_DAYS = 5`, folding both overdue and near-due (within 5 days) installments' corriente/moratory interest into `suggestedPrincipalAmount`. `getPayoffQuote()`/`payoff()` originally kept omitting the option, so Phase 16's real payoff behavior was unchanged. **Extended, 2026-09-26 (human decision):** they now pass the same window — see `docs/DATABASE.md`'s "Early payoff uses the same 5-day window as refinancing" note; the constant was renamed to `EARLY_MATURITY_WINDOW_DAYS` and is shared by both routes.
- [x] `GET /loans/:id/refinance-quote` already returned the full breakdown via its existing `payoff: PayoffQuote` field (per-installment `interestApplied`/`principalApplied`/`totalDue`, plus totals) — this was already transparent before this phase, no new field needed. Removed `blockedByPendingInstallments` from `RefinanceQuote` (no longer meaningful now that nothing blocks).

### Tests (mandatory)
- [x] Refinancing a loan with at least one overdue installment succeeds (previously rejected) — `loans.service.spec.ts`.
- [x] The new principal correctly includes remaining capital + interest corrido + mora corrida on the overdue installments, verified against a hand-calculated example — `loans.service.spec.ts` `getRefinanceQuote` describe block.
- [x] Refinancing a loan with no overdue installments is unaffected (same numbers as before this phase) — pre-existing "suggests the payoff quote total as the new principal" test still passes unchanged.
- [x] The old blocking behavior is fully gone — no lingering `BadRequestException` for this case.
- [x] Additional coverage beyond the mandatory list: `calculatePayoff.spec.ts`'s new `earlyMaturityWindowDays option` describe block — default-omitted behavior unchanged, inclusive 5-day boundary, just-outside-window exclusion, and confirmation the window never changes how an already-overdue installment is priced.

### Swagger
- [x] `POST /loans/:id/refinance` and `GET /loans/:id/refinance-quote` descriptions updated to remove the "must be current" language and describe the new interest-inclusive principal calculation.

## Frontend follow-up — resolved

`apps/client/src/features/loans/loansApi.ts` and `RefinanceLoanForm.tsx` referenced the now-removed `blockedByPendingInstallments` field (`RefinanceQuote.blockedByPendingInstallments`, the `blockingInstallments`/`isBlocked` derived state, the "el cliente debe ponerse al día primero" warning banner, and the `fieldset`/submit-button disabling tied to it). Cleaned up in this same branch: the dead field was removed from the `RefinanceQuote` type, and the form no longer disables itself or shows a blocking warning — since nothing blocks refinancing anymore, `suggestedPrincipalAmount` (already correctly recalculated, see above) is the only thing the form needed to keep working. The now-dead 400 `/cannot be refinanced until/` error-message handling in `handleSubmit`'s catch block (from the removed blocking behavior) was removed too.

### Extra UX safeguard (also this branch, not in the original scope)

Since refinancing with overdue/near-due installments now folds interés ya causado into the new principal without any friction, added a one-step confirmation dialog (`ConfirmOverdueRefinanceDialog` in `RefinanceLoanForm.tsx`) that appears before submit whenever `refinanceQuote.payoff.totalInterestOwed > 0` — i.e. exactly when the quote is including that extra interest. It states the interest amount being folded in and the resulting new principal, and requires an explicit second click to proceed, so this can't happen from an accidental click on "Refinanciar préstamo". No Figma frame exists for this (reused the existing `DeleteLoanDialog.tsx` confirmation styling).

## Definition of done for this phase

- A loan with overdue installments can be refinanced.
- The new principal is computed exactly per the confirmed formula — not guessed on the open reconciliation question above.
- All items in `docs/DEFINITION_OF_DONE.md` checklist pass.

## After this phase

Update `docs/phases/PHASE_17_REFINANCING_RECALC.md` and `docs/DATABASE.md`'s "Refinancing" section to describe the reconciled formula, and remove the now-obsolete "must be current before refinancing" language wherever it appears.

## Related documents

- `docs/phases/PHASE_6_REFINANCING.md`, `docs/phases/PHASE_17_REFINANCING_RECALC.md` — the refinancing flow this phase changes
- `docs/phases/PHASE_23_DYNAMIC_CHARGES.md` — the concept engine this phase's interest calculation depends on
- `docs/DATABASE.md`, `docs/GLOSSARY.md`
