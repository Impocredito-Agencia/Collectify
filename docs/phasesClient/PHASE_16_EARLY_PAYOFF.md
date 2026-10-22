# Phase 16 — Early Payoff and Interest-First Allocation (Liquidación Anticipada) (Client)

## Goal

Give the collector a way to quote and register an early payoff, showing the client exactly how much is owed today and why. Mirrors `docs/phases/PHASE_16_EARLY_PAYOFF.md` — **read that document's "Before starting" section first**, since the shape of the confirmation dialog and submission flow depends on which allocation rules get confirmed there.

## Required reading before starting

`docs/phases/PHASE_16_EARLY_PAYOFF.md` (the `api` counterpart, including its open questions and the Colombian imputación-de-pagos research it's based on).

## Scope

### Loan detail page
- [x] New "Liquidar anticipadamente" action on `LoanDetailPage.tsx`, next to "Registrar pago" — admin only, disabled unless the loan is `active` (mirrors "Cambiar estado"/"Refinanciar").
- [x] `PayoffDialog.tsx` opens a summary dialog: fetches `GET /loans/:id/payoff-quote` on open, shows the breakdown (interest applied vs. principal applied, per installment) and the total, then a single confirm action that calls `POST /loans/:id/payoff` — read-only summary, not a data-entry form, per the confirmed full-payoff-only scope (no amount field, unlike `RegisterPaymentDialog.tsx`).

- [x] **Added 2026-10-21 (client report):** optional "Observación" textarea in `PayoffDialog.tsx`, above the receipt field, for the reason/motive/payment method — sent as `observation` and shown in the loan's payment history after "Liquidación anticipada —". See the `api` counterpart's follow-up.

## Definition of done for this phase

- [x] An admin can quote and confirm an early payoff from a loan's detail page, seeing the interest/principal breakdown before committing.
- [x] All items in `docs/DEFINITION_OF_DONE.md` checklist pass.

## Related documents

- `docs/phases/PHASE_16_EARLY_PAYOFF.md` — the `api` counterpart
