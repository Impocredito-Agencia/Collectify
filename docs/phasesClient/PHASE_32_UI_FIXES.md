# Phase 32 — UI Fixes and Small Corrections (Client)

## Goal

The client-side half of the bug bundle flagged by the client (reunión 2026-08-25). See `docs/phases/PHASE_32_UI_FIXES.md` for the matching backend fixes (sequential-payment server-side rule, audit log detail, message history count).

## Resolved during implementation (2026-09-01)

- **Audit log root cause was frontend-only:** `auditLogLabels.ts`'s `ACTION_LABELS`/`ENTITY_TYPE_LABELS` maps had fallen out of sync with `@Audit()` calls added by later phases (loan.delete, payment.registerBulk, client.setMessageFrequency/clearMessageFrequency, user.updatePermissions, clientLoanImport.execute) — each fell through to its raw dev-facing string in both `AuditLogsPage.tsx`'s table and `AuditLogDrawer.tsx`'s detail view. No new "labeled shape" from the backend was needed (see `docs/phases/PHASE_32_UI_FIXES.md`) — fixed by backfilling the six missing entries into the existing map.
- **"0 enviados" — confirmed as a straight removal**, not a bug to fix: `GET /message-logs`'s pagination total is correct (verified backend-side); a sent-count just has no place on a page that's meant to only ever surface failures (already this page's own stated purpose, per its header comment). Removed the `sentCount` query and its "Enviados" `Legend` entirely; kept "Fallidos".
- **Liquidar crédito already had a confirmation dialog** (`PayoffDialog.tsx` — breakdown table + "Cancelar"/"Confirmar liquidación"), contrary to this doc's original assumption. Confirmed with the human: added a second, explicit "¿Estás seguro? Esta acción no se puede deshacer" step behind the existing confirm button rather than treating the item as already done.
- **Sequential payment buttons — only the single-payment "Pagar" button is gated on the frontend** (enabled only for the one installment that's actually payable right now, i.e. the parent's already-computed `oldestPending`). The bulk "Pagar seleccionadas" checkboxes were intentionally left ungated in the UI (not asked for) — the extended backend rule (see `docs/phases/PHASE_32_UI_FIXES.md`) still rejects an out-of-order bulk submission with a clear error, which is the defense-in-depth layer that actually matters.

## Scope

- [x] **Sequential payment buttons:** disable/hide an installment's "pagar" button while any earlier-numbered installment on the same loan is still pending — matches the new backend rule, so the UI never even offers an action the API would reject.
- [x] **Loan detail action buttons:** fix the layout so buttons don't resize or break when there are many of them (flagged as breaking with a realistic number of actions) — wrap or scroll, don't let button count shrink individual button size unpredictably. (Header row and button group now wrap via `flex-wrap`; each button is `shrink-0 whitespace-nowrap`.)
- [x] **Audit log detail:** render the movement detail view's fields legibly instead of showing a raw/unreadable code — consume whatever labeled shape the backend fix (Phase 32, api) produces. (Turned out to be a self-contained frontend fix — see above.)
- [x] **Message history:** remove the "0 enviados" counter/label — list should surface failures, not a permanently-inaccurate sent count.
- [x] **Amortizador panel** — grid/borders and sizing fix belongs to `docs/phasesClient/PHASE_23_DYNAMIC_CHARGES.md`, not duplicated here.
- [x] **Liquidar crédito:** add a confirmation dialog before calling `POST /loans/:id/payoff` — the action currently has none. (Extended the existing dialog with a second explicit step — see above.)
- [x] **Rename "Cotizador" → "Proyector rápido"** everywhere it appears in the UI (menu, page title, breadcrumbs). Route path `/cotizador` left unchanged, matching Phase 31's precedent of not renaming URL slugs for copy-only changes.

### Tests (per `docs/TESTING.md` conventions for this app)
- [x] Payment buttons correctly disable/enable per installment order. (Manual verification — no frontend component tests, per `docs/TESTING.md`'s scope for this app.)
- [x] Loan detail buttons remain usable and don't visually break with a realistic number of actions. (Manual verification.)
- [x] Liquidar crédito requires confirmation before proceeding. (Manual verification.)
- [x] `auditLogLabels.spec.ts` added — the one exception to this app's "no unit tests" default, since `formatAuditAction`/`formatAuditEntityType` are pure functions and this is exactly the kind of regression (a silently-stale translation map) worth pinning down.

## Definition of done for this phase

- [x] Every item above is fixed with no visual regression elsewhere in the loan section.
- All items in `docs/DEFINITION_OF_DONE.md` checklist pass.

## Related documents

- `docs/phases/PHASE_32_UI_FIXES.md` — matching backend fixes this phase depends on
- `docs/phasesClient/PHASE_23_DYNAMIC_CHARGES.md` — amortizador visual fixes, tracked there instead
