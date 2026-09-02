# Phase 18 — Message Audiences, Cronjobs and Log Retention

**Cron structure changed by Phase 33** (`docs/phases/PHASE_33_MESSAGE_TEMPLATES_V2.md`): this phase's one-job-per-exact-type model no longer holds — as of Phase 33 there's one job per reminder *family* (overdue, upcoming_due), since "vencida"/"próxima a vencer" now each span several exact templates. `account_summary`'s cron was removed along with the type itself. See `WhatsappCronService` and `reminderFamily.ts`. The audience mechanism this phase introduced was already retired independently in Phase 27 — see `docs/phases/PHASE_27_MESSAGE_FREQUENCY.md`.

## Goal

Let an admin attach a curated group of clients ("grupo de personas") to a message template, with its own schedulable cronjob, so the job only messages that group when it runs. Also let an admin manually retry a message that failed to send, without needing to keep every successfully-sent message log forever taking up attention in the retry workflow.

## Confirmed scope note — read before implementing

`docs/DATABASE.md`'s "Changed after Phase 9" section documents that `message_templates.content` was made deliberately read-only: WhatsApp/Meta only allows a business to *initiate* a conversation through a template Meta has pre-approved, so free-text editing in our own database doesn't reflect that reality and would just break sending. **The human confirmed directly that this remains true and is not being revisited**: templates stay static, created and approved in Meta, stored fixed in `message_templates` purely for display. This phase does **not** reopen `content` editing — its only new surface is the audience/cron layer on top of the existing four static templates.

## Resolved — confirmed directly with the human

With the content-editing question already resolved (templates stay static), four scoping questions were confirmed before writing any code:

