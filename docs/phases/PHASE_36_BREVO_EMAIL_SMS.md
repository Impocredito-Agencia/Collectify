# Phase 36 — Email and SMS via Brevo

## Goal

Add two outbound channels next to WhatsApp, both through [Brevo](https://www.brevo.com/): **transactional email** and **SMS**. A client who has no WhatsApp, blocked the business number, or doesn't receive (e.g. Meta error 131026) can still get reminders, payment confirmations and the paz y salvo.

Email is free up to the plan's daily limit (~300/day on the free plan). **SMS is paid per message** with prepaid credits, so the system is built so that an SMS can never go out by accident.

## Stages

Delivered as separate branches/PRs, in this order. Stages 1–2 don't depend on any business answer; stage 3 does.

| Stage | Branch | Content |
|---|---|---|
| 1 | `feature/brevo-service` | `BrevoService`, config + kill switches, status and test-send endpoints, Brevo card in the panel |
| 2 | — | Email/SMS templates per message type, editable from the panel, SMS segment counter |
| 3 | — | Channel selection in the real flows, `message_logs.channel` + recipient columns, client channel preferences, retry |
| 4 | — | Brevo webhook (delivery status, bounces), "correo no contactable" |
| 5 | — | Email live in production (domain authenticated by the business). **Paused 2026-11-09** — waiting for the business to choose and buy its domain (open question 4); the sender is a `@gmail.com` address until then, fine for tests but likely to land in spam for clients |
| 6 | — | SMS live: credits bought, test with the allowlist, daily cap / low-balance alert |
| 7 | — | Client-facing guide (`docs/cliente/GUIA_BREVO.md`) |

## Open questions — confirm with the business owner before stage 3

1. Which message types go by email and which by SMS (all, or e.g. SMS only for overdue, email for payment confirmation and paz y salvo)?
2. Channel rule: **fallback** (only when WhatsApp fails / the client has none), **additional** (every enabled channel), or **per-client preference**?
3. SMS budget: a monthly or daily cap? Should sends stop at a given balance?
4. Sender address and name. Does the business have its own domain to authenticate (SPF/DKIM/DMARC)? Without it, email almost certainly lands in spam.
5. Does email also go to co-debtors / third-party contacts, like the alternate phone numbers today?
6. Does the existing `dataProcessingConsent` (Phase 21) cover email and SMS, or is per-channel consent needed?
7. Who pays for and administers the Brevo account? Recommended: the business directly.

## Stage 1 — Brevo service (`feature/brevo-service`)

### Decisions

- **Module:** `apps/api/src/brevo/` — Brevo is a provider like Meta, so it gets its own module next to `whatsapp/`, which keeps its reminder services and only calls into this one.
- **HTTP client:** plain `fetch`, same as `WhatsAppService` — no `@getbrevo/brevo` SDK. Three endpoints don't justify a dependency, and the tests mock `fetch` the same way `whatsapp.service.spec.ts` already does.
- **Endpoints (Brevo API v3, header `api-key`):**
  - email: `POST /v3/smtp/email` → 201 `{ messageId: string }`;
  - SMS: `POST /v3/transactionalSMS/send` (the current endpoint; `/v3/transactionalSMS/sms` is deprecated) → 201 `{ messageId: number }`. `recipient` is the number with country code and **no `+`** (`573001234567`), `type: 'transactional'`;
  - account: `GET /v3/account` → `plan[]`; SMS credits are the `plan` item with `type: 'sms'`, its `credits` field.
- **Never throws on a failed send** (same contract as `WhatsAppService`): returns `{ sent, providerMessageId, failureReason, errorMessage }`. Brevo errors are mapped to a `failureReason`:
  - `401` → `invalid_api_key`;
  - `402`, or a body `code`/`message` mentioning credits → `insufficient_credits`;
  - `429` → `rate_limited`;
  - any other `4xx`/`5xx` → `rejected`, keeping Brevo's own `message`;
  - network error / timeout → `network_error`.
  Recipient format is validated before calling Brevo (email shape, Colombian phone normalized to E.164), so an invalid recipient never costs a call.
- **Safety switches** (checked before any credential or network call):
  - `BREVO_EMAIL_SENDING_PAUSED` — default `false`;
  - `BREVO_SMS_SENDING_PAUSED` — **default `true`**: anything other than an explicit `false` keeps SMS paused, so a deploy that forgets the variable can't spend credits;
  - `BREVO_TEST_RECIPIENTS` — emails and E.164 phones that bypass both pauses (same behavior as `WHATSAPP_TEST_RECIPIENTS`).
- **No credentials:** an empty `BREVO_API_KEY` logs a warning and sends nothing; the app boots normally.
- **Test send uses a fixed text** (no free-form content from the panel), short and GSM-7 only, so a test SMS always costs exactly one credit. It isn't written to `message_logs` (that table is per-client history with a mandatory `client_id` and `type`); it's recorded by the audit log, and the result (sent / reason) comes back immediately to the panel.
- **Permissions:** both endpoints use `@RequireModule(AppModule.MessageTemplates)` — the Brevo card lives under Plantillas (its "Correo y SMS" tab, `/plantillas/correo-sms`), gated by that same module, next to stage 2's per-channel templates.
- **Reusable outside reminders:** `BrevoModule` exports `BrevoService` — any module (e.g. electronic signature) imports `BrevoModule` and calls `sendEmail` / `sendSms`; the same pauses, test list and "never throws" contract apply.
- **Email attachments** (requested for the electronic-signature module, 2026-11-17): `sendEmail({ …, attachments: [{ name, content }] })` with a `Buffer`, or `{ name, url }` with a public absolute URL Brevo downloads (e.g. Cloudinary). The name must carry its extension (Brevo checks it against its allowed list — pdf, images, office files…); an attachment with both or neither of `content`/`url` is rejected before calling Brevo (`failureReason: rejected`). Brevo's own documentation states no per-file size limit.
- **`message_logs` changes moved to stage 3.** Nothing writes an email/SMS row before stage 3, and making `phone_number` nullable now would force changes in retry and the inbox thread that couldn't be exercised yet.

### Scope

- [x] `brevo` config section + env validation: `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME`, `BREVO_SMS_SENDER`, `BREVO_EMAIL_SENDING_PAUSED`, `BREVO_SMS_SENDING_PAUSED`, `BREVO_TEST_RECIPIENTS`. `BREVO_WEBHOOK_SECRET` comes with stage 4, `BREVO_SMS_DAILY_LIMIT` with stage 6 (depends on question 3).
- [x] `BrevoService.sendEmail`, `sendSms`, `getAccountInfo`, `getStatus`.
- [x] `GET /api/v1/brevo/status` — configured or not per channel, paused or not, sender, plan and SMS credits. Never returns the API key.
- [x] `POST /api/v1/brevo/test` — `{ channel: 'email' | 'sms', to }`, `@Audit('brevo.testSend')`.
- [x] Unit tests: payloads, no API key, kill switches, allowlist, error mapping, account parsing.
- [x] `.env.example`, `docs/ENVIRONMENT_VARIABLES.md`, `docs/ARCHITECTURE.md`.

## Stage 2 — Email and SMS templates (`feature/brevo-channel-templates`)

### Decisions

- **Resolved with the human (2026-11-09): SMS are always sent in GSM-7.** Before sending, `toGsm7Text` (`whatsapp/smsText.ts`) drops the accents GSM-7 lacks (á, í, ó, ú → a, i, o, u), replaces typographic punctuation and removes emojis; é, ñ, ü, ¿ and ¡ are GSM-7 and stay. Otherwise one "días" — in nearly every reminder through the "hace N días" value — makes the whole SMS Unicode, 70 characters per credit instead of 160. Email and WhatsApp keep their accents.
- **Wording lives in Collectify, not in Brevo's template editor** (`templateId`): new table `message_channel_templates`, one row per (type, channel), editable from the panel and covered by the audit log. See `docs/DATABASE.md`.
- **Same values as WhatsApp.** A row is filled with the same `bodyParameters` the WhatsApp template of that type is sent with — no figure is computed twice. `MESSAGE_TYPE_PARAMETERS` (`whatsapp/messageTypeParameters.ts`) describes each `{{n}}` with a label and an example value; its spec builds a real selection for every one of the 18 types and checks the counts match, so it can't silently drift from what's sent. A text with a placeholder outside `{{1}}…{{N}}`, or a malformed one, is rejected on save (api and panel).
- **Plain text, never HTML.** Email bodies use the WhatsApp convention (`*bold*`); `renderEmailHtml` escapes everything, makes paragraphs from blank lines and sends a plain-text part too. The admin can't break the layout or inject markup, and a client's own data in a value is escaped like any text.
- **Limits:** email subject 150, email body 5000, SMS body 480 characters (before filling — already 4 credits). The SMS segment count is a warning in the panel, not a hard limit.
- **Seeded texts** for all 18 types × 2 channels, adapted from the WhatsApp ones: emojis removed, and "adjunte su comprobante" became "Si ya realizó el pago, haga caso omiso de este mensaje" (an email reply isn't a channel the business monitors). Short SMS versions: with the example values every one costs at most 2 credits, most 1 (checked by a spec). **The business must review them before email/SMS go live (stage 5/6).**
- **Template test send:** `POST /message-channel-templates/:type/:channel/test` sends the *saved* template filled with the example values, email subject prefixed "[Prueba] ", through `BrevoService` — same pauses and test list as everything else.
- **Lives in the whatsapp module** (`whatsapp/channelTemplates/`), next to `messageTemplates/`, since it's keyed by `MessageType` and stage 3's senders are there; `WhatsappModule` now imports `BrevoModule`.

### Scope

- [x] Migration `CreateMessageChannelTemplatesTable1792000000000` + entity `MessageChannelTemplate`, seeded.
- [x] `MESSAGE_TYPE_PARAMETERS` + sync spec against the real template selections.
- [x] `toGsm7Text` / `countSmsSegments` (+ spec), `findInvalidPlaceholders` / `renderEmailHtml` / `renderEmailText` (+ spec).
- [x] `MessageChannelTemplatesService`: `findAll`, `update`, `render` (for stage 3), `sendTest` (+ spec, including a check of every seeded text).
- [x] `GET /message-channel-templates`, `PUT /message-channel-templates/:type/:channel` (`@Audit('messageChannelTemplate.update')`), `POST /message-channel-templates/:type/:channel/test` (`@Audit('messageChannelTemplate.testSend')`) — `message_templates` module, Swagger.
- [x] `docs/DATABASE.md`, `docs/GLOSSARY.md` (canal, plantilla de correo/SMS, crédito SMS, segmento SMS).

## Stage 3 — Email and SMS reminders (`feature/brevo-reminder-channels`)

### Resolved with the human (2026-11-09)

The open questions above, as they apply to this stage:

1. **Purpose — not a WhatsApp fallback.** Email and SMS are *extra pressure* on debtors the admin picks by hand, typically the ones with the most days of mora. They go out **in addition to** WhatsApp, never instead of it, and regardless of whether WhatsApp worked.
2. **Who:** a client receives email and/or SMS reminders only when the admin turned that channel on for them — two switches (Correo, SMS) on the client's profile, plus a list of clients with overdue cuotas, sorted by days of mora, to switch many at once. Off by default for everyone.
3. **When:** scheduled like WhatsApp — one card per reminder family, each with **its own on/off and schedule per channel** (e.g. overdue email every Monday 9:00, overdue SMS only Fridays 10:00). All start paused.
4. **Which families:** overdue, upcoming due, Datacrédito. **Payment confirmation and paz y salvo never go by email/SMS.** New pagaré / refinance: **not sent by email/SMS either** (human, 2026-11-09: "99% sure they won't be used") — their email/SMS templates were removed (migration `RemoveNonCollectionChannelTemplates1792300000000`), so email/SMS is collection only. Adding one back later is a family row plus its templates.
5. **SMS recipients:** the same phones as WhatsApp (client's main and alternate number, and the loan's third-party contact), muted numbers excluded. **Email** can only go to the client — they're the only one with an email on file — and only for their own group (a loan whose reminders go to a third party isn't emailed to the client, same as WhatsApp doesn't message the client about it).
6. **Data-processing consent:** same as WhatsApp today — not checked at send time.
7. **Per-client minimum days between reminders (Phase 27): doesn't apply to email/SMS.** It stays WhatsApp-only, and email/SMS sends don't count against it either.

### Decisions

- **Same figures as WhatsApp, by construction.** Each reminder service (overdue, upcoming, Datacrédito) is split into "plan the messages" (installments, recipient groups, nota adicional, template selection, breakdown, log items) and "send them over WhatsApp". The email/SMS sender consumes the very same plan, then renders it with the channel template (stage 2).
- **`message_logs` gains `channel`** (`whatsapp` default for every existing row, `email`, `sms`), `email` (nullable), `provider_message_id` (Brevo's id, indexed, for stage 4's webhook), and `phone_number` becomes nullable — with a CHECK that an email row has an email and any other row has a phone. A failed Brevo send stores its reason in `last_error_title`.
- **Nothing is logged for a send that was never attempted** — channel paused (`BREVO_*_SENDING_PAUSED`) or not configured. Logging those as `failed` is what filled `message_logs` with junk twice before (see the 2026-09-11 and 2026-09-19 cleanups).
- **Every WhatsApp-only reader of `message_logs` filters `channel = 'whatsapp'`:** the inbox conversation thread, delivery health ("possibly blocked"), the message-frequency throttle and the Datacrédito "already sent" check (per channel, so the email notice doesn't stop the SMS one). Dashboard message counts include every channel — they're all messages the client received.
- **Schedules live in a new `message_channel_schedules` table** (family, channel, cron expression, paused), not on template rows like WhatsApp's schedule owners — six rows seeded paused, with the same default times as the WhatsApp families. `ChannelReminderCronService` registers one job per row in `America/Bogota`, the same way `WhatsappCronService` does.
- **Order (human request, 2026-11-09):** every family list follows a loan's life — new pagaré → próximas a vencer → vencidas → Datacrédito (→ payments) — on the WhatsApp tab (family cards and template cards) and on Correo y SMS (schedules and templates, without new pagaré).
- **Retry (Phase 18) works for email/SMS rows too:** it resends the client's current state for that family to the same recipient over the same channel.

### Scope

- [x] Migration `AddEmailAndSmsReminderChannels1792100000000`: `message_logs.channel` / `email` / `provider_message_id`, nullable `phone_number` + CHECK; `clients.email_reminders_enabled` / `sms_reminders_enabled`; `message_channel_schedules` seeded paused.
- [x] `planReminderForClient` (overdue, upcoming) and `planForLoan` / `findLoanIdsDueForNotice` / `wasAlreadySent` (Datacrédito) split out of the WhatsApp senders — their existing specs pass unchanged, except the Datacrédito "already sent" check now being per channel.
- [x] `ChannelReminderService.runFamily` / `retry`, `ChannelReminderCronService`, `ChannelRecipientsService` (+ specs).
- [x] `GET /message-channels/schedules`, `PATCH /message-channels/schedules/:family/:channel`, `POST …/pause`, `POST …/resume`, `GET /message-channels/recipients`, `PUT /message-channels/recipients` (bulk), `PUT /message-channels/recipients/:clientId` — `message_templates` module, audited, Swagger.
- [x] `GET /message-logs?channel=`; retry of an email/SMS row goes through `ChannelReminderService`.
- [x] WhatsApp-only readers filter `channel = 'whatsapp'`: inbox conversation list and thread, delivery health, message-frequency throttle.
- [x] `docs/DATABASE.md`, `docs/GLOSSARY.md`, `docs/ARCHITECTURE.md`.
- [ ] Manual test against a real database and Brevo (not possible from the development sandbox).

## Stage 4 — Brevo delivery webhook (`feature/brevo-webhook`)

### Resolved with the human (2026-11-09)

1. **Email:** every *definitive* event stops email to that client until the admin re-enables it — hard bounce, invalid email, blocked, marked as spam, unsubscribed. Insisting on addresses that bounce or complained damages the sender's reputation (everything starts landing in spam).
2. **SMS:** a number that hard-bounces, is blacklisted or replies STOP (unsubscribed) gets no more SMS — WhatsApp is unaffected — until the admin re-enables it. Saves credits, and honoring STOP is a legal requirement.

### Decisions

- **Two public endpoints**, one per Brevo webhook (Brevo configures email and SMS webhooks separately and their payloads differ): `POST /api/v1/brevo/webhooks/email` and `POST /api/v1/brevo/webhooks/sms`. Both accept a single event or a batched array.
- **Authentication:** Brevo doesn't sign webhooks, so each call must carry `BREVO_WEBHOOK_SECRET` — as `Authorization: Bearer <secret>` (webhook created through Brevo's API with `auth`) or as the password of Basic auth embedded in the webhook URL (what Brevo's dashboard allows). Constant-time comparison; 401 otherwise, and every call is rejected while the secret is empty.
- **Matching:** by `message_logs.provider_message_id` — email `message-id` (compared with and without its `<…>`), SMS `messageId`. An unknown id (a test send, a message from before stage 3, another app on the same Brevo account) is ignored without failing.
- **Delivery status** reuses `delivery_status` (`sent` / `delivered` / `read` / `failed`) and `delivery_status_updated_at`, like WhatsApp: email `request`→sent, `delivered`→delivered, `opened`/`unique_opened`/`click`/`proxy_open`→read, definitive failures→failed; SMS `sent`/`accepted`→sent, `delivered`→delivered, `hard_bounce`/`rej`/`bl`→failed. **Never downgrades** (a late `sent` can't undo `delivered`; `failed` doesn't override `delivered`/`read`), which also makes Brevo's re-sends idempotent. A failure's reason goes in `last_error_title`. Soft bounces / deferrals are transient: they only record the reason.
- **Not contactable:** `clients.email_undeliverable_at` + `email_undeliverable_reason` for the email; `clients.sms_undeliverable_phone_numbers` (TEXT[]) for SMS, per number. The email/SMS reminders skip them. Cleared by the admin ("Reactivar") or, for the email, automatically when it's changed on the client's profile.
- Spam and unsubscribe arrive *after* a delivery: they don't change that message's delivery status, only the client's contactability.
- **Unknown message ids still block the contact** they name (email address, or a client's own phone number) — an unsubscribe or STOP must be honored even when it came from a send Collectify didn't log (a test send).
- **Not batched:** the webhooks are created without Brevo's batching. Arrays are accepted anyway, but a large batch could exceed the API's default 100 KB JSON body limit.
- `GET /brevo/status` gains `webhookConfigured` (whether the secret is set, never the secret).

### Scope

- [x] `BREVO_WEBHOOK_SECRET` (config, validation, `.env.example`, `docs/ENVIRONMENT_VARIABLES.md`).
- [x] Migration `AddClientEmailAndSmsContactability1792200000000`; `ClientsService.update` clears the email mark when the email changes (+ spec).
- [x] `brevoWebhookEvents.ts` — event → status/block/reason, forward-only status, id candidates (+ spec).
- [x] `BrevoWebhookService` + `BrevoWebhookController` (`POST /brevo/webhooks/email`, `POST /brevo/webhooks/sms`) (+ spec: auth, idempotency, unknown ids, per-event isolation, email/SMS blocking).
- [x] `ChannelReminderService` skips blocked emails/numbers; `POST /message-channels/recipients/:clientId/reactivate` (audited); recipients list returns the marks (+ specs).
- [x] `docs/DATABASE.md`, `docs/GLOSSARY.md` (rebote / no contactable), `docs/ARCHITECTURE.md`.
- [ ] Register the two webhooks in Brevo and check a real delivery/bounce end to end (needs the API on a public URL).

## Related documents

- `docs/phasesClient/PHASE_36_BREVO_EMAIL_SMS.md` — the panel side
- `docs/phases/PHASE_5_WHATSAPP.md`, `PHASE_18_MESSAGE_AUDIENCES.md` (retry), `PHASE_22_WHATSAPP_WEBHOOK.md` (webhook), `PHASE_33_MESSAGE_TEMPLATES_V2.md` (current catalog)
- Brevo API: https://developers.brevo.com/
