# Phase 36 — Email and SMS via Brevo (Client)

## Goal

The panel side of `docs/phases/PHASE_36_BREVO_EMAIL_SMS.md` — **read its stages and open questions first**. Delivered stage by stage, like the api.

## Stage 1 — Brevo card (`feature/brevo-service`)

On the Plantillas page (`message_templates` module, same gate as the endpoints), above the bank account card:

- [x] **Status per channel** — "Correo" and "SMS": not configured / paused / active, plus the configured sender. Built only from `GET /brevo/status`; the API key never reaches the browser.
- [x] **Brevo account** — plan and remaining SMS credits, or the reason they couldn't be read (no API key, invalid key, Brevo unreachable).
- [x] **Test send** — choose Correo or SMS, type an email or a phone, send. Shows the result inline: sent (with Brevo's message id), or why not (paused and not in the test list, not configured, no credits, invalid key…), in plain Spanish. The SMS option warns that it spends one credit.
- [x] Audit log label for `brevo.testSend`.

Later stages add: per-channel template editor with SMS segment counter (stage 2), channel column/filter in Mensajes and client channel preferences (stage 3), delivery status and "correo rebotado" (stage 4), low-credit alert (stage 6).

## Definition of done for this stage

- An admin can see whether email and SMS are ready and send a real test email from the panel.
- All items in `docs/DEFINITION_OF_DONE.md` pass.
