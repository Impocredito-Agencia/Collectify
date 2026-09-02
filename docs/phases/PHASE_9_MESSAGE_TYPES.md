# Phase 9 — Additional WhatsApp message types

**Superseded by Phase 33** (`docs/phases/PHASE_33_MESSAGE_TEMPLATES_V2.md`): the 4-type catalog this phase introduced (`new_loan`, `upcoming_due`, `overdue`, `account_summary`) was replaced by 13 real Meta-approved templates — `account_summary` retired outright, the other three split into more specific variants. Kept here for history; see `docs/DATABASE.md`'s `message_templates` section for the current catalog.

## Goal

Phase 5 shipped exactly one message type: the weekly overdue reminder ("Deuda"). Real usage requires three more, all confirmed against real message examples shared by the client (see `mensaje.txt` at the repo root — not committed to `docs/`, kept as the source reference for this phase):

1. **New loan ("Primera vez")** — sent once when a pagaré is created, confirming the terms.
2. **Upcoming due reminder ("Aviso")** — sent as an installment approaches its due date, at a configurable set of day thresholds (default: 5, 3, and 1 days before).
3. **Account summary ("Estado de cuenta")** — on demand, lists every pending installment across all of a client's active loans (both overdue and not-yet-due) with computed values, ending in a grand total.

All four message types (including the existing overdue reminder) must use **admin-editable templates** — same rendered structure for every client, with dynamic placeholders (name, installment numbers, amounts, dates). This mirrors the pattern already built in Phase 5 for the overdue reminder.

## Required reading before starting

`docs/GLOSSARY.md`, `docs/DATABASE.md` (updated in this phase — read the updated version), `docs/phases/PHASE_5_WHATSAPP.md` (the existing overdue reminder this phase extends, not replaces).

## Scope decisions — read before implementing

These are judgment calls made to keep this phase shippable without guessing at business rules that are still open questions (see "Explicitly out of scope" below):

