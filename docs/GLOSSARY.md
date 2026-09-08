# Glossary

This document defines the business vocabulary used throughout the codebase, database, and documentation. A term defined here should be used consistently everywhere. This version was revised after reviewing the client's real spreadsheets and WhatsApp message examples — it replaces earlier assumptions with confirmed business terms.

## Core entities

### Client
A person who has received one or more loans from the company. In code: `Client` entity, `clients` table. Identified by full name, national ID (`document_number`), and phone number. Added Phase 21: an extended profile (address, employment, income, ID/selfie photo URLs) and a data-processing consent record — see "Data-processing consent" and "Referencia (personal / comercial)" below.

### Referencia (personal / comercial)
A personal or business contact the client provides as a reference — a dynamic, add-many list per client with no fixed minimum or maximum (Phase 21). In code: `ClientReference` entity, `client_references` table, `type` of either `personal` or `comercial`.

### Codeudor / Co-debtor
A person who co-signs a specific loan alongside the primary client, jointly responsible for it. Belongs to the **loan**, not the client, because whether a given loan has one varies per loan (Phase 21) — at most one per loan. As of Phase 26, a co-debtor is an existing `Client` linked by id (`Loan.coDebtorClientId`) rather than free-typed — functionally, a co-debtor is just another client of the business, so they're picked from existing clients, not re-entered by hand. A client can be co-debtor on more than one loan, but cannot be both the primary debtor and the co-debtor on the same loan. `coDebtorRelationship` (relación con el deudor principal, free text) stays a standalone column on `Loan`, since it describes this specific loan's relationship rather than a property of the co-debtor themselves. On refinancing, the new loan carries the old loan's co-debtor over by default unless the refinance request explicitly overrides a field.

### Data-processing consent
Whether the client has authorized the business to collect and process their personal data, per Colombia's Ley Estatutaria 1581 de 2012 ("Habeas Data"). The actual authorization must happen physically/in person — this software only records that it happened (a checkbox in `ClientForm`, required for interactively-created clients, exempt for Excel imports), stamped with a server-side timestamp. In code: `Client.dataProcessingConsent`, `Client.consentGivenAt`, `Client.consentDocumentUrl`. See `docs/phases/PHASE_21_CLIENT_PROFILE.md` for the full legal reasoning.

### Cupo (credit limit)
The maximum credit exposure a client is allowed to carry at once. Optional — a client with no cupo set has no limit enforced. In code: `Client.credit_limit`, nullable.

**"Cupo usado" (credit used)** — confirmed with the client (Phase 10) to be capital plus interest accrued to date across the client's active loans' still-pending installments, i.e. the same `outstandingBalance` sum already computed per loan. Not stored; computed on read (`ClientsService.getCreditUsage`). A new loan is rejected if its principal would push the client past their available cupo (`creditLimit - creditUsed`).

**Mora block** — a client with any single installment more than 30 days overdue on an active loan cannot receive a new loan, regardless of remaining cupo. This is per-installment, not a client-aggregate rule (confirmed with the client, Phase 10) — one overdue cuota is enough, even if every other installment is current. See `docs/phases/PHASE_10_CLIENT_CAPACITY.md` and `DATABASE.md`'s "Changed after Phase 10".

### Loan / Pagaré
The Spanish business term is **pagaré** (promissory note) — this is what the client calls it in every message and spreadsheet, always referenced by number (e.g. "pagaré #743"). In code: `Loan` entity, `loans` table, with a `promissory_note_number` field holding this business-facing identifier (distinct from the internal UUID `id`).

**Terminology, 2026-09-03 (client request):** `principalAmount` is labeled **"Capital"** everywhere in the UI, not "Monto" — the client pointed out that "Monto" was used inconsistently with "Capital" (e.g. `LoanDetailPage`'s "Saldo capital a la fecha" card already said "capital") and that abbreviations like the loan table's old "Monto (s/inc.)"/"Saldo (c/inc.)" column headers were unclear to a first-time reader. Spelled out in full now: "Capital inicial" / "Saldo total (capital + incremento)" — the second one went through two rounds ("Saldo (c/inc.)" → "Saldo con incremento" → the current explicit formula, after the client felt "con incremento" alone didn't make clear it's capital-plus-mora rather than a separate figure) and is now used consistently everywhere `outstandingBalance` appears: the Préstamos/client-loans table columns AND the loan detail's own stat card (previously "Saldo pendiente con incremento" there specifically — unified 2026-09-03). Also: "Capital original sin incremento" (the loan detail's principalAmount card), "Capital"/"Capital renegociado"/"Capital a financiar"/"Capital prestado" (create/refinance/quote forms and the client summary). "Monto" is still correct and unchanged for genuinely different figures — a payment's amount, an installment's total cuota, dashboard mora totals, and outbound WhatsApp message wording (a different surface, not touched here) — since those aren't the loan's principal/outstanding-balance pair.

**Format, standardized 2026-09-03 (style cleanup, confirmed with the client):** every new loan's number must match `#0000` — a `#` followed by at least 4 digits (`CreateLoanDto`'s `@Matches(/^#\d{4,}$/)`). `LoanForm` pre-fills the field with the suggested next number (`GET /loans/next-promissory-note-number` — highest existing numeric part + 1, zero-padded), but it stays editable and is still uniqueness/format-checked on submit either way. The ~1190 pre-existing loans (some like `"1"`, `"124"`, `"#743"` — inconsistent lengths, some missing the `#`) are **not** being reformatted; this rule only applies going forward. Since the real count was already past 1000 at the time this shipped, no loan created from now on actually needs zero-padding in practice — the format mostly just guarantees the `#` prefix and rejects non-numeric values. `\d{4,}` (not a fixed `{4}`) so nothing needs to change once the count eventually passes 9999 and a 5th digit is needed.

