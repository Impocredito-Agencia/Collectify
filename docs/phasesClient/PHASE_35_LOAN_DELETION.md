# Phase 35 — Irreversible Loan Deletion With Audit Trail (Client)

## Goal

The panel side of `docs/phases/PHASE_35_LOAN_DELETION.md` — **read its "Resolved" section first**, every rule there applies here. A deliberately heavy, red, two-step deletion an admin can't click through by accident, plus a read-only way for anyone to look up a deleted pagaré afterwards.

## Scope

### Deleting (admin only)
- [x] "Eliminar préstamo" on the loan detail page: shown only to admins, only on an active loan. No longer disabled when the loan has payments.
- [x] **Step 1** — red warning box, filled from `GET /loans/:id/deletion-preview`:
  - what gets deleted: the pagaré, plus "se eliminarán también los pagarés #X, #Y de esta cadena" when it came from a refinance;
  - how many cuotas, how many payments and for how much ("estos pagos quedarán anulados");
  - saldo a favor: "se le devolverán $X de saldo a favor a <cliente>" / "se descontarán $Y del saldo a favor de <cliente>";
  - **mandatory reason** field;
  - any blocker shown here in red (e.g. "el saldo a favor que generó este pago ya se usó en la cuota 3 del pagaré #0800 — anula ese pago primero"), with "Continuar" disabled.
- [x] **Step 2** — "Esta acción es permanente y no se puede deshacer." in red; the admin types the pagaré number; the red "Eliminar definitivamente" button only enables on a match. The number to type comes from the **preview fetched when the dialog opens**, not the page's cached loan, so a renumber done elsewhere is already reflected; matching ignores surrounding spaces and an optional leading `#`, same as the api.
- [x] On success, back to `/prestamos`. Any api rejection (a race since the preview) shown inline.

### Viewing (every user)
- [x] Préstamos page: new **"Eliminados"** tab — number, client, deleted at, deleted by, reason, had payments. Route `prestamos/eliminados/:id` for the detail; data from `GET /loans/deleted` / `GET /loans/deleted/:id` (see the api brief's "changed during implementation" notes).
- [x] Read-only detail of a deleted pagaré: red strip "Pagaré eliminado el <fecha> por <usuario> — Motivo: <motivo>"; the loan's data; cuotas from the frozen snapshot (cuota value **and** frozen mora, like the active-loan table); payments with their receipts and void reason; the other pagarés deleted with it. **No action buttons at all.**
- [x] Client profile loan list: deleted pagarés listed too, with a red "Eliminado" badge, linking to the read-only detail. Client figures (counts, amounts, cupo, debt) unchanged — they already exclude them server-side.
- [x] A deleted refinance chain is **one row** in both lists (the pagaré that was active when deleted), with "Refinanciado N veces" under its number — not one row per loan, which read as several unrelated debts (human feedback after local review, 2026-11-05). The detail page shows the whole chain in order ("Original → Refinanciación 1 → …"), telling same-numbered loans apart by position.
- [x] The read-only detail also shows "Condiciones con las que se creó el crédito" (rates, term, cuota, and any mora forgiven when it was created by a refinance) for it and every earlier loan of its chain — the same section as the live loan page (`LoanOriginationTermsView`).
- [x] "Eliminar préstamo" audit label shows the reason. (Built server-side: the `loan.delete` entityLabel is `Pagaré #X — motivo: …`.)
- [x] Creating/renumbering a pagaré with a number reserved by a deleted one: the 409 message now covers that case too ("…o perteneció a un pagaré eliminado que tenía pagos").

### Tests
- [x] Deletion dialog: "Continuar" disabled without a reason or with a blocker; final button disabled until the number matches (with or without `#`), never on a different number; preview figures rendered.
- [x] Deleted detail: renders the strip and frozen figures, renders no action button.

## Definition of done for this phase

- Deleting is impossible to do by accident and impossible to do without a reason.
- Anyone in the panel can find a deleted pagaré and see who deleted it, when, why and what it looked like at that moment.
- All items in `docs/DEFINITION_OF_DONE.md` pass.

## Related documents

- `docs/phases/PHASE_35_LOAN_DELETION.md` — the api counterpart and every confirmed rule
- `docs/phasesClient/PHASE_30_LOAN_CORRECTION.md` — the deletion dialog this replaces
