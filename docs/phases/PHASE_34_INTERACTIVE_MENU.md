# Phase 34 — Interactive Buttons and Self-Service Menu

## Goal

Give every template that carries Quick Reply buttons (Templates 4 through 8, per `docs/phases/PHASE_33_MESSAGE_TEMPLATES_V2.md`) a real, working tap-to-action flow, and add a free-standing self-service menu a client can reach at any time by texting in. This is the work `docs/phases/PHASE_22_WHATSAPP_WEBHOOK.md` explicitly left blocked pending a "how many menus" answer from the client — that answer now exists (captured below) and this phase builds it.

## Why this phase is separate from Phase 33

Phase 33 gets the actual message catalog sending correctly; this phase is everything that happens *after* a client taps a button or texts in unprompted, which needs a genuinely new piece of infrastructure (per-conversation state) that Phase 33 doesn't touch. Depends on Phase 33 being done first — buttons only exist on templates Phase 33 builds.

## Source of truth

Same original working doc as Phase 33 — the button-flow and menu behavior sections are transcribed here in full, since that doc is not part of this repo.

Required reading: `docs/phases/PHASE_22_WHATSAPP_WEBHOOK.md` in full (especially its four open questions — this phase's job is to close them), `docs/phases/PHASE_33_MESSAGE_TEMPLATES_V2.md`, `docs/phases/PHASE_27_MESSAGE_FREQUENCY.md` (per-client messaging preference, likely intersects), and the current code: `apps/api/src/whatsapp/webhook/whatsappWebhook.service.ts`, `whatsappWebhook.controller.ts`, `whatsappInbound.gateway.ts`, `entities/whatsappInboundMessage.entity.ts`. Note the existing "Enviar menú de prueba" / auto-reply-to-"2" behavior in `whatsappWebhook.service.ts` (commit `9ad5891`) is explicitly **TEST-ONLY scaffolding** built to exercise the inbox before this phase existed — it gets replaced, not extended, by the real menu below.

## Resolved — confirmed by the client, captured here verbatim

### Buttons on Templates 4–8, and what each one does

Quick Reply buttons attached directly to the static templates that need them (4, 5, 6, 7, 8) — the client can act with one tap, no typing required. Templates 1, 2, 3, 9, and 10 have no buttons, as decided.

**Why "Ver mis cuotas" isn't redundant on Template 4**, even though that message already names the one installment that's due: the button doesn't repeat what the message says — it shows the **full breakdown of every installment the client has** (past, that one, and future ones), a wider view than the one specific cuota. Worth including even when the message is already self-explanatory.

Each button is a **terminal point** of the automatic flow — each ends differently, none of them chain into another automatic action:

- **"Ver mis cuotas" / "Ver desglose"** (same mechanism, different label depending on context): the system generates and sends a free-text message with the full installment breakdown. At the end of that message, attach one button, **"Volver al menú"**, so the client can keep navigating without retyping anything.
- **"Ya pagué" / "Enviar comprobante"**: the bot replies asking for a photo or PDF of the receipt. When the client sends it, it enters the operator review queue (the existing inbound-message inbox from Phase 22), and the bot confirms with a short message: *"Recibimos tu comprobante, un asesor lo revisará en breve."* No "Volver al menú" here — the natural next step is waiting for the operator, not further navigation.
- **"Hablar con asesor"**: the bot notifies the operator (opens the human-attention queue) and replies with something like *"En un momento un asesor te contactará."* Also no "Volver al menú" — the conversation is now a human's to handle, and the bot continuing to offer automated options would get in the way.

### Self-service dynamic menu

Triggered when a client sends any free-text message **without** having just tapped a button, or when they tap "Volver al menú" from any of the flows above.

**Main menu — 3 flat options:**

```
Hola, bienvenido a IMPROCRÉDITO. Selecciona una opción:
```
Buttons: **Mi cuenta** — **Reportar un pago** — **Hablar con asesor**

Implemented as **Reply Buttons** (not a List Message) — exactly 3 options fits WhatsApp's 3-button limit for Quick Reply without needing the list-with-sections mechanism. Sent as a **session message inside the already-open 24h window** (the client just texted in, which opens/keeps open that window) — same as every other interactive message here, no Meta template approval needed for this one.

**If "Mi cuenta" is tapped:** a second Reply Buttons message with the agreed sub-options:

```
Selecciona qué deseas consultar:
```
Buttons: **Estado de cuenta** — **Cuotas pendientes** — **Historial de pagos**

Every option reuses a mechanism already designed elsewhere, none of these are new flows: "Estado de cuenta" and "Cuotas pendientes" use the same breakdown mechanism as "Ver mis cuotas"; "Reportar un pago" uses the same flow as "Ya pagué"; "Hablar con asesor" uses the same human handoff. "Volver al menú" (offered after any of these actions) always returns to the 3-option **main** menu, never to the "Mi cuenta" submenu.

### Required technical piece: per-conversation state

"Volver al menú" going back to the *right* menu requires the backend to remember which screen each client is currently on during the conversation — WhatsApp itself keeps no such state; every inbound message arrives independent of the last. Needs a simple per-phone-number state that updates on every tap and expires with the 24h session window.

## Scope

### Entities and migrations

- [x] `WhatsappConversationState` (new): `id`, `phoneNumber` (unique — one active state per number, upsert on every interaction), `clientId` (FK → `clients.id`, nullable, same "log even if unrecognized" convention as `WhatsappInboundMessage`), `currentMenu` (ENUM: `main`, `mi_cuenta_submenu`, `awaiting_receipt` — a distinct third value, not the `none`/null this doc originally described; see "Technical decisions" below), `expiresAt` (TIMESTAMPTZ — set to now + 24h on every write, matching Meta's session window), `createdAt`, `updatedAt`. No soft delete — ephemeral; expired rows are ignored by query (`getActive`), not cleaned up by a job — the simplest of this section's original options, revisit if row volume ever becomes a real concern.
- [x] Migration `CreateWhatsappConversationStatesTable`.
- [x] `WhatsappInboundMessage`'s existing `button_payload` column is sufficient — no separate payload lookup table was needed. `extractInboundEvents.ts` (Phase 22) already normalizes both button shapes (template quick-reply `type: "button"` and session `type: "interactive"/"button_reply"`) into the same `buttonPayload` string, so the dispatcher doesn't need to know which shape a tap arrived as.

### Service and API

- [x] Button-payload → action resolution (`SelfServiceMenuService.buttonActionFor`), replacing the TEST-ONLY logic in `whatsappWebhook.service.ts`: a fixed in-code mapping (per this doc's original scope — no admin-editable catalog) from each payload to one of: send breakdown + "Volver al menú", start receipt-collection flow, notify operator/open human queue, or advance `WhatsappConversationState.currentMenu` and send the next Reply Buttons message. The **menu-defined** payloads (`selfServiceMenuPayloads.ts`'s `SelfServiceMenuButtonId`) are fully wired and working. The **template-defined** payloads (Templates 4-8's own buttons, `TemplateButtonPayload`) are still placeholder strings — see Open questions, unchanged — so a tap on a template's own button is currently a no-op; the free-text-triggered menu below is unaffected.
- [x] Breakdown message composer ("Ver mis cuotas" / "Estado de cuenta" / "Cuotas pendientes") — reuses `messageRenderer.ts`'s `renderAccountSummaryMessage`/`AccountSummaryInstallmentForMessage`, left over from the retired (Phase 33) `account_summary` type, via a new query helper (`breakdownQueries.ts`, adapted from the deleted `AccountSummaryService`). "Historial de pagos" is a new composer (`renderPaymentHistoryMessage`) over a new `findPaymentHistoryForClient` query, capped at the 10 most recent payments. Each ends with the "Volver al menú" button, sent as a **separate short interactive message** — see "Technical decisions" below.
- [x] Receipt-collection flow ("Ya pagué" / "Enviar comprobante" / "Reportar un pago"): bot prompt → client sends media → persisted via the existing inbound-message pipeline (Phase 22, unchanged) → bot's short confirmation reply once a media/document event arrives while `currentMenu = awaiting_receipt`. The operator review queue *is* Phase 22's inbox — the media was already durably logged there before this phase existed, nothing new needed on that side. No "Volver al menú" appended.
- [x] Human handoff ("Hablar con asesor"): replies with the fixed acknowledgment text, no "Volver al menú" appended. Operator notification uses the simplest option from Open questions below — visible in the existing inbound inbox (already pushed live via `WhatsappInboundGateway`, Phase 22), no separate channel — a technical default, not a guess at the open business question; swap for a dedicated alert later if wanted.
- [x] Main-menu dispatch: any inbound free-text message with no matching button payload, when there's no active `WhatsappConversationState` (or it's expired), sends the 3-option main menu and creates/refreshes the state row.
- [x] "Volver al menú" always resets `currentMenu` to `main` and sends the main menu, regardless of which submenu the tap came from.
- [x] `WhatsappConversationState` upsert on every menu-navigation event, `expiresAt` refreshed to now + 24h each time. A terminal action with no menu of its own (breakdown/history/handoff/receipt-received) clears the state row instead of upserting it — functionally equivalent for "Volver al menú" (always forces `main` regardless of prior state) and for a stray follow-up text (no state ⇒ main menu, same outcome as state = `main`).

### Tests (mandatory)

- [x] Each of the terminal button actions (breakdown, payment history, receipt flow, human handoff) fires from its menu button and ends the flow with/without "Volver al menú" exactly as specified — `selfServiceMenu.service.spec.ts`.
- [x] Main menu → "Mi cuenta" → submenu → each submenu action correctly reuses the underlying mechanism (breakdown / receipt flow) and "Volver al menú" from a submenu action returns to the **main** menu, not the submenu.
- [x] An inbound free-text message with no active/unexpired conversation state triggers the main menu; one with a still-active state and no matching button payload re-sends the current menu (main, submenu, or the receipt request, whichever `currentMenu` says) rather than resetting to the main menu or routing to a human.
- [x] `WhatsappConversationState` expiry: `getActive` returns `null` for an expired row, same as no row at all — `whatsappConversationState.service.spec.ts`.
- [x] `WhatsappWebhookService.persistEvent` dispatches to the menu only for a known client, and a menu-handling failure never breaks the "always ack, always log" contract — `whatsappWebhook.service.spec.ts`.

### Swagger

- [x] No new public-facing REST endpoints — confirmed, this phase is entirely webhook-driven (`WhatsappWebhookService.persistEvent` → `SelfServiceMenuService`), nothing beyond what Phase 22 already documents.

## Technical decisions — judgment calls, not business guesses

- **`awaiting_receipt` is a real third `currentMenu` value**, not the `none`/null this doc originally sketched for the mid-receipt-flow state. Reusing null for both "no conversation at all" and "waiting on a receipt" would make a stray text message during the receipt flow indistinguishable from a brand-new conversation, incorrectly re-showing the main menu instead of re-asking for the receipt.
- **The breakdown/history messages send their "Volver al menú" button as a separate follow-up message**, not attached to the same message. WhatsApp interactive messages cap the body at 1024 characters — too tight for a breakdown that can run to many installments — so the plain-text breakdown (no such cap) goes first, then a short second interactive message with just that one button.
- **Admin notification for "Hablar con asesor" is the existing inbound inbox only**, no separate channel — see Scope above. This is the minimum-build default, explicitly reversible; it does not answer Phase 22's open question, it just unblocks this phase without guessing a new mechanism.

## Resolved — confirmed by the human (2026-09-01)

- **A free-text message that doesn't match any menu option while a `WhatsappConversationState` is still active** (client types something random mid-menu): **re-send the current template/menu** — i.e. re-show whatever menu (main or "Mi cuenta" submenu) the client's state says they're currently on, rather than falling through to the main menu or routing to a human. Doesn't change `currentMenu`, just repeats the prompt.

## Open questions

- [ ] **Still blocking — exact Quick Reply button payload strings** configured in Meta for Templates 4-8. The webhook's `button.payload` must match these exactly (`TemplateButtonPayload` in `selfServiceMenuPayloads.ts`) for a tap on a *template's own* button to trigger anything — currently placeholder strings, so those taps are no-ops. Does **not** block the menu itself: the main menu, "Mi cuenta" submenu, and all their buttons are the backend's own payload strings (not Meta's) and are fully working today, triggered by free text. Confirm via `GET .../message_templates?fields=name,components` once the templates are visible in Meta (approved or still pending), swap the three values in `selfServiceMenuPayloads.ts` — nothing else needs to change.
- [x] **Cleanup of expired `WhatsappConversationState` rows** — resolved: left to grow, filtered by `expiresAt` in `getActive()` (the simplest option). Revisit if row volume ever becomes a real concern.
- [x] **The admin notification mechanism for "Hablar con asesor"** — resolved with the minimum-build default: visible in the existing inbound inbox only (Phase 22's `WhatsappInboundGateway`), no separate channel. `PHASE_22_WHATSAPP_WEBHOOK.md`'s question #4 is still open for anything beyond that default — swap in a dedicated alert (badge, WhatsApp-to-admin, email) later without needing to touch this phase's other flows.
- [ ] **Does tapping "No" to any future opt-in-style prompt persist as a standing preference?** Not directly triggered by anything in this phase's menu (no opt-out button exists in the menu flow itself), but flagged since `PHASE_22_WHATSAPP_WEBHOOK.md`'s question #2 about this is still open and the promotional-image message in Phase 33 (itself confirmed not yet built) would carry a "no recibir más promocionales" button — confirm where that specific opt-out is stored, likely intersecting `docs/phases/PHASE_27_MESSAGE_FREQUENCY.md`'s per-client frequency table.

## Definition of done for this phase

- [ ] **Still open** — Templates 4-8's own buttons don't trigger anything yet (blocked on the real Meta payload strings, see Open questions). The same underlying actions are fully working when reached through the free-text menu instead.
- [x] The main menu and "Mi cuenta" submenu work end-to-end (unit-tested end-to-end through `SelfServiceMenuService`), including correct "Volver al menú" targeting. Not yet exercised against a real WhatsApp conversation — do that once Meta template review clears enough to have a live 24h window to test in.
- [x] Conversation state correctly tracks and expires per phone number.
- [x] `docs/phases/PHASE_22_WHATSAPP_WEBHOOK.md`'s open questions #1 (menu shape), #3 (unprompted-message handling), and #4 (admin notification) are updated with this phase's answers. Question #2 (does a "no" persist as a standing preference) remains genuinely open — nothing in this phase's scope resolves it.
- [ ] **Deliberately not done** — the TEST-ONLY `sendTestMenu`/`TEST_MENU_MESSAGE` scaffolding from commit `9ad5891` is still in place, not replaced. Its "Enviar menú de prueba" button lives in `apps/client`, owned by a different developer — removing the backend method now would 404 that button without coordinating the removal on their side first. Flag to the human before ripping it out.
- [ ] Every open question above has a recorded, confirmed answer before its dependent scope item is built. (One exception, explicit: Templates 4-8's button payloads — everything *not* depending on them was built ahead of that answer, per this session's judgment call to unblock the rest of the phase.)
- [ ] All items in `docs/DEFINITION_OF_DONE.md` checklist pass — not yet self-checked against that full list; do before opening a PR.

## After this phase

Update `docs/phases/PHASE_22_WHATSAPP_WEBHOOK.md` with a "Resolved" section closing its four open questions, referencing this phase. Update `docs/DATABASE.md` with the new `whatsapp_conversation_states` table. Update `docs/GLOSSARY.md` with "Menú de autoservicio" / "Estado de conversación" entries. Check whether `apps/client`'s existing inbound-message inbox (`docs/phasesClient/PHASE_22_WHATSAPP_WEBHOOK.md`) needs any UI addition to show which menu a client is currently on, or a visible "waiting for asesor" queue — likely a small follow-up for the client-side developer, not necessarily part of this phase's own scope.

## Related documents

- `docs/phases/PHASE_22_WHATSAPP_WEBHOOK.md` — the inbound infrastructure and open questions this phase resolves
- `docs/phases/PHASE_33_MESSAGE_TEMPLATES_V2.md` — the template catalog whose buttons this phase wires up
- `docs/phases/PHASE_27_MESSAGE_FREQUENCY.md` — likely intersects with any opt-out/preference persistence
- `docs/phasesClient/PHASE_22_WHATSAPP_WEBHOOK.md` — existing client-side inbox this phase's flows feed into
