# Phase 22 — Interactive Templates and Inbound WhatsApp Webhook

## Goal

Give Collectify its first-ever ability to *receive* WhatsApp traffic instead of only sending it — a verified inbound webhook — and let a template message include quick-reply buttons (e.g. "¿quieres recibir el estado de tus cuentas? [Sí] [No]") so tapping one automatically triggers the right follow-up message and notifies the admin. Also covers a client texting in on their own initiative, unprompted by any button.

**Priority: highest and most urgent of everything documented in this round** — confirmed directly with the human as the phase to tackle first, ahead of `docs/phases/PHASE_23_DYNAMIC_CHARGES.md` onward.

## Why this didn't exist before now

Every prior WhatsApp phase (`docs/phases/PHASE_5_WHATSAPP.md`, `PHASE_9_MESSAGE_TYPES.md`, `PHASE_18_MESSAGE_AUDIENCES.md`) was deliberately send-only — Collectify never configured a webhook because there was nothing incoming to handle. This phase is the first time that changes, so treat every piece of it as new surface, not an extension of an existing pattern.

## Domain research (informational — grounds the phase, doesn't replace confirmation below)

- A WhatsApp **template** can include up to **3 Quick Reply buttons**. Each button has a developer-defined `payload` string and a display `text`. Templates with buttons go through the same Meta approval process as plain-text ones (see the "message templates" domain research already captured in `docs/DATABASE.md`'s "Changed after Phase 9" section and `docs/GLOSSARY.md`'s "Message template" entry — both reference a `CONFIGURACION_WHATSAPP_META.md` file that does not actually exist in this repo; that's a pre-existing dangling reference from before this phase, not something this document repeats).
- When a recipient taps a template's quick-reply button, Meta delivers a webhook event of `type: "button"`, carrying `button.payload` (the id you defined) and `button.text` — this is a **different** payload shape from the `type: "interactive"` / `button_reply` events used by *session* interactive messages (sent free-form within an open 24h window, not via a template). Confirm the exact shape against Meta's real payload during implementation rather than assuming which of the two applies — both may need handling if this phase later also sends session-based interactive messages.
- **More than 3 options in one message requires a List Message**, which is an *interactive session message*, not a template — meaning it can only be sent inside an already-open 24h customer service window (started by the client messaging first), never as a cold business-initiated send. This directly bounds what "cuántos menús" can mean for a message sent cold vs. one sent as a follow-up inside an open window (see open questions below).
- Once a client sends *anything* inbound (a button tap or free text), Meta opens a 24h customer-service window during which Collectify can freely send session (free-form, non-template) messages back — the same 24h rule that already governs outbound sends, now relevant on the receiving side too, and worth keeping in mind (a follow-up after a button tap can be a richer session message, not necessarily another template).
- The webhook endpoint is necessarily public and unauthenticated by JWT (Meta calls it directly) — its only real defense is verifying Meta's `X-Hub-Signature-256` header against the app secret. This is a deliberate, singular exception to this project's normal `@Public()`-is-rare convention, and must not be treated as a precedent for any other endpoint.

## Open questions — confirm with the human before finalizing behavior (do not guess any of these)

The human explicitly asked for these to be left open rather than decided here:

- [ ] **How many "menus" can exist, and how are they organized?** i.e., is this one fixed set of buttons reused everywhere, or an admin-managed catalog of button-flows (à la `interest_concept_types`'s admin-managed catalog) that can grow over time? If it's a catalog, does a "menu" mean one template's up-to-3 buttons, or a multi-step flow (a button tap reveals another set of buttons)? Multi-step flows change the data model materially — they need a way to represent "this button leads to that next menu," not just "this button triggers that message."
- [ ] **How much information does a client want (or not want) to receive, and does that choice persist?** If a client taps "No" to "¿quieres recibir el estado de tus cuentas?", does that: (a) just skip sending it this one time, (b) set a standing preference that suppresses future account-summary offers to that client, or (c) something broader — an actual per-client opt-out of one or more message *types* entirely (relates directly to `docs/phases/PHASE_27_MESSAGE_FREQUENCY.md`'s per-client frequency whitelist — a "No" answer may belong in that same table/mechanism rather than a separate one). Given WhatsApp's own policy expects businesses to honor a recipient's stated preference, this isn't a cosmetic detail — confirm it explicitly.
- [ ] **Client-initiated, unprompted messages** — a client can text in without ever having been sent a button. What should Collectify do with that? At minimum it must be received and logged rather than silently dropped (in scope for this phase, see below); whether it also triggers an automated reply (e.g. "gracias, un asesor te contactará"), routes to a specific admin action, or is purely informational for now is not decided and must not be guessed.
- [ ] **The admin notification itself** — in-app (a list/badge in the panel), a WhatsApp message to the admin's own number, email, or simply "visible in the existing message/inbound log, no separate alert"? Affects whether this phase needs a new notification channel or just a query-able log.

## Required reading before starting

`docs/phases/PHASE_5_WHATSAPP.md`, `docs/phases/PHASE_9_MESSAGE_TYPES.md` (the outbound model this phase's triggered follow-ups reuse), `docs/DATABASE.md`'s "Changed after Phase 9" section (the 24h window / template rules this phase's receiving side interacts with), `docs/DATABASE.md` (`message_templates`, `message_logs`).

## Scope

Split into what's mechanically clear regardless of the open questions above, and what's blocked on them.

### Not blocked — build regardless of how the open questions resolve

#### Entities and migrations
- [x] `WhatsappInboundMessage`: `id`, `client_id` (FK → `clients.id`, nullable — an inbound message from an unrecognized phone number is still logged, not dropped), `from_phone_number` (VARCHAR, as received), `type` (ENUM: `button`, `text`, `other`), `button_payload` (VARCHAR, nullable), `body_text` (TEXT, nullable), `raw_payload` (JSONB — the full webhook event, for debugging/replay), `received_at`, `created_at`. Append-only, no `updated_at`/`deleted_at` — same convention as `message_logs`/`audit_logs`.
- [x] Migration `CreateWhatsappInboundMessagesTable`.
- [x] New env vars: `META_WHATSAPP_WEBHOOK_VERIFY_TOKEN` (handshake secret, admin-chosen), `META_WHATSAPP_APP_SECRET` (from the Meta app, used for `X-Hub-Signature-256` verification) — added to `.env.example` and `docs/ENVIRONMENT_VARIABLES.md`.

#### Service and API
- [x] `GET /api/v1/whatsapp/webhook` (`@Public()`) — Meta's verification handshake: validate `hub.verify_token` against `META_WHATSAPP_WEBHOOK_VERIFY_TOKEN`, echo back `hub.challenge` as plain text on match, `403` otherwise.
- [x] `POST /api/v1/whatsapp/webhook` (`@Public()`) — verify `X-Hub-Signature-256` (HMAC-SHA256 of the raw body against `META_WHATSAPP_APP_SECRET`) before touching the payload at all; reject with `403` on mismatch. On success: parse the event, resolve `client_id` by normalizing the sender's phone number and matching against `clients.phone_number` (must handle Meta's number format, typically without a leading `+`, against the app's stored `+E.164` format — do not assume they already match), persist a `WhatsappInboundMessage` row, and respond `200` quickly (Meta expects a fast ack; any slow processing — like the button-triggered follow-up send — should not block the response).
- [x] `GET /api/v1/whatsapp/inbound-messages` (admin-only) — paginated list backing the panel's inbox, filterable by `clientId`/`type`, searchable by the matched client's name. Not originally itemized in this doc; added once the frontend's "not blocked" log view needed something to read from.
- [x] `WhatsappInboundGateway` (`whatsapp-inbound` Socket.IO namespace, admin-only) — pushes every newly persisted inbound message live to the panel. Built ahead of the button-flow catalog below, at the human's explicit request (2026-08-27), as infrastructure a future human-handoff/live-reply flow will also need — see `docs/phasesClient/PHASE_22_WHATSAPP_WEBHOOK.md`'s "Noted for later" section.
- [ ] Button-payload → action resolution: once the "how many menus" open question is resolved, build the admin-configurable mapping it implies (most likely a new small entity linking a button payload to a triggerable action, e.g. `send_account_summary`) and execute it asynchronously after acking the webhook.

#### Tests (mandatory)
- [x] Webhook verification handshake: correct token echoes the challenge; incorrect token is rejected.
- [x] Signature verification: a request with a valid signature is processed; one with an invalid/missing signature is rejected before any parsing happens.
- [x] An inbound message from a known client's phone number resolves `client_id` correctly, including the format-normalization case; one from an unrecognized number is still logged with `client_id: null`.
- [x] `WhatsappInboundMessage` rows are never lost even when the payload is malformed/unexpected — log what can be parsed, never throw an unhandled error back to Meta.
- [x] `WhatsappInboundGateway.handleConnection` accepts an active admin with a valid access token and rejects everything else (missing token, invalid token, wrong token type, non-admin role, deactivated admin).

#### Swagger
- [x] Webhook endpoints documented, including the explicit note that they're the one deliberate `@Public()` exception in this controller and why.

### Blocked on the open questions above — do not build ahead of confirmation

- [ ] The button-flow/"menu" catalog's exact shape (single-level vs. multi-step).
- [ ] Whether a "No" response (or any inbound signal) persists as a standing client preference, and where that's stored — likely intersects with `docs/phases/PHASE_27_MESSAGE_FREQUENCY.md`.
- [ ] Any automated handling of unprompted free-text messages beyond logging them.
- [ ] The admin notification mechanism.

## Definition of done for this phase

- The webhook is verified and reachable from Meta in a real (not just local) environment, with signature verification actually enforced.
- Every inbound WhatsApp event — button tap or free text, from a known or unknown number — is received and durably logged, never silently dropped.
- Every open question above has a recorded, confirmed answer (updating this document, matching the "Resolved" pattern used elsewhere) before the blocked scope items are built.
- All items in `docs/DEFINITION_OF_DONE.md` checklist pass.

## After this phase

Update `docs/DATABASE.md` with the new `whatsapp_inbound_messages` table (and any button-action table the resolved open questions require), `docs/ENVIRONMENT_VARIABLES.md` with the two new env vars, and `docs/GLOSSARY.md` with an "Inbound message" / "Menu de botones" entry once the terminology is settled.

**Partial update, Phase 33**: the TEST-ONLY "reply 2 → send account summary" auto-trigger (`WhatsappWebhookService.maybeTriggerTestMenuAction`) was removed, since it depended on `account_summary`, which Phase 33 retired outright. The rest of the TEST-ONLY scaffolding (`sendTestMenu` / `TEST_MENU_MESSAGE`, and the "Enviar menú de prueba" button on the client) was deliberately left in place — it's still used by the panel and doesn't depend on anything Phase 33 removed. The four open questions below remain genuinely open — Phase 33 only reworked the template catalog these future button flows will attach to (`docs/phases/PHASE_33_MESSAGE_TEMPLATES_V2.md`), it doesn't answer them.

**Update, Phase 34** (`docs/phases/PHASE_34_INTERACTIVE_MENU.md`): three of the four open questions below are now resolved —

- **How many menus / how organized** → one fixed, in-code set (not an admin-managed catalog, matching this doc's own guess that the client didn't ask for one): a flat 3-option main menu, one submenu under "Mi cuenta", no deeper nesting.
- **Client-initiated, unprompted messages** → for a client who resolves to a known `Client` record, an unprompted free-text message now gets the main menu automatically (`SelfServiceMenuService`). An unrecognized phone number is still only logged, per this phase's original minimum — Phase 34 didn't extend automated handling to that case.
- **The admin notification itself** → the minimum-build default: visible in the existing inbound inbox (this phase's own `WhatsappInboundGateway`), no separate channel. Explicitly reversible if the human wants a dedicated alert later.

**Still open**: whether a "No" (or any inbound signal) persists as a standing per-client preference — not touched by Phase 34, still intersects `docs/phases/PHASE_27_MESSAGE_FREQUENCY.md` as originally noted below.

**TEST-ONLY scaffolding removed** (2026-09-02, explicit human request): `WhatsappWebhookService.sendTestMenu`/`TEST_MENU_MESSAGE` and the `POST /whatsapp/clients/:clientId/send-test-menu` endpoint are gone — the real menu (Phase 34) replaces it. **`apps/client`'s "Enviar menú de prueba" button (`ClientDetailPage.tsx`) now calls a removed endpoint and will 404** — that's a frontend follow-up for the client-side developer, not done here per this repo's "don't modify `apps/client`" rule.

## Related documents

- `docs/phases/PHASE_5_WHATSAPP.md`, `docs/phases/PHASE_9_MESSAGE_TYPES.md` — the outbound model whose services this phase's triggered follow-ups call into
- `docs/phases/PHASE_27_MESSAGE_FREQUENCY.md` — likely intersects with the "does a preference persist" open question
- `docs/DATABASE.md` (including its "Changed after Phase 9" section — the 24h window and template-approval rules this phase's receiving side interacts with), `docs/ENVIRONMENT_VARIABLES.md`, `docs/GLOSSARY.md`
