# Phase 30 — Loan Correction Policy (Client)

> **Superseded by Phase 35 (2026-11-05)** — deletion is now admin-only, allowed with payments, irreversible and fully auditable. See `docs/phasesClient/PHASE_35_LOAN_DELETION.md`.

## Goal

Expose a "delete loan" action on the loan detail view, available only when the backend allows it (no registered payments), with a clear confirmation step. See `docs/phases/PHASE_30_LOAN_CORRECTION.md` for the backend rule this consumes.

## Scope

- [x] Loan detail view: shows a "Eliminar préstamo" action (admin only, next to the other admin-only actions), disabled with an explanatory `title` tooltip once the loan has any registered payment. Mirrors the backend's precondition using the already-fetched `useLoanPayments` data (`(payments ?? []).length > 0`) rather than re-deriving it from installment status.
- [x] New `DeleteLoanDialog`: confirmation before deleting, explaining the action can't be undone from the panel — same messaging pattern as `DeactivateClientDialog`.
- [x] Unlike those two existing dialogs (which let a rejection fail silently), `DeleteLoanDialog` catches the mutation and shows the api's error message inline — covers the explicit race-condition case (a payment registered between page load and the delete click, so the backend's own check rejects it even though the button looked enabled).
- [x] On success, navigates back to `/prestamos` — the loan detail page has nothing left to show.

### Tests (per `docs/TESTING.md` conventions for this app)
Frontend component/unit tests are explicitly out of scope per `docs/TESTING.md` ("Out of scope (for now)"). Verified manually instead, end-to-end against the real local api/Postgres: a loan with no payments deletes successfully (soft-deleted, installments cascaded, `loan.delete` audit entry with the correct `Pagaré #...` label); a loan with one registered payment is rejected with 409 and left completely untouched.

## Definition of done for this phase

- [x] An admin can delete a mistakenly created loan from the panel, with a clear confirmation step.
- [x] The action is correctly unavailable once the loan has any payment.
- [x] All items in `docs/DEFINITION_OF_DONE.md` checklist pass.

## Related documents

- `docs/phases/PHASE_30_LOAN_CORRECTION.md` — backend rule this phase consumes
