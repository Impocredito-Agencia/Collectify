# Phase 30 — Loan Correction Policy

> **Superseded by Phase 35 (2026-11-05)** — deletion is now admin-only, allowed with payments, irreversible and fully auditable. See `docs/phases/PHASE_35_LOAN_DELETION.md`.

## Goal

Give an admin a safe way to remove a loan created by mistake, without risking deletion of a loan that already has real financial history against it.

## Resolved — confirmed directly with the human (reunión 2026-08-25)

- **Delete, conditional on no payments:** "eliminar si no tiene pago registrado" — a loan can be deleted only while none of its installments have any registered payment. Once a payment exists anywhere on the loan, deletion is no longer offered; the loan must be handled some other way (e.g. refinanced, or left as historical record) rather than removed.

## Required reading before starting

`docs/DATABASE.md` (`loans`, soft-delete convention), `docs/phases/PHASE_4_LOANS_INSTALLMENTS.md`, `docs/phases/PHASE_11_AUDIT_LOG.md` (deletion must be audit-logged like every other sensitive action).

## Scope

### Service and API
- [x] `LoansService.remove(id)` (new): rejects with `ConflictException` (409) if any installment belonging to the loan has at least one `Payment` row; otherwise soft-deletes the loan and its installments (in one transaction) via the standard `.softDelete()` pattern — no hard delete, matching every other table in `docs/DATABASE.md`.
- [x] `DELETE /api/v1/loans/:id` — admin only, `@Audit('loan.delete', 'loan')` per the established audit-logging convention. `AuditLogInterceptor`'s `loan` entity-label resolution extended with a `withDeleted` fallback lookup (mirroring the existing `client` one), since the 204 response has no `promissoryNoteNumber` to read the label from directly.

### Tests (mandatory)
- [x] A loan with zero payments across all its installments can be deleted.
- [x] A loan with at least one payment on any installment is rejected with a clear error, unchanged.
- [x] Deletion is soft (cascades to installments) and produces an audit log entry with the correct entity label.

### Swagger
- [x] `DELETE /api/v1/loans/:id` documented, including the no-payments precondition.

## Definition of done for this phase

- [x] An admin can delete a mistakenly created loan, but only before any payment has been registered against it.
- [x] The action is audit-logged and soft, per this project's existing conventions.
- [x] All items in `docs/DEFINITION_OF_DONE.md` checklist pass.

## After this phase

Update `docs/DATABASE.md`'s `loans` section to note the delete precondition, and `docs/phases/PHASE_11_AUDIT_LOG.md`'s action list to include `loan.delete`.

## Related documents

- `docs/phases/PHASE_4_LOANS_INSTALLMENTS.md`, `docs/phases/PHASE_11_AUDIT_LOG.md`
- `docs/DATABASE.md`