**Redesign, 2026-09-06 — refinancing keeps the SAME number, doesn't get a new one.** `RefinanceLoanDto` no longer has a `promissoryNoteNumber` field at all: `LoansService.refinance()` now sets the new loan's number server-side from the loan it's replacing, matching how the business actually treats a refinance ("el pagaré #0800 refinanciado sigue siendo el #0800"). `RefinanceLoanForm` no longer asks for or suggests a number. A genuinely new loan is unaffected and still permanently blocked from reusing any number that ever belonged to another loan, of any status — only a loan's own refinancing chain may carry its number forward. See `docs/DATABASE.md`'s "Refinancing" section for the full mechanics, including the DB-level uniqueness scoping this required.

A client can have multiple loans active simultaneously.

### Installment / Cuota
A single scheduled payment within a loan. A loan is divided into a fixed number of installments (`total_installments`), each with its **own due date and own amount** — installments are not always equal in amount, per real data. In code: `Installment` entity, `installments` table.

**This is the central unit of the business.** Overdue status, interest, and reminders all operate at the installment level, not the loan level.

**Cuota inicial (down payment)** — redesigned 2026-09-03: it IS one of the loan's installments, always `installment_number` 1 when present. The client negotiates a down payment up front (e.g. $1,000,000 of a $5,000,000 purchase), collected on its own admin-chosen date with zero ordinary interest; installment 2 onward covers the remaining capital with the usual amortization/interest. Mora still applies if it's missed. In code: `Installment.isDownPayment` (boolean), plus `CreateLoanDto`/`RefinanceLoanDto`'s `downPaymentAmount`/`downPaymentDueDate`. Replaces Phase 13's `Loan.initialPayment` model, which was mal planteado (purely informational, not a real installment) — see `docs/phases/PHASE_13_INITIAL_INSTALLMENT.md` for that superseded design.

### Payment / Pago
A record of money received against a specific installment. An installment can receive multiple partial payments. In code: `Payment` entity, `payments` table.

**Comprobante (deposit receipt photo)** — added Phase 12: a payment can optionally carry a photo of the deposit/receipt, alongside its existing free-text `observation`. In code: `Payment.imageUrl`, nullable — the api only stores the URL, hosted externally (Cloudinary); it never receives the image bytes. See `docs/phases/PHASE_12_PAYMENT_ATTACHMENTS.md`.

## Status and mora

### Overdue (Mora / Vencido)
An installment whose `due_date` has passed without being fully paid. Calculated on read as `today - due_date`, never stored (see `DATABASE.md`). "Días de mora" = the number of days since the due date passed.

**Bug fix, 2026-09-04:** "today" here means today's CALENDAR DATE in Bogotá, not the exact instant `today - due_date` is evaluated at — the original implementation compared exact instants instead and silently shifted every day-count by 1 (2 after 7pm Bogotá), always making an installment look due/overdue earlier than the calendar actually says. See `DATABASE.md`'s "Bug fix, 2026-09-04" note under `installments` for the full analysis.

**Important:** overdue is a property of an *installment*, not a loan. A single loan can simultaneously have some installments overdue and others current.

### Días de mora
Literally "days of default" — the number of days an installment has been overdue. This exact phrase appears in both source spreadsheets as a column header (`DIAS MORA`) and is the number quoted directly to clients in reminder messages ("venció hace 45 días").

### Interest / Interés (mora interest)
The extra amount added to an overdue installment, calculated using this confirmed formula:

```
interest = installment_amount × (interest_rate / 100) / 30 × overdue_days
```

Confirmed by cross-checking multiple real examples in `LIBRO_PARA_COBRAR.xlsx` — the formula matches exactly. This is distinct from any interest that might be part of the original loan terms; this specifically refers to the penalty/mora interest accruing because a payment is late.

