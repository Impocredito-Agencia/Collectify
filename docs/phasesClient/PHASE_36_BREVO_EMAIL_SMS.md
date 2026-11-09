# Phase 36 — Email and SMS via Brevo (Client)

## Goal

The panel side of `docs/phases/PHASE_36_BREVO_EMAIL_SMS.md` — **read its stages and open questions first**. Delivered stage by stage, like the api.

## Stage 1 — Brevo card (`feature/brevo-service`)

On the **"Correo y SMS" sub-page** (`/plantillas/correo-sms`, reached from a "Correo y SMS" button next to the Plantillas page title; `message_templates` module, same gate as the endpoints). *Changed during stage 2 (human request, 2026-11-09):* both Brevo cards first sat at the top of Plantillas; they moved to their own sub-page so Plantillas looks exactly as before, plus the button. The sub-page holds:

- [x] **Status per channel** — "Correo" and "SMS": not configured / paused / active, plus the configured sender. Built only from `GET /brevo/status`; the API key never reaches the browser.
- [x] **Brevo account** — plan and remaining SMS credits, or the reason they couldn't be read (no API key, invalid key, Brevo unreachable).
- [x] **Test send** — choose Correo or SMS, type an email or a phone, send. Shows the result inline: sent (with Brevo's message id), or why not (paused and not in the test list, not configured, no credits, invalid key…), in plain Spanish. The SMS option warns that it spends one credit.
- [x] Audit log label for `brevo.testSend`.

## Stage 2 — Email and SMS templates (`feature/brevo-channel-templates`)

A "Plantillas de correo y SMS" card on the same sub-page, below the Brevo card:

- [x] The 18 message types grouped by trigger (nuevo pagaré, próximas a vencer, vencidas, Datacrédito, pagos), each a compact card (3 per row on wide screens, 2 on medium, 1 on mobile) with "Correo" and "SMS" buttons and the SMS's estimated credits.
- [x] Editor (modal): subject + body for email, body for SMS. The available values are listed with their meaning and an example; a click inserts `{{n}}` at the cursor. Invalid placeholders are flagged and block saving.
- [x] Live preview with the example values: email rendered as the client sees it (bold, paragraphs — React elements, never injected HTML); SMS exactly as it will go out (accents dropped), with its length and credits ("2 créditos por envío"), green/yellow/red.
- [x] "Probar esta plantilla": sends the saved version with the example values; disabled while there are unsaved changes.
- [x] Plantillas keeps its original subtitle and layout; only the "Correo y SMS" button is added — solid Publi Mark blue (new `brandBlue` Button variant) with an envelope icon, so it isn't missed. The sub-page has a "Plantillas / Correo y SMS" breadcrumb back.
- [x] Audit log labels for `messageChannelTemplate.update` / `messageChannelTemplate.testSend`.
- [x] Tests: SMS counter and GSM-7 conversion (same cases as the api), placeholder fill/validation, bold/paragraph split, every type listed exactly once.

Later stages add: channel column/filter in Mensajes and client channel preferences (stage 3), delivery status and "correo rebotado" (stage 4), low-credit alert (stage 6).

## Definition of done for this stage

- An admin can see whether email and SMS are ready and send a real test email from the panel.
- All items in `docs/DEFINITION_OF_DONE.md` pass.