1. ~~**Additive vs. restrictive:** additive. The curated audience group is added on top of whoever the dynamic logic already includes (mora/upcoming-due) — it never narrows the dynamic set, it only extends it.~~ → **Reversed after client QA (2026-08-18) — see "Extended after client QA" below.** Kept here for history per this project's convention.
2. **Cron scope:** all four message types gain a configurable schedule, including `new_loan` and `account_summary` (previously on-demand/synchronous only). This is the bigger-change option the original brief flagged, confirmed deliberately.
3. **A curated-audience member who doesn't meet the dynamic condition** (e.g. added to the "mora" template's audience but has no overdue installments that day): the message is still sent, rendered with an empty installments list and a $0 grand total — not skipped, not an error. This is what makes "additive" actually add someone rather than being a silent no-op for them.
4. **`new_loan` cron mechanics** (the type with no natural recurring "who qualifies today" query, since it's inherently one loan's own disbursement event): the cron scans for loans whose new-loan message hasn't been sent yet (`Loan.newLoanMessageSentAt IS NULL`) and retries sending — a backup/retry mechanism, not a replacement for the existing synchronous send-at-creation, which remains the primary trigger. The curated audience concept doesn't apply here: there's no "an audience member's own new-loan content" to render for someone without a qualifying loan, so audience membership has no functional effect on this particular cron (documented explicitly rather than built silently inconsistent).
5. **`account_summary` cron mechanics** (the type with no dynamic condition at all — account summary isn't "who's overdue," it's "who wants a periodic full statement"): the cron sends only to clients in that template's curated audience, nothing else. Extended the same empty/$0-render principle from point 3 here too, by inference from the same underlying rule (a client in the audience with zero pending installments still gets sent an empty/$0 statement) — this specific extension wasn't asked verbatim but follows directly from the already-confirmed principle rather than being guessed independently.

These answers are final for this phase — do not revisit them without a new confirmation round with the human.

## Extended after client QA (2026-08-18) — audience is now a required filter for overdue/upcoming_due

**Confirmed directly with the human, reversing point 1 above:** for `overdue` and `upcoming_due` only, the curated audience is a **required filter (intersection)**, not additive. A client is reminded only if they BOTH dynamically qualify (have an overdue installment / one approaching due) AND are a member of that template's audience. An empty or unpopulated audience means **nobody** is reminded by that job, even if clients are overdue — the admin must explicitly enroll every client that job should ever reach.

- Confirmed explicitly aware of the consequence: since no audience had any members at the time of this change, `overdue`/`upcoming_due` would stop sending to anyone until the admin populates each audience. This was accepted as the intended behavior, not a bug to guard against.
- `account_summary` is **unaffected** — it was never additive to begin with (no dynamic condition to union with, per point 5 above), so it already behaved as "audience is the whole recipient list." (**Superseded later the same day — see the next section.**)
- `new_loan` is **unaffected** — its cron never consulted the audience at all (point 4 above); this correction was scoped to overdue/upcoming_due only, per the human's explicit choice not to touch the other two types in this round. (**Superseded later the same day — see the next section.**)
- Point 3 above ("a curated-audience member who doesn't meet the dynamic condition still gets an empty/$0 message") **no longer applies to overdue/upcoming_due** — a non-qualifying audience member now simply isn't in the intersection, so they get nothing, not an empty message. It still applies as originally written to `account_summary`.
- Implementation: `OverdueReminderService.runWeeklyReminder()` / `UpcomingDueReminderService.runDailyReminder()` now compute `dynamicClientIds.filter(id => audienceSet.has(id))` instead of a union; `sendReminderForClient` is called without `allowEmpty` from these two crons, since every client passed in already dynamically qualifies by construction. `allowEmpty` remains on both methods' signatures — still used by the manual "retry a failed message" flow (`MessageLogsService`), which is unrelated to this correction.
- Client-side: `MessageTemplatesPage.tsx`'s `TemplateAudienceEditor` shows a red warning for the `overdue`/`upcoming_due` audience editors specifically, explaining that an empty group means nobody is reminded.

## Extended further, same day (2026-08-18) — new_loan loses its cron, account_summary loses its audience, bulk selection, friendly schedule picker

Three more corrections confirmed directly with the human, in the same round of client QA:

1. **`new_loan` has no cron job at all**, not even the retry/backstop sweep from point 4 of the original "Resolved" section. It's sent exactly once, synchronously, at loan creation (or refinance) — full stop. `NewLoanReminderService.runPendingNotifications()` was deleted entirely; `WhatsappCronService` no longer registers a job for it and rejects `getStatus`/`pause`/`resume`/`reschedule` for `new_loan` with a 400 (`assertCronSupported`). A synchronous send that fails can still be retried manually via `POST /message-logs/:id/retry` — that path is unrelated to the removed cron and still works. `CronConfig.newLoanReminderExpression`/`NEW_LOAN_REMINDER_CRON` were removed (config, `.env.example`, `ENVIRONMENT_VARIABLES.md`).
2. **`account_summary` loses its audience entirely** — reversing the original design (point 5 of "Resolved") a second time in the same day. It no longer has *any* curated group; `AccountSummaryService.runActiveClientSummaries()` (renamed from `runAudienceSummaries()`) sends to every client with at least one `Loan.status = 'active'`, found via a direct query rather than `MessageAudiencesService`. `TemplateAudienceEditor` is not rendered at all for this type in `MessageTemplatesPage.tsx` — replaced with a one-line note. The point-3 empty/$0-message rule still applies (a client with an active loan but nothing currently pending/overdue still gets a message).
3. **Bulk client selection** for the `overdue`/`upcoming_due` audience editors (the only two that still have one): search results now stay visible as a checkbox list instead of disappearing after each add, with "Agregar todos"/"Quitar todos" for the whole visible batch — the client explicitly flagged one-by-one search-and-add as too tedious for adding/removing many clients at once.
4. **Friendly schedule picker** replacing the raw cron-expression text field, for the three types that still have a schedule (`overdue`, `upcoming_due`, `account_summary` — not `new_loan`, which has none): periodicity (`daily`/`weekly`/`biweekly`/`monthly`) + time, converted to a cron expression under the hood. `"cada 15 días"` has no native cron equivalent and is approximated as firing on the 1st and 16th of each month. Pure conversion logic lives in `apps/client/src/features/messageTemplates/cronScheduleUtils.ts` (`buildCronExpression`/`parseCronExpression`), unit-tested — a hand-written expression that doesn't match one of the 4 supported shapes (e.g. the original `overdue` default, three weekdays in one field) can't be reverse-parsed and falls back to a safe default rather than a lossy guess.

## Required reading before starting

`docs/phases/PHASE_9_MESSAGE_TYPES.md` (the templates/log model this phase extends), `docs/DATABASE.md` ("Changed after Phase 9" section specifically).

## Scope (once the above is confirmed)

### Entities and migrations
- [x] `MessageAudience` entity: `id`, `message_template_id` (FK), `name`, timestamps + soft delete. Related `Client`s via a `message_audience_clients` join table (TypeORM-managed `@ManyToMany`/`@JoinTable`, not a separate entity class — matches the join table's plain `message_audience_id`/`client_id` shape). One primary audience per template is the actual UI surface (see client scope), though the schema itself doesn't hard-restrict multiplicity.
- [x] Migration `CreateMessageAudiencesTables`.
- [x] `MessageTemplate.cronExpression` (nullable) — DB-backed schedule per template, replacing the env-var-only source the two existing jobs used; falls back to a per-type code default when null. Migration `AddCronExpressionToMessageTemplates`.
- [x] `MessageLog`: add `retried_at` (nullable) and `retry_of_message_log_id` (nullable, self-referencing FK) to track manual retries — no removal of existing "sent" row persistence. Migration `AddRetryFieldsToMessageLogs`.
- [x] `Loan.newLoanMessageSentAt` (nullable timestamp) — lets the new `new_loan` cron (point 4 above) find loans still needing their message, without the fragile message-content string-matching `LoanDetailPage.tsx` used before. Migration `AddNewLoanMessageSentAtToLoans`.

### Reminder services — allowEmpty
- [x] `OverdueReminderService.sendReminderForClient`, `UpcomingDueReminderService.sendReminderForClient`, `AccountSummaryService.sendAccountSummary` all accept an optional `{ allowEmpty?: boolean }` — default `false` preserves the existing throw-on-nothing-to-report behavior for the manual on-demand `POST /whatsapp/clients/:clientId/send-*` endpoints (unchanged); the cron paths pass `true` so audience-only members (point 3 above) get an empty/$0 message instead of an error.

### Cron consolidation
- [x] A single `WhatsappCronService` (replacing the separate `OverdueReminderCron`/`UpcomingDueReminderCron` files) registers all four jobs at boot, keyed by `MessageType`, reading each one's schedule from `MessageTemplate.cronExpression` with a code-level default fallback. Exposes generic `getStatus(type)`, `pause(type)`, `resume(type)`, `reschedule(type, expression)`.
- [x] `overdue`/`upcoming_due` job bodies: existing `runWeeklyReminder()`/`runDailyReminder()` — originally unioned the dynamically-qualifying client list with the template's audience clients (point 1); **intersects them instead as of the "Extended after client QA" correction above** (2026-08-18), calling `sendReminderForClient(clientId)` (no `allowEmpty` needed) for the intersected set only.
- [x] ~~`new_loan` job body: new `NewLoanReminderService.runPendingNotifications()` — finds loans with `newLoanMessageSentAt IS NULL`, retries `sendNewLoanMessage()`, marks the timestamp on success (point 4).~~ **Removed entirely — see "Extended further, same day" above.** `new_loan` has no job body at all now.
- [x] ~~`account_summary` job body: new `AccountSummaryService.runAudienceSummaries()` — sends to every client in the template's audience only, with `allowEmpty: true` (point 5).~~ **Superseded — see "Extended further, same day" above.** Now `AccountSummaryService.runActiveClientSummaries()`, sending to every client with an active loan, no audience.

### Endpoints
- [x] `GET /api/v1/whatsapp/cron/:type/status`, `POST /api/v1/whatsapp/cron/:type/pause`, `POST /api/v1/whatsapp/cron/:type/resume`, `PATCH /api/v1/whatsapp/cron/:type/schedule` — replaces the old two hardcoded per-type route sets with one parametrized set covering all four types; a breaking route change made together with its only consumer (the client app) in this same phase, not left as a compatibility shim.
- [x] `GET /api/v1/message-templates/:type/audience`, `PUT /api/v1/message-templates/:type/audience` (upsert the single audience + its full client id list) — admin only.
- [x] `POST /api/v1/message-logs/:id/retry` — admin only (routed on the existing `MessageLogsController`, i.e. `/message-logs/:id/retry` rather than nested under `/whatsapp/`, matching that controller's already-established top-level path — a minor deviation from this doc's original path sketch, noted here rather than silently diverging).

### Tests (mandatory)
- [x] Audience upsert (create on first save, update membership on subsequent saves); `getClientIdsForTemplateType` unions correctly.
- [x] `allowEmpty`: manual on-demand calls still throw on nothing-to-report; cron-path calls with `allowEmpty: true` send an empty/$0 message instead.
- [x] Overdue/upcoming-due candidate list is the intersection of dynamically-qualifying and audience clients (corrected 2026-08-18 — see "Extended after client QA"): excludes a qualifying client not in the audience, excludes an audience member who doesn't dynamically qualify, and sends to nobody when the audience is empty. Manual send-now for a specific client is unaffected.
- [x] ~~`new_loan` cron: only scans/sends for loans with `newLoanMessageSentAt IS NULL`; marks it on success; a loan whose synchronous send already succeeded is not retried.~~ **Removed — see "Extended further, same day" above.**
- [x] `account_summary` cron (updated): sends to every client with an active loan, empty/$0 when a client has nothing pending — see `accountSummary.service.spec.ts`'s `runActiveClientSummaries` describe block.
- [x] `WhatsappCronService`: reschedule takes effect without a redeploy (same guarantee the old pause/resume mechanism already had).
- [x] Manual retry: succeeds and logs correctly (new log row linked via `retryOfMessageLogId`, original row's `retriedAt` set); retrying an already-`sent` message is rejected with a clear error.

### Swagger
- [x] New/changed endpoints documented.

## Definition of done for this phase

- An admin can create and edit a group of clients attached to a message template.
- The confirmed additive interaction with dynamic recipient logic, and the empty/$0-send rule, are implemented exactly as agreed — not guessed.
- All four message types have an admin-editable cron schedule.
- A failed message can be manually retried without losing the original log entry.
- All items in `docs/DEFINITION_OF_DONE.md` checklist pass.

## After this phase

Update `docs/GLOSSARY.md` with "Message audience / Grupo de destinatarios" and `docs/DATABASE.md` with the new tables.

## Related documents

- `docs/phases/PHASE_5_WHATSAPP.md`, `docs/phases/PHASE_9_MESSAGE_TYPES.md` — the templates/cron/log model this phase extends
- `docs/DATABASE.md` — "Changed after Phase 9" section, the decision this phase does not reopen
