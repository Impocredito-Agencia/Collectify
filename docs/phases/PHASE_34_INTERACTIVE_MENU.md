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

- [ ] `WhatsappConversationState` (new): `id`, `phoneNumber` (unique — one active state per number, upsert on every interaction), `clientId` (FK → `clients.id`, nullable, same "log even if unrecognized" convention as `WhatsappInboundMessage`), `currentMenu` (ENUM: `main`, `mi_cuenta_submenu`, or `none`/null when there's no active menu context — e.g. mid-way through the "send your receipt" flow), `expiresAt` (TIMESTAMPTZ — set to now + 24h on every write, matching Meta's session window), `createdAt`, `updatedAt`. No soft delete — this is ephemeral, expired rows can be hard-deleted by a cleanup job or just ignored once past `expiresAt` (confirm cleanup approach — see Open questions).
- [ ] Migration `CreateWhatsappConversationStatesTable`.
- [ ] `WhatsappInboundMessage.type` enum may need a `button` sub-classification already exists (`button`, `text`, `other` per Phase 22) — confirm the existing `button_payload` column is sufficient to carry the new button payloads below, or whether the payload catalog needs its own lookup table (see Open questions on exact payload strings).

### Service and API

- [ ] Button-payload → action resolution, replacing the TEST-ONLY logic in `whatsappWebhook.service.ts`: a fixed mapping (in code, not admin-managed — the client did **not** ask for an admin-editable catalog, this is a small fixed set) from each button's payload to one of: send breakdown + "Volver al menú", start receipt-collection flow, notify operator/open human queue, or (main-menu-only) advance `WhatsappConversationState.currentMenu` and send the next Reply Buttons message. **Blocked until the real payload strings are provided** (see Open questions) — build everything else in this phase first.
- [ ] Breakdown message composer ("Ver mis cuotas" / "Ver desglose" / "Estado de cuenta" / "Cuotas pendientes" / "Historial de pagos") — reuses existing installment/payment query logic, doesn't recompute it; each ends with the "Volver al menú" button.
- [ ] Receipt-collection flow ("Ya pagué" / "Enviar comprobante" / "Reportar un pago"): bot prompt → client sends media → persisted via the existing inbound-message pipeline → operator review queue (Phase 22's inbox) → bot's short confirmation reply. No "Volver al menú" appended.
- [ ] Human handoff ("Hablar con asesor"): notifies the operator (mechanism TBD — see Open questions, this is Phase 22's still-unresolved "admin notification" question) and replies with the fixed acknowledgment text. No "Volver al menú" appended.
- [ ] Main-menu dispatch: any inbound free-text message with no matching button payload, when there's no active `WhatsappConversationState` (or it's expired), sends the 3-option main menu and creates/refreshes the state row.
- [ ] "Volver al menú" always resets `currentMenu` to `main` and sends the main menu, regardless of which submenu the tap came from.
- [ ] `WhatsappConversationState` upsert on every relevant inbound event, `expiresAt` refreshed to now + 24h each time.

### Tests (mandatory)

- [ ] Each of the 3 terminal button actions (breakdown, receipt flow, human handoff) fires from every template's button that offers it, and ends the flow with/without "Volver al menú" exactly as specified.
- [ ] Main menu → "Mi cuenta" → submenu → each submenu action correctly reuses the underlying mechanism (breakdown / receipt flow / handoff) and "Volver al menú" from a submenu action returns to the **main** menu, not the submenu.
- [ ] An inbound free-text message with no active/unexpired conversation state triggers the main menu; one with a still-active state and no matching button payload re-sends the current menu (main or submenu, whichever `currentMenu` says) rather than resetting to the main menu or routing to a human.
- [ ] `WhatsappConversationState` expiry: a tap/message after `expiresAt` behaves as if there were no prior state.

### Swagger

- [ ] No new public-facing REST endpoints expected (this is webhook-driven) — confirm nothing here needs documenting beyond what Phase 22 already covers.

## Resolved — confirmed by the human (2026-09-01)

- **A free-text message that doesn't match any menu option while a `WhatsappConversationState` is still active** (client types something random mid-menu): **re-send the current template/menu** — i.e. re-show whatever menu (main or "Mi cuenta" submenu) the client's state says they're currently on, rather than falling through to the main menu or routing to a human. Doesn't change `currentMenu`, just repeats the prompt.

## Open questions — still blocking, do not guess

- [ ] **Exact Quick Reply button payload strings** configured in Meta when each template (4–8) and the main/sub menus were created — the webhook's `button.payload` must match these exactly for the mapping above to work. **Confirmed pending** — the human doesn't have these on hand right now; do not guess placeholder strings, wait for them before implementing the payload → action mapping.
- [ ] **Cleanup of expired `WhatsappConversationState` rows** — a scheduled job, lazy deletion on next read, or just left to grow and filtered by `expiresAt` in queries (simplest, may be fine given the volume).
- [ ] **The admin notification mechanism for "Hablar con asesor"** — this is `PHASE_22_WHATSAPP_WEBHOOK.md`'s still-open question #4 (in-app badge/list, a WhatsApp message to the admin's own number, email, or just visible in the existing inbound log with no separate alert). Must be answered before this phase's human-handoff scope is built.
- [ ] **Does tapping "No" to any future opt-in-style prompt persist as a standing preference?** Not directly triggered by anything in this phase's menu (no opt-out button exists in the menu flow itself), but flagged since `PHASE_22_WHATSAPP_WEBHOOK.md`'s question #2 about this is still open and the promotional-image message in Phase 33 (itself confirmed not yet built) would carry a "no recibir más promocionales" button — confirm where that specific opt-out is stored, likely intersecting `docs/phases/PHASE_27_MESSAGE_FREQUENCY.md`'s per-client frequency table.