**Changed after Phase 23:** this formula is now only the *fallback* used for a loan with no moratory concepts assigned (every loan created before Phase 23, and any new loan the admin doesn't attach moratory concepts to). A loan with at least one moratory concept sums that loan's own concepts instead — each computed live, on read, the same way as this formula (percentage concepts use the identical shape; a fixed-amount moratory concept is a flat one-time charge, unscaled by `overdue_days`) — see "Interest concept type" / "Interest concept" below and `docs/phases/PHASE_23_DYNAMIC_CHARGES.md`.

**Bug fix, 2026-09-08 — 8-day grace period before mora is ever charged, not just before it's mentioned.** `docs/phases/PHASE_33_MESSAGE_TEMPLATES_V2.md`'s Template 6 note ("the business doesn't charge mora until day 9") was only ever enforced in which WhatsApp template/wording got picked (`reminderTemplateSelection.ts`'s `overdueDays > 8` check) — the formula above (and its per-concept Phase 23 equivalent) had no such gate at all, so `interest`/`totalDue` silently included mora starting `overdue_days = 1` everywhere else it's read: the self-service "Más información" breakdown, a loan's Total column, the Dashboard, cupo, and the payment ceiling. Confirmed with the human: `overdue_days ≤ 8` → `interest = 0`; `overdue_days > 8` → the formula above applies over the FULL `overdue_days` (no day-8 offset — day 9 is charged as 9 days of mora, not 1). See `docs/DATABASE.md`'s note of this date and `installmentCalculations.ts`'s `MORA_GRACE_PERIOD_DAYS`.

### Interest rate / Tasa de mora
The percentage used in the interest formula above. **Confirmed to vary per loan** in real data (values of 4%, 5%, and 6% found across loans, not cleanly tied to loan amount despite an informal rule the client mentioned). Current working assumption: this is a fixed value set manually per loan, editable, defaulting to a system-configured standard rate. **The exact business rule for how this rate is chosen or whether it changes over time is still pending confirmation with the client** — see the open questions in `DATABASE.md`.

**Changed after Phase 14:** this is now moratory-only — a loan's ordinary cost is priced entirely through interest concepts (see "Interest concept type" / "Interest concept" below) instead of this single rate. `interest_rate` still drives the mora formula above on overdue installments, unchanged in that role.

**Superseded after Phase 23:** even its moratory role is now just the fallback for a loan with no moratory concepts assigned — see "Interest / Interés (mora interest)" above.

**Renamed after Phase 31:** users were misreading `interest_rate`'s UI label ("Tasa de interés") as a charge separate from the mora ceiling, rather than the ceiling that already covers every additional charge stacked on top of it. Relabeled to "Incremento consolidado en caso de mora" everywhere it's shown/edited in the client app (`LoanDetailPage.tsx`, `EditLoanDialog.tsx`) — no change to the underlying field, column name, or formula, copy only. See `docs/phases/PHASE_31_LOAN_TERMINOLOGY.md`.

**Shortened 2026-09-04:** "Incremento consolidado en caso de mora" wrapped to two lines in LoanDetailPage's stat-card grid, pushing that card's value out of vertical alignment with its neighbors. Shortened to **"Incremento en mora"** in both places (same meaning, same field, copy only) so it fits on one line at that card width.

**`EditLoanDialog.tsx` tried and reverted, same day (2026-09-04):** the client noticed this field was already dead for any loan with moratory concepts assigned (essentially every loan since Phase 254 — see "Superseded after Phase 23" above), since editing it changes nothing `calculatePayoff.ts`/`enrichInstallment.ts` actually read for those loans. `EditLoanDialog` briefly showed "Incremento en mora (%)" only for a loan with zero moratory concepts assigned, and editable moratory-concept values (Intereses moratorios, Gastos de cobranza, etc.) for every other loan. After seeing it in practice the client decided neither was useful enough to keep — see `docs/DATABASE.md`'s `loan_installment_concepts` note for the final call. `EditLoanDialog` now only edits `description`; its trigger also moved off the top action bar onto the Descripción line itself on `LoanDetailPage`, so the narrower scope reads as obvious from where the button lives. Creating or refinancing a loan now also requires confirming a warning dialog (`ConfirmCreateLoanDialog` in `LoanForm.tsx`, `ConfirmRefinanceDialog` in `RefinanceLoanForm.tsx`) before the mutation fires — spelling out that the loan's numbers are final from that point on and that the client's WhatsApp message goes out immediately on confirm. `interest_rate` itself was NOT removed (client asked directly) — it's still the only formula a pre-Phase-23 loan has, so removing it would need a full audit of the loan book first; it's just no longer editable by anyone post-creation.

### Interest concept type / Tipo de concepto de interés
Added Phase 14 — an admin-managed, reusable definition of a kind of charge a loan can carry (e.g. "Interés remuneratorio", "Gastos de cobranza", "Uso de plataforma"): a name, a default calculation type (percentage or fixed amount), and an optional default value. The admin can create, edit, or deactivate these at any time — confirmed with the client this must never require a code change to add or reprice a concept. In code: `InterestConceptType` entity, `interest_concept_types` table. See `docs/phases/PHASE_14_INTEREST_CONCEPTS.md`.

**Extended Phase 23:** every type now also has a `category` (`corriente` or `moratorio` — see "Interest / Interés (mora interest)" above) and, for a fixed-amount `corriente` type, a required `fixedAmountDistribution` choosing whether its total splits evenly across every installment or is charged in full on every installment (`repeated_each_installment`, renamed 2026-09-03 from `first_installment_only` — the client had no use for a one-off first-installment charge). See `docs/phases/PHASE_23_DYNAMIC_CHARGES.md`.

**Extended 2026-09-03 (bug fix):** a percentage-only type can be flagged `isUsuryRateConcept` — the mandatory, non-removable usury-rate concept for its category. At most one per category; the loan form always includes it as a locked row, and `LoansService` rejects a loan create/refinance/preview that omits it. Replaces the old standalone "Tasa de interés moratorio (%)" input on `LoanForm`/`RefinanceLoanForm`, which the client found confusing next to the (previously optional) moratory concept picker — see `docs/DATABASE.md`'s "Bug fix, 2026-09-03" section.

**Extended 2026-09-03 (client request, later the same day):** an already-deactivated type can now also be permanently deleted (`DELETE /interest-concept-types/:id`, "Eliminar" on `InterestConceptTypesPage`'s Desactivados tab) — but only if it was never used on any loan. A type created by mistake (typo, wrong category) and never actually assigned can be fully removed instead of sitting deactivated forever; one that's already been used on at least one loan can only stay deactivated, so the reporting link back to the catalog is never silently lost. Mirrors the deactivate-then-delete pattern `users` already uses. See `docs/DATABASE.md`'s `interest_concept_types` table note and `InterestConceptTypesService.remove()`.

### Interest concept / Concepto de interés
Added Phase 14 — one instance of an interest/fee concept applied to a specific installment, snapshotted from an `InterestConceptType` at the moment the loan's amortization schedule was generated (name, calculation type, value, and the resulting currency amount all copied at that point). A loan's concepts are fixed for its whole term, set once at creation — not overridable per installment. (This was originally justified as what makes a level-payment "cuota fija" schedule well-defined; that amortization method was itself reversed 2026-09-04 back to capital fijo — see the entry below — but concepts being fixed per loan, not per installment, still holds independently.) Editing or deactivating the catalog type afterward never changes an already-created loan's numbers — this snapshot behavior is deliberate and confirmed with the client. In code: `LoanInstallmentConcept` entity, `loan_installment_concepts` table.

## Loan status

### Active
A loan with at least one installment not yet fully paid, not refinanced. In code: `status: 'active'` on `Loan`.

### Paid
A loan whose every installment has been fully paid. In code: `status: 'paid'`.

### Refinanced / Refinanciado
A loan that has been closed out and replaced by a new loan — typically because the client couldn't keep up with the original schedule and the remaining balance (plus accrued interest) was restructured into a new set of installments under a new *pagaré* number. Confirmed directly from real data (e.g. `REFINANCIADO #981`, `SE REFINANCIO EN EL #1000`). In code: `status: 'refinanced'`, with the new loan pointing back via `refinanced_from_loan_id`.

> This business does not use a "charged-off" concept (a loan formally written off as uncollectable). If that need arises later, it would be a new status and a new process to design, not something built preemptively.

## Communication

### Overdue reminder
The automated WhatsApp message sent weekly to a client, summarizing **every overdue installment across all of their loans** in a single message, ending with a grand total to pay. Confirmed from real message examples — this is not one message per loan or per installment, it's one consolidated message per client.

Example structure (from a real message, translated structurally):

```
[Client greeting]
1️⃣ Installment No. X of pagaré #Y for $Z (interest included) — overdue N days.
2️⃣ Installment No. X of pagaré #Y for $Z (interest included) — overdue N days.
[... one line per overdue installment ...]
The amount due today is $[grand total]
```

### New loan message / Mensaje de primera vez
Sent once, automatically, when a pagaré is created (or when a refinance creates a new one) — confirms the pagaré number, concept, effective date, and installment terms to the client. Unlike the overdue reminder, this is per-loan, not consolidated across a client's other loans, since it's announcing one specific new obligation. Added in Phase 9 — see `docs/phases/PHASE_9_MESSAGE_TYPES.md`.

### Upcoming due reminder / Aviso
The automated WhatsApp message sent as an installment approaches its due date, at a configurable set of day thresholds (default 5, 3, and 1 days before). Like the overdue reminder, it's consolidated **by client** across all their active loans. Unlike the overdue reminder, it has no grand total line (confirmed from the real "Aviso" message example) and doesn't include mora interest, since the installment isn't overdue yet. Added in Phase 9.

### Account summary / Estado de cuenta (retired — Phase 33)
**Retired outright as of Phase 33**, confirmed by the human — no replacement template. A WhatsApp message listing **every pending installment** for a client — both overdue and not-yet-due — across all their active loans, with a grand total. This was the "full statement" version of the overdue reminder, added in Phase 9. The `POST /whatsapp/clients/:clientId/send-account-summary` endpoint and its service were removed.

### Message template / Plantilla de mensaje
The fixed pattern used to generate a message. **Changed after Phase 33** (see `docs/phases/PHASE_33_MESSAGE_TEMPLATES_V2.md`): there are now 13 real, Meta-approved templates instead of the old 4 broad types — new loan and refinance split into 5 templates by new/existing client and with/without cuota inicial, "próxima a vencer"/"vencida" split by count and days overdue, plus two new templates (confirmación de pago, paz y salvo) that didn't exist before. `type` is still unique — exactly one `message_templates` row per template. See `DATABASE.md` for the full catalog.

**Content is not admin-editable**: WhatsApp only allows a business-initiated message outside the 24h reply window through a template Meta has pre-approved, so a freely-editable `content` field in our own database would misrepresent what can actually be changed without breaking delivery. As of Phase 33 this is enforced for real — every send goes through Meta's actual Template Messages API (`WhatsAppService.sendTemplateMessage`), not a self-rendered plain-text message; the admin can view the current template per type (`GET /message-templates`), but changing its content is a migration, matching whatever Meta has approved. **The send schedule IS admin-editable** (Phase 18) — see `cronExpression` below; as of Phase 33 this applies per reminder *family* (one schedule for "vencida", one for "próxima a vencer"), not per exact template.

### Nota adicional
A single closing-line parameter shared by every reminder/confirmation template (4 through 10, see `docs/phases/PHASE_33_MESSAGE_TEMPLATES_V2.md`), filled with exactly one of three fixed strings depending on the client's situation: the normal closing ("Quedamos atentos a cualquier consulta"), a note about a **saldo pendiente** (an incomplete/partial payment already registered on one of the installments being mentioned), or a note about a **saldo a favor** (an overpayment). Exists because a Meta template can't show or hide a line conditionally — the backend always fills this one parameter with the right variant instead. Saldo pendiente is derived directly from existing `Payment` rows (no new schema); saldo a favor detection is currently narrow — only the exact overpayment on the payment that just completed an installment, not a running client-level credit balance, since netting a credit against a future installment was explicitly deferred to a manual operator action.

### Message audience / Grupo de destinatarios (retired — Phase 27)
**Retired as of Phase 27** (see `docs/phases/PHASE_27_MESSAGE_FREQUENCY.md`); kept here for history. Was a curated group of clients attached to a message template (Phase 18) — only `overdue`/`upcoming_due` ever actually used one, as a **required filter**: a client was only reminded if they BOTH dynamically qualified AND were a member of that template's audience, and an empty audience meant nobody was reminded by that job at all, even if clients qualified. That filter is gone: every dynamically-qualifying client is messaged again by default, with no group to populate first — the pre-Phase-18 behavior, restored. `GET`/`PUT /message-templates/:type/audience` were removed entirely. The `MessageAudience` entity and `message_audiences`/`message_audience_clients` tables are **not dropped** (may still hold historical meaning) but are no longer read by any service. See "Message frequency whitelist" below for what replaces it.

### Message frequency whitelist
Added Phase 27, replacing the `overdue`/`upcoming_due` curated-audience-as-required-filter design above. A per-client, optional entry (`ClientMessageFrequency`) that throttles **how often** those two reminder types reach a specific client — it never controls **whether** they're eligible (that's still purely dynamic: has an overdue installment / one approaching due). A client with no entry is never throttled. `minimumDaysBetweenMessages` is set freely by the admin per client from that client's own profile (no hardcoded default) — e.g. ~7 days for a "preferential" client the business wants messaged less often than the normal cadence. A throttled skip is silent by design: no internal record is kept of a client being evaluated and skipped for being inside their window (unlike the old audience-member-with-nothing-to-report rule, which doesn't apply here). Out of scope: `account_summary` (sends to every client with an active loan, unaffected) and `new_loan` (synchronous-only, unaffected). In code: `ClientMessageFrequency` entity, `client_message_frequencies` table; `GET`/`PUT`/`DELETE /clients/:id/message-frequency`; `MessageFrequencyThrottleService` in the whatsapp module.

### Message log
A historical record of a reminder actually sent to a client — one row per client per week it was sent, **not** one row per installment. Append-only: a failed send is never edited or deleted, only manually retried (Phase 18), which creates a **new** log row (`retryOfMessageLogId` points back at the original) and stamps `retriedAt` on the original — the original always stays as the true record of that attempt. In code: `MessageLog` entity, `message_logs` table; `POST /message-logs/:id/retry`.

### Message log item
A single installment's contribution to a sent message log — since one message covers several installments, this table records each one along with a **snapshot** of its overdue days and interest at the exact moment the message was sent (these values change daily, so the snapshot preserves what the client was actually told). In code: `MessageLogItem` entity, `message_log_items` table.

### Inbound message
Added Phase 22 — any WhatsApp event a client sends *to* the business: a template's quick-reply button tap, or free text sent unprompted. The first thing Collectify has ever received rather than only sent. Logged unconditionally, whether or not the sender's phone number matches a known client. In code: `WhatsappInboundMessage` entity, `whatsapp_inbound_messages` table. **As of Phase 34, a known client's button tap or unprompted free text triggers the self-service menu below** (see "Menú de autoservicio"); an unrecognized number is still only logged, no automated reply. **Whether a client's stated preference (e.g. a "No") persists is still an open question** — see `docs/phases/PHASE_22_WHATSAPP_WEBHOOK.md`.

### Menú de autoservicio / Self-service menu
Added Phase 34 — the WhatsApp interactive-buttons flow a known client reaches by texting the business unprompted, or by tapping "Volver al menú" from any of its actions: a flat 3-option main menu (Mi cuenta / Reportar un pago / Hablar con asesor), and a submenu under "Mi cuenta" (Estado de cuenta / Cuotas pendientes / Historial de pagos). A small fixed set defined in code (`selfServiceMenuPayloads.ts`), not an admin-managed catalog — the client didn't ask for one. Each terminal action (breakdown, payment history, receipt collection, human handoff) reuses an existing mechanism rather than introducing a new one — see "Estado de conversación" below for how the backend tracks which screen a client is on. In code: `SelfServiceMenuService`, `apps/api/src/whatsapp/`. See `docs/phases/PHASE_34_INTERACTIVE_MENU.md`.

### Estado de conversación / Conversation state
Added Phase 34 — per-phone-number, ephemeral record of which self-service-menu screen a client is currently on (`main`, `mi_cuenta_submenu`, `awaiting_receipt`, or `handed_off_to_human`), so "Volver al menú" returns to the right one. Expires with the same 24h session window Meta itself uses for a client's messages; an expired row is treated as "no state" rather than physically deleted. Only exists for known clients — see "Inbound message" above. In code: `WhatsappConversationState` entity, `whatsapp_conversation_states` table, `WhatsappConversationStateService`.

**`handed_off_to_human`** (added 2026-09-02, bug fix): the bot goes completely silent for that phone number — no automated replies at all, even to a stray free-text message — until an admin explicitly taps "Cerrar conversación" on the inbound-messages inbox, which sends a generic closing message and clears the state. Entered when a client submits a payment receipt image or taps "Hablar con asesor". See `docs/phases/PHASE_34_INTERACTIVE_MENU.md`'s "Bug fix, 2026-09-02" section.

## Financial terms

### Principal amount / Monto principal
The total amount financed for a loan, before considering mora interest. Referred to as `TOTAL` or `SALDO TOTAL` in the source spreadsheets. In code: `principal_amount` on `Loan`.

### Amortization method / Capital fijo
**As of 2026-09-04, confirmed with the human against the client's real Excel loan calculator:** the underlying schedule is computed as **capital fijo** ("German"-style) — the principal portion is split evenly across every installment (`principal_amount / total_installments`, last installment absorbs the rounding remainder), and every percentage-type concept (corriente/moratorio interest, catalog fees) is computed on the outstanding balance *before* that installment's own principal is deducted. This reverses Phase 14's earlier "cuota fija" (level-payment/French, `corePayment = P × r / (1-(1+r)⁻ⁿ)`) decision — see `docs/phases/PHASE_14_INTEREST_CONCEPTS.md`'s superseded note.

**"Cuota con interés" smoothing (same conversation, 2026-09-04):** the client doesn't actually charge capital fijo's true declining totals — each concept's true per-period value is averaged across the whole loan and rounded to the nearest $1,000, then charged as one flat, identical amount every installment (including the last). This matches how the client's own Excel works: people want to pay a round number like $124,000 every month, not a different figure each time. Total interest is unaffected by the averaging step itself; the $1,000 rounding on top is a small, bounded nudge (at most ~$500 × total_installments over the loan's life). Every individual concept is smoothed this way, not just the aggregate total — confirmed with the human. See `apps/api/src/loans/amortization/generateSchedule.ts` for the implementation.

### Disbursement / Desembolso
The act of giving the loan amount to the client. `disbursed_at` on the `Loan` entity.

### Installment frequency / Periodicidad
How often installments occur. Source data consistently shows `MENSUAL` (monthly); the system supports this as an enum in case other frequencies come up later.

### Tasa de usura / Usury rate
Added Phase 15 — Colombia's legal ceiling on lending cost, certified monthly by the Superintendencia Financiera de Colombia (calculated as 1.5× the "Interés Bancario Corriente"). A single global value in this system (does not vary by credit modality), admin-entered each month since there's no free official API for it. Non-retroactive: a new month's rate never changes interest already caused under a prior month's rate. In code: `UsuryRate` entity, `usury_rates` table (historical, append-only), `UsuryRateService`. See `DATABASE.md`'s `usury_rates` section.

**Superseded after Phase 24:** originally enforced as a warning at creation/refinance time (comparing the loan's maximum per-installment effective rate against the ceiling). Now a hard block instead — a loan can't be created, refinanced, or even previewed without the current calendar month's rate on file. See `docs/phases/PHASE_24_USURY_MANDATORY.md` (replaces `docs/phases/PHASE_15_USURY_RATE.md`'s enforcement model).

**Revised again, 2026-09-03 (same day, client request):** Phase 24's "every percentage concept priced at exactly the ceiling, not admin-editable" rule is gone — charging less than the legal max is a legitimate business choice; only charging more is the actual risk. Percentage concepts (corriente/moratorio) are now freely admin-editable. A sum-of-all-percentage-concepts hard block briefly existed the same day but was pulled again a few hours later — it couldn't distinguish "interés disfrazado" from a legitimate percentage-based service fee (seguro, cuota de manejo, aval, estudio de crédito), and building that distinction needs legal review first. A narrower per-concept cap was also tried and reverted the same day, at the client's request. **There is currently no backend or frontend enforcement of the usury ceiling on percentage concepts** beyond the disclaimers on the loan forms and on `UsuryRatesPage` — this is paused until the client has consulted a lawyer. See the "Paused, 2026-09-03" note at the bottom of `docs/phases/PHASE_24_USURY_MANDATORY.md` for the full reasoning.

**Redesigned, 2026-09-03 (final state):** the loan's own corriente/moratorio interest is no longer a catalog concept the admin flags/picks — it's `corrienteInterestRate`/`moratoryInterestRate`, a system field on the loan request that defaults to, and can only be lowered from, this ceiling ("editable solo hacia abajo"). See `docs/phases/PHASE_24_USURY_MANDATORY.md`'s "Redesigned" note and `LoansService.resolveConceptsWithInterest`.

**Annual vs. monthly, 2026-09-03 (client request):** the Superintendencia certifies this rate as an ANNUAL effective percentage for crédito de consumo y ordinario — published on its own press-release page (linked directly in `UsuryRatesPage.tsx`: [Superintendencia — Interés Bancario Corriente](https://www.superfinanciera.gov.co/publicaciones/10829/sala-de-prensacomunicados-de-prensa-interes-bancario-corriente-10829/)). Loan interest, though, is priced per installment (monthly or biweekly), so what actually needs to be applied is the equivalent MONTHLY effective rate. Until this date the admin computed that conversion by hand each month and typed only the result; now the admin enters the raw annual figure exactly as published (e.g. `29.24` for a real September 2026 example the client gave), and the API derives the monthly rate automatically — `(1 + annual)^(1/12) - 1`, standard effective-rate compounding, verified against the client's own real example (29.24% annual → 2.1605% monthly, matching the Superintendencia's own conversion page to 4 decimal places). Both figures are now stored (`UsuryRate.annualRatePercentage` and `.ratePercentage`) and shown side by side in the settings page and its history table; every downstream consumer of "the current usury rate" (loan/installment pricing) is unaffected — it still reads `ratePercentage`, just now computed instead of hand-typed, with more precision (widened from 2 to 4 decimal places — the old precision would have truncated 2.1605% to 2.16%). See `apps/api/src/usuryRates/convertAnnualToMonthlyRate.ts`. No historical data needed reconciling: confirmed with the client that no real rate had ever been entered in production before this change.

### Imputación del pago
Added Phase 16 — the Colombian Civil Code rule (Art. 1653) that when both interest and principal are owed, a payment settles interest first, and only the excess reduces principal — a client can never be forced to pay interest that hasn't been caused yet. Confirmed for this system: "interest" means moratory interest **and** every Phase 14 concept baked into an installment's `amount` (everything above `principalPortion`), not just moratory interest alone. See "Liquidación anticipada" below and `docs/phases/PHASE_16_EARLY_PAYOFF.md`.

### Liquidación anticipada / Early payoff
Added Phase 16 — closing a loan out today for less than the sum of its remaining installment totals would suggest, because future (not-yet-due) installments are charged at principal face value with zero interest — none has been caused yet. A separate, explicit action from an ordinary payment (confirmed with the human — `registerPayment` and its one-payment-per-installment behavior are untouched); always settles the full quoted amount, no partial early payoff. In code: `calculatePayoff()` (pure function, `loans/payoff/calculatePayoff.ts`), `GET /loans/:id/payoff-quote`, `POST /loans/:id/payoff`. See `docs/phases/PHASE_16_EARLY_PAYOFF.md`.

**Known gap, flagged 2026-09-07 — not yet fixed:** this flow bypasses the payment-ceiling fix described under "Cierre de cuota" below entirely. `calculatePayoff()`/`payoff()` compute each pending installment's payoff cost from scratch (`amount` + interest, at face value) and never subtract a payment already registered against that installment — so liquidating a loan that has a partially-paid pending cuota re-charges that cuota's full cost on top of what was already collected. Found during the #0920 investigation; scoped out of that fix and not yet resolved.

### Cierre de cuota / Closing an installment
Since Phase 4's original spec ("if accumulated payments cover the installment amount, mark it paid"), `registerPayment` only ever required covering `amount` (capital) to mark a `pending` installment `paid` — accrued moratory interest was silently forgiven the moment capital was covered, with no explicit decision behind it (this predates moratory interest even being a live, separately-tracked concept). Human report, 2026-09-07 — found while investigating préstamo #0920's overpayment bug (see `DATABASE.md`'s note of that date): the same investigation surfaced that mora was effectively optional/negotiable on every ordinary payment, not just the one that overpaid.

**Confirmed with the human, 2026-09-08:** closing a `pending` installment now requires covering its full live remaining balance — capital **and** accrued mora — not `amount` alone. This is independent of "Imputación del pago" above (which governs the *order* interest and principal are paid off in `Liquidación anticipada`, still unchanged and still not applied to `registerPayment`) — this is instead about the *threshold* for marking an ordinary payment's installment `paid` at all. Practically: a cobrador can no longer close an overdue cuota by collecting only its capital and forgiving the mora; the installment stays `pending` (and keeps accruing fresh daily mora on its own unchanging `amount` — never on mora already accrued, avoiding anatocismo) until the full balance is paid. Applies identically to `registerBulkPayments`, whose "must fully settle" rule now means the same full balance, not `amount` alone. See `DATABASE.md`'s note of this date and `InstallmentsService.registerPayment`'s own doc comment.

### Mora invisible en WhatsApp, Dashboard y cupo (fixed 2026-09-08)
Found while auditing the `#0920` payment-cap fix, in a separate follow-up branch — a distinct bug, not the same root cause as "Cierre de cuota" above. Every loan created since the Phase 23 redesign (#254) carries its real interest rate as a `LoanInstallmentConcept` row, not the legacy `Loan.interestRate` column (sent as a fixed `0` from the frontend for every new/refinanced loan — that column no longer does anything for a current loan). Four read paths — WhatsApp reminders and self-service menu, the Dashboard's overdue widget, and a client's cupo (`creditUsed`/`creditAvailable`) — never fetched a loan's real moratory concepts before asking for its mora, so they silently fell back to the legacy formula and reported **exactly $0 accrued mora**, no matter how overdue the cuota. The amount actually enforced at payment time (`registerPayment`'s ceiling) was never affected — it already fetched the real concepts correctly. See `DATABASE.md`'s note of this date for the full list of call sites and the fix.

## Roles

### Owner (Admin)
The business owner. Full system access — manages clients, loans, installments, templates, users, and configuration.

### Collector / Cobrador
Both a business role and a system role. In the business, whoever follows up on overdue clients — could be the owner or a dedicated person. In the system, `role: 'collector'` — can always view (read-only) Clientes, Préstamos, and Mensajes fallidos, regardless of module grants. Everything else — including *managing* Clientes/Préstamos/Mensajes (create/edit/delete/refinance/payoff, WhatsApp control), Plantillas, Conceptos de interés, Auditoría, Tasa de usura — is granted per individual collector via the `clients`/`loans`/`messages`/etc. module grants, not by role; Usuarios (account management) is the one module-independent exception, always admin-only — see "Module permission" below and `docs/phases/PHASE_20_MODULE_PERMISSIONS.md`. ~~Exact permission boundaries to be finalized during development~~ — resolved by Phase 20.

### Module permission
Added Phase 20 — per-collector, per-module access control, going beyond the binary admin/collector role. An admin has full system access unconditionally, always, regardless of any row here (confirmed with the human: an admin's access is never restricted by this table). A collector, by contrast, needs an explicit grant to reach any module beyond the three every collector already has — a row's mere *presence* is the grant, there's no separate boolean. Confirmed with the human: permissions are assigned **per individual user**, not per role with exceptions, so two collectors can have entirely different access. Enforced by `ModulePermissionsGuard`, which sits alongside the older `RolesGuard` and is migrated onto one controller at a time — see `docs/phases/PHASE_20_MODULE_PERMISSIONS.md` for which controllers have migrated so far. In code: `UserModulePermission` entity, `user_module_permissions` table; `PUT /users/:id/permissions`.

## Administration

### Audit log
A record of who did a sensitive action, and when — creating/updating/ deactivating/reactivating clients, users, or loans, refinancing a loan, registering a payment. Added Phase 11 to give the business a real accountability trail instead of "nobody knows who registered this payment." In code: `AuditLog` entity, `audit_logs` table, written automatically by a globally-registered interceptor (`AuditLogInterceptor`) for any endpoint decorated with `@Audit(action, entityType)` — not logging calls hand-added to each service. Append-only, same convention as `message_logs`. See `docs/phases/PHASE_11_AUDIT_LOG.md` and `DATABASE.md`'s `audit_logs` section.

## Resolved from earlier analysis

The following were open questions in an earlier version of this glossary, now resolved after reviewing the client's real data:

- ~~Exact installment/payment schedule structure~~ → Confirmed: installments have individual due dates and (sometimes unequal) amounts.
- ~~Interest calculation method~~ → Confirmed formula, see above.
- ~~Additional client identification fields~~ → Confirmed: `document_number` (cédula) is required.

## Still open — pending client confirmation

- [ ] The exact rule governing `interest_rate` assignment or changes over time

## Resolved from Phase 6

- ~~What happens to a refinanced loan's remaining unpaid installments~~ → Confirmed: they're marked with a distinct `cancelled` status — excluded from active mora/reminder processing, but kept in the database as historical record. See `DATABASE.md` "Refinancing".

## Resolved from Phase 10

- ~~What counts toward "cupo usado" (credit used)~~ → Confirmed: capital + interest accrued to date, same basis as `outstandingBalance`. See "Cupo (credit limit)" above.
- ~~Whether the mora &gt; 30 days block is per-installment or client-aggregate~~ → Confirmed: per-installment — any single overdue installment blocks new loans for that client.

## Resolved from Phase 14

- ~~Whether concept types are a fixed/hardcoded list or an admin-managed catalog~~ → Confirmed: admin-managed catalog, extendable without a code change. See "Interest concept type" above.
- ~~Whether a loan's concepts must be identical across every installment~~ → Originally confirmed they could vary — **reversed after client QA (2026-08-18)**: concepts are now fixed for the whole term of a loan, set once at creation. See `docs/phases/PHASE_14_INTEREST_CONCEPTS.md`. (That document's own "cuota fija" level-payment reasoning was later superseded — see its 2026-09-04 note — but this concepts-fixed-per-loan decision is unaffected.)
- ~~Whether editing the concept-type catalog retroactively changes existing loans~~ → Confirmed: no — concepts are snapshotted per installment at generation time. See "Interest concept" above.

## Resolved from Phase 15

- ~~Whether the usury ceiling is a single global value or varies by credit modality~~ → Confirmed: single global value.
- ~~Whether the ceiling validates only nominal "interés" or the effective total cost~~ → Confirmed: the effective total cost — every Phase 14 concept plus moratory interest and fixed fees, not just a field literally named "interés." See "Tasa de usura" above.
- ~~On violation: hard block or warning~~ → Confirmed: a warning the admin can proceed past, optionally with a justification note.
- ~~Whether a rate change applies retroactively to interest already caused~~ → Confirmed: no, only forward from that point.

## Resolved from Phase 16

- ~~What counts as "interest" for imputación purposes~~ → Confirmed: moratory interest and every Phase 14 concept baked into an installment's `amount`, not just moratory interest alone. See "Imputación del pago" above.
- ~~Multi-installment allocation: waterfall vs. global~~ → Confirmed: interest-globally-then-principal-globally, though within this phase's full-payoff-only scope both produce the same numbers — recorded for Phase 17's reuse of `calculatePayoff()`.
- ~~Whether the payoff quote includes not-yet-due future installments~~ → Confirmed: yes, at principal face value with zero interest.
- ~~How an initial installment factors into the payoff~~ → Confirmed at the time: only as principal, never interest. **Moot after Phase 13's later correction** (2026-08-18): a cuota inicial is not an installment at all, so it never appears in a payoff calculation in the first place. See "Cuota inicial" above.
- ~~Whether this becomes the new default behavior of every `registerPayment` call~~ → Confirmed: no — a separate, explicit "liquidar anticipadamente" flow for the full quoted amount only; `registerPayment` is untouched.

## Resolved from Phase 18

- ~~Additive vs. restrictive audience~~ → Originally confirmed additive — **reversed after client QA (2026-08-18)**: for `overdue`/`upcoming_due`, the audience is now a required filter (intersection), not additive. See "Message audience" above.
- ~~Cron scope: just the 2 already-scheduled types, or all 4~~ → Originally confirmed all 4 — **reversed after client QA (2026-08-18): `new_loan` has no cron at all**, synchronous-at-creation only. The other 3 (`overdue`, `upcoming_due`, `account_summary`) keep a cron, now configured via a periodicity+time picker in the UI instead of a raw cron-expression field.
- ~~What happens to a curated audience member with nothing to report~~ → Confirmed: still sent, rendered with an empty list and $0 total — not skipped, not an error.
- ~~`new_loan` cron mechanics (no natural "who qualifies today" query)~~ → Originally confirmed as a retry/backstop sweep over loans whose `newLoanMessageSentAt` is still null — **removed entirely after client QA (2026-08-18)**: no cron, no retry sweep, only the synchronous send at loan creation (manual retry of a specific failed message via `POST /message-logs/:id/retry` still works, unrelated to this).
- ~~`account_summary` cron mechanics (no dynamic condition at all)~~ → Originally confirmed as sending only to the template's curated audience — **reversed after client QA (2026-08-18)**: no audience, sends to every client with an active loan instead.

## Resolved from Phase 21

- ~~Which profile fields to collect, and how many~~ → Confirmed after independent review (not the client's original "collect everything" instinct, nor a bank-grade KYC proposal): a right-sized set of address/employment/income/ID fields, an open-ended references list, and an optional co-debtor per loan. Pagaré photo discarded entirely. See `docs/phases/PHASE_21_CLIENT_PROFILE.md`.
- ~~Whether the consent checkbox is mandatory~~ → Confirmed: mandatory for interactively-created clients, exempt for Excel imports. See "Data-processing consent" above.
- ~~Whether an evidence photo of the signed authorization is required~~ → Confirmed: optional, kept available regardless of expected low usage ("we gave them the tool").
- ~~Whether codeudor belongs to the client or the loan~~ → Confirmed: the loan — whether a loan has one varies per loan.
- ~~Whether a loan can have more than one codeudor~~ → Confirmed: at most one, no separate table needed.

## Resolved, 2026-09-08

- ~~Whether a payment can exceed an installment's real remaining balance~~ → Confirmed: no — hard-rejected. See "Cierre de cuota" above and `DATABASE.md`'s note of 2026-09-07.
- ~~What happens to a genuine physical excess a client hands over~~ → Still open, deliberately deferred (see "Cierre de cuota" above) — no saldo-a-favor ledger or auto-apply-to-next-cuota behavior exists yet.
- ~~Whether mora is optional/forgivable once an installment's capital is covered~~ → Confirmed: no — closing a `pending` installment now requires covering capital **and** accrued mora in full. See "Cierre de cuota" above.
- ~~Whether WhatsApp reminders, the self-service menu, the Dashboard's overdue widget, and cupo (`creditUsed`/`creditAvailable`) reflected a loan's real moratory concepts~~ → Confirmed no, for every current-generation loan: they all fell back to the legacy `interestRate` formula (sent as `0` since Phase 23), reporting $0 accrued mora. Fixed via a shared `findConceptsByInstallmentId` helper. See "Mora invisible en WhatsApp, Dashboard y cupo" above and `DATABASE.md`'s note of this date.

## Related documents

- `DATABASE.md` — how these terms map to actual tables and columns, including the confirmed interest formula
- `ARCHITECTURE.md` — where the business logic for these concepts lives in the codebase