- **One `MessageTemplate` per type, not one global active template.** `MessageTemplate` gets a `type` column (enum: `new_loan`, `upcoming_due`, `overdue`, `account_summary`). "Only one active template" from Phase 5 becomes "only one active template **per type**" — enforced in `MessageTemplatesService.activate()`, scoped to the target template's type.
- **The account summary message covers both "list all active pagarés with values" and "total across all credits"** from the original request — one message, listing every pending installment (overdue or not) with its computed value, ending in a grand total. This was ambiguous in the original request (it could have meant two separate messages); combining them mirrors the existing overdue reminder's own structure (list + grand total) and avoids a redundant near-duplicate message type. Revisit if the client wants them split.
- **Account summary is on-demand only, no cron.** Unlike the overdue reminder (weekly, automatic) and the upcoming-due reminder (daily, automatic — it's time-sensitive), a full account statement is something the admin sends when a client asks for their status, not something that should land in every client's WhatsApp automatically. Triggered via `POST /api/v1/whatsapp/clients/:clientId/send-account-summary`.
- **New loan message is synchronous, sent at creation time** (and at refinance time — a refinance creates a new loan) from `LoansService`, not from a cron. `WhatsappModule` is imported into `LoansModule` for this (one-directional dependency — `WhatsappModule` does not depend on `LoansModule`, so this isn't circular). A failed send is logged and does **not** fail loan creation — same "messaging failures are a business outcome, not an application error" principle used throughout Phase 5.
- **`Loan` gets a new optional `description` column** (free text) to support the "por concepto de X" part of the new-loan message. Nothing in the confirmed data model had a place for this; `installments`/`payments` already have a similar free-text `observation`/`notes`-style field, so this follows that precedent. Not required — a loan can be created without it, and the placeholder renders empty if absent.
- **`MessageLog` gets a `type` column** mirroring `MessageTemplateType`, so message history can be filtered by type. Existing rows are backfilled to `overdue` (that's what they all were, per Phase 5 scope).
- **`MessageLogItem`'s existing `overdue_days_snapshot`/`interest_snapshot` columns are reused as-is for all message types**, not extended. For a future/not-yet-due installment, both are legitimately `0` — `enrichInstallment()` already returns `0` for both when an installment isn't overdue, so this isn't a special case, it's the same function doing what it already does. **"Days until due" for the upcoming-due message is not stored as a separate structured column** — the fully rendered `message_content` on `MessageLog` already preserves it as text, which satisfies "what did we actually tell this client" without a schema change. Revisit if the account/collector team needs to query on it later.

## Explicitly out of scope for this phase

- **Automatic interest-rate tiering by loan amount** (the "6% under 1M, 5% over" rule). This remains the open question already tracked in `docs/DATABASE.md` and `docs/GLOSSARY.md` — verified against `LIBRO PARA COBRAR.xlsx` to have at least one real counter-example (pagaré #730: $926.000 at 4%, not 6%). Do not touch `calculateInterest` or `Loan.interestRate` assignment in this phase.
- **City / affiliated-commerce fields** seen in some real "Primera vez" examples (e.g. "en la ciudad de PASTO con el comercio afiliado PUBLIMARK TEC"). The generic `Loan.description` field covers this if the admin types it in manually; dedicated structured columns are not being added without a clearer confirmed need across more examples.
- **Frontend work** — `apps/client` is out of scope per `CLAUDE.md`.

## Scope

### Entities and migrations
- [ ] `MessageTemplate`: add `type` column (enum: `new_loan`, `upcoming_due`, `overdue`, `account_summary`), `NOT NULL`. Migration backfills existing rows to `overdue`.
- [ ] `MessageLog`: add `type` column, same enum, `NOT NULL`. Migration backfills existing rows to `overdue`.
- [ ] `Loan`: add nullable `description` column (`TEXT`).

### Message template system
- [ ] `MessageTemplatesService.findActiveOrThrow(type)` — scoped by type, replacing the old global lookup.
- [ ] `MessageTemplatesService.activate(id)` — deactivates other templates **of the same type** as the one being activated, not all templates globally.
- [ ] `CreateMessageTemplateDto`/`UpdateMessageTemplateDto` — require/accept `type`.

### New loan message ("Primera vez")
- [ ] `renderNewLoanMessage()` in `whatsapp/messageRenderer.ts` — placeholders: `{{clientFullName}}`, `{{promissoryNoteNumber}}`, `{{loanDescription}}`, `{{disbursedAt}}`, `{{totalInstallments}}`, `{{installmentsSummary}}` (single value if all installments are equal, otherwise a short breakdown).
- [ ] `NewLoanReminderService.sendNewLoanMessage(loanId)` in `whatsapp` module.
- [ ] Hook into `LoansService.create()` and `LoansService.refinance()` — fire-and-log-on-failure, never blocks the loan operation itself.

### Upcoming due reminder ("Aviso")
- [ ] `UPCOMING_DUE_REMINDER_DAYS` env var (comma-separated day thresholds, default `5,3,1`) and `UPCOMING_DUE_REMINDER_CRON` env var (default `0 8 * * *`, daily).
- [ ] `renderUpcomingDueMessage()` — same list structure as the overdue message but "vence en N días" instead of "venció hace N días", **no grand total line** (matches the real "Aviso" example, which has no total).
- [ ] `UpcomingDueReminderService` — groups by client (same rule as overdue: one consolidated message per client, across all their active loans), for installments whose `due_date` matches exactly one of the configured thresholds.
- [ ] `UpcomingDueReminderCron` — daily, pause/resume via `SchedulerRegistry`.
- [ ] `POST /api/v1/whatsapp/cron/upcoming-due/pause` / `resume`, `POST /api/v1/whatsapp/clients/:clientId/send-upcoming-due` (manual trigger).

### Account summary ("Estado de cuenta")
- [ ] `renderAccountSummaryMessage()` — lists every pending installment (overdue or not) across all active loans, using "vence en N días" or "venció hace N días" per line depending on sign, ending with a grand total.
- [ ] `AccountSummaryService.sendAccountSummary(clientId)`.
- [ ] `POST /api/v1/whatsapp/clients/:clientId/send-account-summary` (manual trigger only, admin only).

### Tests (mandatory, per `docs/TESTING.md`)
- [ ] Message rendering: each new renderer — single installment, multiple installments/loans, equal vs. unequal installment amounts (new loan), overdue vs. upcoming mixed (account summary).
- [ ] `MessageTemplatesService`: activating a template only deactivates others of the same type.
- [ ] `NewLoanReminderService`, `UpcomingDueReminderService`, `AccountSummaryService`: happy path, no eligible installments, WhatsApp send failure still logs the attempt.
- [ ] `LoansService`: loan creation still succeeds when the new-loan message send fails.

### Swagger
- [ ] All new endpoints documented.

## Definition of done for this phase

- Same bar as Phase 5's, plus: seeded test data produces all three new message types matching the real formats in `mensaje.txt`.
- All items in `docs/DEFINITION_OF_DONE.md` checklist pass.

## Related documents

- `docs/phases/PHASE_5_WHATSAPP.md` — the overdue reminder this phase extends
- `docs/DATABASE.md` — updated schema for `message_templates`, `message_logs`, `loans`
- `docs/GLOSSARY.md` — updated with the three new message-type terms