## Definition of done for this phase

- [ ] Every button on Templates 4–8 does exactly what's specified above, ending the flow correctly (with or without "Volver al menú").
- [ ] The main menu and "Mi cuenta" submenu work end-to-end, including correct "Volver al menú" targeting.
- [ ] Conversation state correctly tracks and expires per phone number.
- [ ] `docs/phases/PHASE_22_WHATSAPP_WEBHOOK.md`'s four open questions are updated with their now-confirmed answers.
- [ ] The TEST-ONLY auto-reply-to-"2" scaffolding from commit `9ad5891` is removed, replaced by the real menu.
- [ ] Every open question above has a recorded, confirmed answer before its dependent scope item is built.
- [ ] All items in `docs/DEFINITION_OF_DONE.md` checklist pass.

## After this phase

Update `docs/phases/PHASE_22_WHATSAPP_WEBHOOK.md` with a "Resolved" section closing its four open questions, referencing this phase. Update `docs/DATABASE.md` with the new `whatsapp_conversation_states` table. Update `docs/GLOSSARY.md` with "Menú de autoservicio" / "Estado de conversación" entries. Check whether `apps/client`'s existing inbound-message inbox (`docs/phasesClient/PHASE_22_WHATSAPP_WEBHOOK.md`) needs any UI addition to show which menu a client is currently on, or a visible "waiting for asesor" queue — likely a small follow-up for the client-side developer, not necessarily part of this phase's own scope.

## Related documents

- `docs/phases/PHASE_22_WHATSAPP_WEBHOOK.md` — the inbound infrastructure and open questions this phase resolves
- `docs/phases/PHASE_33_MESSAGE_TEMPLATES_V2.md` — the template catalog whose buttons this phase wires up
- `docs/phases/PHASE_27_MESSAGE_FREQUENCY.md` — likely intersects with any opt-out/preference persistence
- `docs/phasesClient/PHASE_22_WHATSAPP_WEBHOOK.md` — existing client-side inbox this phase's flows feed into
