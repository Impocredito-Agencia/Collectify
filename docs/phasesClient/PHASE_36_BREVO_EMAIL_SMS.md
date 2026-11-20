# Phase 36 — Email and SMS via Brevo (Client)

## Goal

The panel side of `docs/phases/PHASE_36_BREVO_EMAIL_SMS.md` — **read its stages and open questions first**. Delivered stage by stage, like the api.

## Stage 1 — Brevo card (`feature/brevo-service`)

On Plantillas' **"Correo y SMS" tab** (`/plantillas/correo-sms`; `message_templates` module, same gate as the endpoints). *Changed during stage 2–3 (human requests, 2026-11-09):* the Brevo cards first sat at the top of Plantillas, then moved to a separate sub-page behind a blue "Correo y SMS" button, and finally became a tab next to "WhatsApp" — the same pattern as Préstamos' "Préstamos" | "Eliminados". The tab holds:

- [x] **Status per channel** — "Correo" and "SMS": not configured / paused / active, plus the configured sender. Built only from `GET /brevo/status`; the API key never reaches the browser.
- [x] **Brevo account** — plan and remaining SMS credits, or the reason they couldn't be read (no API key, invalid key, Brevo unreachable).
- [x] **Test send** — choose Correo or SMS, type an email or a phone, send. Shows the result inline: sent (with Brevo's message id), or why not (paused and not in the test list, not configured, no credits, invalid key…), in plain Spanish. The SMS option warns that it spends one credit.
- [x] Audit log label for `brevo.testSend`.

## Stage 2 — Email and SMS templates (`feature/brevo-channel-templates`)

A "Plantillas de correo y SMS" card on the same tab, below the Brevo card:

- [x] The 18 message types grouped by trigger (nuevo pagaré, próximas a vencer, vencidas, Datacrédito, pagos), each a compact card (3 per row on wide screens, 2 on medium, 1 on mobile) with "Correo" and "SMS" buttons and the SMS's estimated credits.
- [x] Editor (modal): subject + body for email, body for SMS. The available values are listed with their meaning and an example; a click inserts `{{n}}` at the cursor. Invalid placeholders are flagged and block saving.
- [x] Live preview with the example values: email rendered with the client's paragraphs and bold (React elements, never injected HTML), on a soft light-gray "paper" with near-black text (`paper` tokens) — pure white flashed too hard in the dark app, and the app's own dark tones made it blend in (human requests, 2026-11-09); SMS exactly as it will go out (accents dropped), with its length and credits ("2 créditos por envío"), green/yellow/red.
- [x] "Probar esta plantilla": sends the saved version with the example values; disabled while there are unsaved changes.
- [x] Plantillas has two tabs under its title, **"WhatsApp"** (default — exactly the page as before) and **"Correo y SMS"**, laid out like Préstamos' "Préstamos" | "Eliminados", but each tab (`ChannelTab`) carries its channel's color and icon — the look the old "Correo y SMS" button had (human request, 2026-11-09): WhatsApp in green (`whatsapp` tokens, a bit darker than the brand's #25D366 for readable white text) with a round speech bubble and handset in WhatsApp's style (`WhatsappIcon`, hand-drawn), Correo y SMS in Publi Mark blue with the envelope (`MailIcon`). Active = solid color, inactive = a dim version of the same color. The tab is in the URL (`/plantillas` / `/plantillas/correo-sms`), not session state like Préstamos, so the client profile can link straight to it and the browser's back button switches tabs. Main actions on the Correo y SMS tab use the new `brandBlue` Button variant to set it apart from WhatsApp's orange.
- [x] Audit log labels for `messageChannelTemplate.update` / `messageChannelTemplate.testSend`.
- [x] Tests: SMS counter and GSM-7 conversion (same cases as the api), placeholder fill/validation, bold/paragraph split, every type listed exactly once.

## Stage 3 — Email and SMS reminders (`feature/brevo-reminder-channels`)

On the Correo y SMS tab, between the Brevo card and the templates:

- [x] **"Envíos automáticos por correo y SMS"** — one card per family (vencidas, próximas a vencer, Datacrédito), each listing the templates it sends (same badges as the WhatsApp family cards) and with a Correo and an SMS row, aligned across cards: Activo/Pausado, Activar/Pausar, and the same day + time picker as WhatsApp. The picker was extracted from Plantillas into `CronScheduleForm` and is now shared. Warns when a channel is active here but paused on the server, and that every SMS spends credits.
- [x] **"Clientes que reciben correo y SMS"** — every client with overdue cuotas, most days of mora first, plus anyone with a channel on: search (name or cédula, accent-insensitive), "Todos / Con canal activo", minimum days of mora, 25 per page. A Correo and an SMS switch per row (Correo disabled without an email on file); check rows to turn email/SMS on or off in bulk, with the clients skipped for having no email listed.
- [x] **Client profile:** "Recordatorios por correo y SMS" with the same two switches, shown to admins and users with the `message_templates` module.
- [x] **Mensajes:** "Canal" and "Destino" (email or phone) columns, a channel filter, and the drawer shows the channel, the recipient and, for a failed email/SMS, Brevo's reason. The profile's failed-messages list names the channel of non-WhatsApp rows.
- [x] Templates card: the "Nuevo pagaré / Refinanciación" and "Pagos" groups say they aren't sent by email/SMS today.
- [x] Audit labels for the five new actions.
- [x] Text size on the Correo y SMS page (human request, 2026-11-09): nothing below 12px — what was 10/11px (labels, hints, badges, day buttons, table metadata) is now 12px, and card descriptions went from 13 to 12px. Larger sizes are unchanged: card titles 16px, inputs and the template textarea 15px, the email preview 14px, buttons/table cells 13px, the page title. The shared components gained an opt-in size (`Field textSize="readable"`, `StatusBadge textSize="label"`, `CronScheduleForm textSize="label"`); every other page keeps its sizes.
- [x] Tests: recipient filters, recipient formatting.

Later stages add: delivery status and "correo rebotado" (stage 4), low-credit alert (stage 6).

## Definition of done for this stage

- An admin can see whether email and SMS are ready and send a real test email from the panel.
- All items in `docs/DEFINITION_OF_DONE.md` pass.
