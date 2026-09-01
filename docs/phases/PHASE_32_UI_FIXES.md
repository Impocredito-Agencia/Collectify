# Phase 32 — UI Fixes and Small Corrections

## Goal

A bundle of smaller corrections flagged directly by the client (reunión 2026-08-25), none of which touch a financial calculation — bugs and rough edges, not new business rules. Grouped into one phase per this project's precedent for miscellaneous polish work (see `docs/phasesClient/PHASE_8_POLISH.md`).

## Resolved — confirmed directly with the human

- **Sequential payment enforcement:** "el botón de pagar está habilitado para todas las cuotas, o sea que podría pagar la cuota novena sin haber pagado las anteriores" — an installment shouldn't be payable while an earlier-numbered installment on the same loan is still pending.
- **"Cotizador" renamed to "Proyector rápido"** — no functional change, name only (see `docs/phases/PHASE_14_INTEREST_CONCEPTS.md`, which shipped it under the old name).
- **Confirmation step before liquidating a credit** — "agregar botón de confirmación al liquidar el crédito" (the existing `POST /loans/:id/payoff` flow, `docs/phases/PHASE_16_EARLY_PAYOFF.md`, currently has none).

## Resolved during implementation (2026-09-01)

- **Sequential-payment rule extended to the bulk endpoint too** (confirmed with the human): the brief above only named `InstallmentsService.registerPayment`, but `POST /installments/payments/bulk` (Phase 28) had the same gap — "Pagar seleccionadas" could otherwise skip the rule the single-payment button enforces. `registerBulkPayments` now sorts its entries by `installmentNumber` before processing (not submission order) so the same-batch case — paying installments 1 and 2 of a loan together — never false-positives against itself; each entry still runs the identical `assertNoEarlierPendingInstallment` check as `registerPayment` (shared private method), against a repository outside the batch.
- **Audit log root cause identified — presentation-only, and turned out to be entirely frontend.** The "raw unreadable code" was `auditLogLabels.ts` (a translation dictionary on the `client` app, not part of `AuditLog.metadata`) falling out of sync with newer `@Audit()` calls: `loan.delete` (Phase 30), `payment.registerBulk` (Phase 28), `client.setMessageFrequency`/`clearMessageFrequency` (Phase 27), `user.updatePermissions` (Phase 20), and `clientLoanImport.execute` (Phase 8, never backfilled) all fell through to their raw dev-facing string instead of a Spanish label, both in the audit list's "Acción" column and the "ver detalle" drawer. Confirmed `AuditLog.entityLabel`/`metadata` themselves are not malformed — no backend change was needed for this item. Fixed by adding the six missing entries (plus the `clientLoanImport` entityType) to that map — see `docs/phasesClient/PHASE_32_UI_FIXES.md`.
- **"0 enviados" — root cause confirmed, fix is removal, no backend change needed.** `MessageLogsPage.tsx`'s "Enviados" legend count is computed purely client-side (`useMessageLogs({status: Sent, limit: 1})`); `GET /message-logs`'s pagination `meta.total` was verified correct for any status filter (no bug in `MessageLogsService.findAll`). Per the client's own framing already recorded in this page's code (a to-do list of sends needing attention, not a full audit log), the right fix is dropping the "Enviados" count entirely rather than trying to make it more "correct" — kept "Fallidos" only.
- **Liquidar anticipadamente already had a confirmation step** (`PayoffDialog.tsx`: breakdown table + "Cancelar"/"Confirmar liquidación") — the "no confirmation exists" assumption in this brief's "Resolved" section above was stale. Confirmed with the human anyway: added a second, explicit "¿Estás seguro? Esta acción no se puede deshacer" step behind the existing "Confirmar liquidación" button, so the flow is now breakdown → Confirmar liquidación → explicit warning → "Sí, liquidar definitivamente".

## Scope

### Backend (defense in depth, not just a UI-disabled button)
- [x] `InstallmentsService.registerPayment`: reject (400) a payment against installment N if any installment with a lower `installment_number` on the same loan is still `pending` — a real server-side rule, since a disabled button alone doesn't stop a direct API call.
- [x] `InstallmentsService.registerBulkPayments`: same rule, extended during implementation (see above) — entries are processed in `installmentNumber` order so a same-batch pair never false-positives.
- [x] Audit log detail: whatever currently renders as an unreadable raw code in a movement's "ver detalle" view — investigate `AuditLog.metadata`'s JSON rendering in that response and confirm the fix is presentation-only (label the known fields clearly) and not a sign `entity_label`/`metadata` themselves are malformed for that action type. (Turned out to be a frontend-only label-map gap — see above.)
- [x] Message history: `GET /message-logs` (or wherever the "0 enviados" figure is computed/returned) — remove or correct whatever produced a misleading always-zero "enviados" count; per the client's own framing this list should only be surfacing failures, not a sent-count that's always wrong. (Confirmed no backend bug; fix is a frontend-only removal — see above.)

### Tests (mandatory)
- [x] Paying installment N is rejected while any earlier installment on the same loan is still pending; succeeds once they're all paid/cancelled. Covered for both `registerPayment` and `registerBulkPayments` (including a same-batch, out-of-submission-order case) in `installments.service.spec.ts`.
- [x] Audit log detail fix covered by a test asserting the specific field that was previously unreadable now renders correctly — `apps/client/src/features/auditLogs/auditLogLabels.spec.ts` (frontend, since the fix lives there).

### Swagger
- [x] `POST /installments/:id/payments` error response documented for the new sequential-payment rejection.
- [x] `POST /installments/payments/bulk` error response description extended for the same rule.

## Definition of done for this phase

- [x] Every item above is fixed with no change to any amount owed, interest calculation, or message content.
- [x] The sequential-payment rule is enforced server-side, not just hidden in the UI (both single and bulk endpoints).
- All items in `docs/DEFINITION_OF_DONE.md` checklist pass.

## Related documents

- `docs/phasesClient/PHASE_32_UI_FIXES.md` — the client-side half of this bundle
- `docs/phases/PHASE_16_EARLY_PAYOFF.md`, `docs/phases/PHASE_14_INTEREST_CONCEPTS.md`, `docs/phases/PHASE_11_AUDIT_LOG.md` — the flows this phase's fixes touch
