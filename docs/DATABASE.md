# Database

This document describes the data model, naming conventions, and migration policy for Collectify's PostgreSQL database.

> **Note:** This model was revised after reviewing the client's actual spreadsheets (`DEUDORES_ACTUALIZADA.xlsx`, `LIBRO_PARA_COBRAR.xlsx`) and real WhatsApp reminder examples. The business is structured around **installments (cuotas)**, not single due dates per loan — see `GLOSSARY.md` for full term definitions.

## Conventions

### Primary keys — UUID

Every table uses a `UUID` primary key, generated at the database level:

```sql
id UUID PRIMARY KEY DEFAULT gen_random_uuid()
```

```typescript
@PrimaryGeneratedColumn('uuid')
id: string;
```

### Naming — snake_case

Tables and columns use **snake_case**; TypeORM maps this automatically to camelCase in code via a global naming strategy (`SnakeNamingStrategy`) — see `CODING_STANDARDS.md`.

### Table names — plural, snake_case

`clients`, `loans`, `installments`, `payments`, `payment_images`, `message_templates`, `message_audiences`, `message_audience_clients`, `client_message_frequencies`, `message_logs`, `message_log_items`, `users`, `audit_logs`.

### Timestamps — every table has them

```sql
created_at TIMESTAMPTZ NOT NULL DEFAULT now()
updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
```

### Soft delete — always, no hard deletes

Every table (except `message_logs`, `message_log_items`, and `audit_logs`, which are append-only, see below) includes `deleted_at`, handled via TypeORM's `@DeleteDateColumn` and `.softDelete()`.

## Business model overview — read this first

Before looking at the tables, understand the real structure confirmed from the client's data:

1. A **client** can have **multiple loans** (called *pagarés* in the business — see `GLOSSARY.md`), active at the same time.
2. A **loan** is not paid in one lump sum — it's divided into **installments (cuotas)**, each with its own due date and its own amount.
3. **Overdue days are calculated per installment**, not per loan — an installment is overdue the moment its own due date passes, independent of the other installments in the same loan.
4. **Interest accrues per overdue installment**, using this confirmed formula:
   ```
   interest = installment_amount × (interest_rate / 100) / 30 × overdue_days
   total_due_for_installment = installment_amount + interest
   ```
   Added Phase 23: this remains the exact fallback formula for any loan with no `moratorio`-category concepts assigned (see `interest_concept_types`/`loan_installment_concepts` below) — zero regression for every pre-Phase-23 loan. Once a loan has at least one moratory concept assigned, this single-rate formula is replaced by the sum of that loan's own moratory concepts, each computed the same way (percentage: `installment_amount × (value / 100) / 30 × overdue_days`; fixed_amount: the flat `value`, charged once, unscaled by `overdue_days`) — see `docs/phases/PHASE_23_DYNAMIC_CHARGES.md`.
5. The **weekly WhatsApp reminder groups every overdue installment for a client — across all of their loans — into a single message**, with a grand total to pay. This is confirmed from the real message examples the client shared.
6. Loans can be **refinanced**: an old loan is closed out and a new loan is created in its place, typically consolidating remaining balance plus accrued interest into a new set of installments.

## Entity-relationship overview

```
users                     clients                       loans
┌─────────────────┐       ┌──────────────────┐          ┌───────────────────────────┐
│ id (PK)         │       │ id (PK)          │          │ id (PK)                   │
│ full_name       │       │ first_name       │          │ client_id (FK)            │──┐
│ email           │       │ last_name        │◄─────────│ promissory_note_number    │  │
│ password_hash   │       │ document_number  │   1:N     │ principal_amount          │  │
│ role            │       │ phone_number     │          │ disbursed_at              │  │
│ created_at      │       │ created_at       │          │ installment_frequency     │  │
│ updated_at      │       │ updated_at       │          │ total_installments        │  │
│ deleted_at      │       │ deleted_at       │          │ status                    │  │
└─────────────────┘       └──────────────────┘          │ refinanced_from_loan_id   │  │
                                                          │ created_at                │  │
                                                          │ updated_at                │  │
                                                          │ deleted_at                │  │
                                                          └───────────────────────────┘  │
                                                                                          │
                          message_templates                installments                 │
                          ┌──────────────────┐             ┌──────────────────┐          │
                          │ id (PK)          │             │ id (PK)          │          │
                          │ name             │             │ loan_id (FK)     │◄─────────┘
                          │ content          │             │ installment_num  │
                          │ is_active        │             │ amount           │
                          │ created_at       │             │ due_date         │
                          │ updated_at       │             │ status           │
                          │ deleted_at       │             │ created_at       │
                          └──────────────────┘             │ updated_at       │
                                   │                        │ deleted_at       │
                                   │                        └──────────────────┘
                                   │                                 │
                                   │ 1:N                             │ 1:N
                                   ▼                                 ▼
                          message_logs                       payments
                          ┌──────────────────┐               ┌──────────────────┐
                          │ id (PK)          │               │ id (PK)          │
                          │ client_id (FK)   │               │ installment_id   │
                          │ phone_number     │               │ amount_paid      │
                          │ message_content  │               │ paid_at          │
                          │ status           │               │ observation      │
                          │ sent_at          │               │ created_at       │
                          │ created_at       │               │ updated_at       │
                          └──────────────────┘               │ deleted_at       │
                                   │                          └──────────────────┘
                                   │ 1:N
                                   ▼
                          message_log_items
                          ┌────────────────────────┐
                          │ id (PK)                │
                          │ message_log_id (FK)    │
                          │ installment_id (FK)    │
                          │ overdue_days_snapshot  │
                          │ interest_snapshot      │
                          │ created_at             │
                          └────────────────────────┘
```

### Relationships

- One **client** has many **loans** (1:N)
- One **loan** has many **installments** (1:N)
- One **installment** has many **payments** (1:N) — partial payments are allowed
- One **loan** may reference a previous loan via `refinanced_from_loan_id` (self-referencing FK, nullable) — see "Refinancing" below
- One **client** has many **message_logs** (1:N) — one log entry per weekly reminder actually sent
- One **message_log** has many **message_log_items** (1:N) — one item per overdue installment included in that message
- One **installment** can appear in many **message_log_items** over time (it gets reminded about every week it stays overdue)

## Tables

### `users`

System users — Owner (Admin) and Collector roles, see `GLOSSARY.md`.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `full_name` | VARCHAR | |
| `email` | VARCHAR | UNIQUE |
| `password_hash` | VARCHAR | bcrypt hash |
| `role` | ENUM (`admin`, `collector`) | |
| `is_active` | BOOLEAN | disable login without deleting |
| `created_at`, `updated_at`, `deleted_at` | TIMESTAMPTZ | `deleted_at` exists on the entity but is never actually set — Phase 20 follow-up's `DELETE /users/:id` (only allowed once `is_active` is false) is a real, permanent SQL delete, confirmed with the human, not TypeORM's soft-delete. Safe because `audit_logs.actor_user_id`/`usury_rates.created_by` are `ON DELETE SET NULL` (see below) and `user_module_permissions` cascade-deletes. |

### `user_module_permissions`

Added Phase 20 — per-user, per-module access grants, going beyond the binary `admin`/`collector` role. See `GLOSSARY.md` "Module permission".

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `user_id` | UUID | FK → `users.id`, `ON DELETE CASCADE` |
| `module` | ENUM (`clients`, `loans`, `messages`, `message_templates`, `interest_concept_types`, `audit_log`, `usury_rates`, `users`) | matches the sidebar's top-level menu items, confirmed with the human — no separate "view" vs. "edit" granularity |
| `created_at` | TIMESTAMPTZ | standard |

Unique on (`user_id`, `module`). **Row presence is the grant — there's no boolean column.** Only ever populated for a `collector` account: an `admin` has full system access unconditionally, and `ModulePermissionsGuard` never even queries this table for one. A collector without a row for a given module simply can't reach it; an empty result set for a brand-new collector means no access anywhere until an admin grants some. The migration that created this table (`CreateUserModulePermissionsTable`) also seeded `clients`/`loans`/`messages` for every collector that existed at the time — those three were never behind the old `@Roles(UserRole.Admin)` guard, so seeding them was the zero-behavior-change starting point; nothing else was granted automatically.

### `clients`

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `first_name` | VARCHAR | |
| `last_name` | VARCHAR | |
| `document_number` | VARCHAR | national ID (cédula) — confirmed required, present in both source spreadsheets as `DOCUMENTO`. As of Phase 26, also enforced (rejected if missing/empty) in `ClientsService.create()` for interactively-created clients — see "Added/changed in Phase 26" below. |
| `phone_number` | VARCHAR, unique | E.164 format, e.g. `+573001234567`. As of 2026-09-06, this is enforced by normalization, not just documentation — see "Bug fix, 2026-09-06 — phone number normalization" below. **Unique, as of 2026-09-16** (human confirmed) — see "Indexes" below. |
| `credit_limit` | DECIMAL(12,2), nullable | maximum credit exposure ("cupo") enforced at loan creation. Nullable — unset means no cupo is enforced for this client, same "absence of a value means the rule doesn't apply" convention as `loans.description`. Added Phase 10, see "Changed after Phase 10" below. |
| `document_type` | ENUM (`cedula_ciudadania`, `cedula_extranjeria`, `pasaporte`), nullable | Added Phase 21. As of Phase 26, `loans.co_debtor_document_type` (which shared this enum) is gone — a co-debtor is now a `Client` reference, so their `document_type` is read from this same column. |
| `date_of_birth` | DATE, nullable | Added Phase 21. |
| `gender` | ENUM (`masculino`, `femenino`, `otro`), nullable | Added 2026-09-08 (client request). Nullable and never enforced as required, for either interactive `ClientForm` creation or the Excel import — a fillable field, not mandatory. "Edad" (age), requested alongside this, is deliberately NOT a stored column — it's computed on the frontend from `date_of_birth` instead (`apps/client/src/lib/format.ts`'s `calculateAge`), avoiding a duplicated value that would silently go stale. |
| `document_issue_place` | VARCHAR, nullable | Added Phase 21. |
| `document_issue_date` | DATE, nullable | Added Phase 21 (client feedback after reviewing the built form — `document_issue_place` already existed, the date didn't). |
| `email` | VARCHAR, nullable | Added Phase 21. |
| `alternate_phone_number` | VARCHAR, nullable | Added Phase 21. Same E.164 normalization as `phone_number` — see 2026-09-06 note above. **Widened, 2026-09-19** (human report): previously just a KYC contact detail with no messaging effect. Now every business-initiated WhatsApp send (overdue/upcoming-due/new-loan reminders, payment confirmations) goes to this number too when set, alongside `phone_number` — one `message_logs` row per number actually sent to, see `getRecipientPhoneNumbers()`. A reply from either number resolves to this same client (`WhatsappWebhookService.persistEvent`'s client lookup matches both fields), and the self-service menu/manual replies answer back on whichever number the client is actually texting from, not always the primary. |
| `home_address` | TEXT, nullable | Added Phase 21. As of Phase 26, at least one of `home_address`/`work_address` is enforced (rejected if both are missing/empty) in `ClientsService.create()` for interactively-created clients — see "Added/changed in Phase 26" below. |
| `work_address` | TEXT, nullable | Added Phase 21. Same either/or requirement as `home_address` above, as of Phase 26. |
| `city` | VARCHAR, nullable | Added Phase 21. |
| `occupation` | VARCHAR, nullable | Added Phase 21. |
| `employer_name` | VARCHAR, nullable | Added Phase 21. |
| `monthly_income` | DECIMAL(12,2), nullable | Added Phase 21. |
| `id_document_front_url`, `id_document_back_url` | VARCHAR, nullable | Added Phase 21. Externally-hosted URLs only (image or PDF) — same convention as `payments.image_url` (Phase 12). The api never touches the file bytes. |
| `selfie_image_url` | VARCHAR, nullable | Added Phase 21. Never enforced as required anywhere in the app — this is sensitive/biometric data under Ley 1581 de 2012, and no activity may be conditioned on a titular providing it. |
| `data_processing_consent` | BOOLEAN, `NOT NULL DEFAULT false` | Added Phase 21. Enforced as required (must be `true`) in `ClientsService.create()` for interactively-created clients only — Excel-imported clients (`docs/phases/PHASE_8_EXCEL_IMPORT.md`) are exempt and default to `false`. The physical/in-person authorization is what actually authorizes the data processing under Colombian law; this column (plus the two below) only records that it happened — see `docs/phases/PHASE_21_CLIENT_PROFILE.md`. |
| `consent_given_at` | TIMESTAMPTZ, nullable | Added Phase 21. Stamped server-side (not caller-supplied) the moment `data_processing_consent` transitions to `true`, on both create and update. |
| `consent_document_url` | VARCHAR, nullable | Added Phase 21. Optional scan/photo of the signed physical authorization — evidence, not the authorization itself. Never enforced as required. |
| `created_at`, `updated_at`, `deleted_at` | TIMESTAMPTZ | standard |

**Changed after Phase 10 — cupo and mora-block rules confirmed with the client:**
- **"Cupo usado" (credit used)** = capital + interest accrued to date across the client's *active* loans' still-pending installments — the same `totalDue`-based sum already computed per loan as `outstandingBalance` (see `loans` below), just aggregated across every active loan instead of one. Refinanced-away and paid-off loans don't count (their `status` is no longer `active`). Not a stored column — computed on read by `ClientsService.getCreditUsage`/`findOneDetail`, exposed as `creditUsed`/`creditAvailable` on `GET /clients/:id`.
- **Mora block (+30 days)** is per-installment, not client-aggregate: a client is blocked from new loans as soon as *any single* pending installment across their active loans is more than 30 days overdue — not an average or the oldest one specifically. Computed on read by `ClientsService.hasMoraBlock`, exposed as `isMoraBlocked` on `GET /clients/:id`.
- Both are checked by `LoansService.create()` before a new loan is persisted, reported as two distinct rejection reasons (over cupo vs. mora-blocked) — see `docs/phases/PHASE_10_CLIENT_CAPACITY.md`.

### `client_references`

Added Phase 21 — a personal or comercial reference for a client. A dynamic add-many list: no fixed minimum or maximum, confirmed with the business (they wanted an open "add another" flow rather than a fixed number of slots). See `docs/phases/PHASE_21_CLIENT_PROFILE.md` decision 2.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `client_id` | UUID | FK → `clients.id`, `ON DELETE CASCADE` — a client's references don't outlive the client |
| `type` | ENUM (`personal`, `comercial`) | |
| `full_name` | VARCHAR | |
| `phone_number` | VARCHAR | |
| `relationship` | VARCHAR | free text (e.g. "hermano", "vecino", "proveedor") — confirmed sufficient, no fixed catalog |
| `created_at`, `updated_at` | TIMESTAMPTZ | **no `deleted_at`** — unlike every other table here, references are hard-removed by the "quitar" action in `ClientForm`; there's no "reactivate a reference" concept. Surviving the parent client's own soft-delete is automatic (soft-delete only sets `clients.deleted_at`, it never touches rows referencing it), so no special handling is needed here for that. |

### `loans`

Represents a *pagaré* — see `GLOSSARY.md`.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | PK (internal) |
| `client_id` | UUID | FK → `clients.id` |
| `promissory_note_number` | VARCHAR | **the business-facing identifier** — this is the `#743`, `#959` etc. seen in client messages and spreadsheets. Not the same as `id`. Must be unique and searchable. As of 2026-09-03, new loans must match `#0000` (`#` + at least 4 digits, see `GLOSSARY.md` "Loan / Pagaré") — pre-existing rows are exempt and were not reformatted. |
| `principal_amount` | DECIMAL(12,2) | total amount financed (`TOTAL` / `SALDO TOTAL` in the source sheets) |
| `disbursed_at` | DATE | when the loan was given (`FECHA INICIAL`) |
| `installment_frequency` | ENUM (`monthly`, `biweekly`) | source data shows `MENSUAL` consistently; enum leaves room for other frequencies if they come up |
| `total_installments` | INT | total number of installments the loan is divided into (`CUOTAS`) |
| `status` | ENUM (`active`, `paid`, `refinanced`) | see `GLOSSARY.md` — **no `overdue` status at the loan level**, since overdue is an installment-level concept (see below) |
| `refinanced_from_loan_id` | UUID, nullable | self-referencing FK → `loans.id`. Set when this loan was created to replace an older one. See "Refinancing" below. |
| `description` | TEXT, nullable | free-text product acquired with the loan (e.g. "Compra de Apple MacBook Air M5..."), sent verbatim as the "Detalle del producto" placeholder in the "new loan" WhatsApp message — see `docs/phases/PHASE_9_MESSAGE_TYPES.md`. Column stays nullable (existing loans predate this rule), but required (`@IsNotEmpty()`) on `CreateLoanDto` as of 2026-09-04 for both the interactive "Nuevo préstamo" form and the Excel bulk import (`clientLoanImportColumns.ts`'s `description` column flipped to `required: true` in lockstep) — client feedback: every new loan's automatic WhatsApp message includes this, so a blank value was never actually harmless, just silently defaulting to "No especificado" (see the bug-fix section below). `RefinanceLoanDto.description` was deliberately left optional — the single-loan refinance WhatsApp template doesn't even use it (see `newLoanTemplateSelection.ts`'s `selectRefinanceTemplate`). |
| `new_loan_message_sent_at` | TIMESTAMPTZ, nullable | Added Phase 18 — set once the "new loan" WhatsApp message actually succeeds (synchronously at creation/refinance, or via the retry cron). Lets the `new_loan` cron find loans still needing their message directly (`IS NULL`), instead of string-matching message content. See `docs/phases/PHASE_18_MESSAGE_AUDIENCES.md`. |
| `co_debtor_client_id` | UUID, nullable | Added Phase 26, replacing the flat `co_debtor_*` columns Phase 21 originally added (see "Added/changed in Phase 26" below). FK → `clients.id`, `ON DELETE RESTRICT` — same convention as `client_id` above; clients are only ever soft-deleted in this project, so `RESTRICT` never actually blocks a normal delete. A co-debtor is functionally just another client of the business — confirmed with the business ("codeudor al final es otro cliente") — so it's picked from existing clients rather than typed inline. At most one per loan. Validated in `LoansService.assertCoDebtorIsValid()`: must differ from this loan's own `client_id`, and must reference an existing, active (non-soft-deleted) client. |
| `co_debtor_relationship` | VARCHAR, nullable | Added Phase 21, kept standalone on `Loan` through the Phase 26 refactor — relación con el deudor principal is a property of this specific loan, not of the co-debtor client themselves (the same client could be "hermano" on one loan and "socio" as co-debtor on another). Free text. |
| `alternate_contact_name`, `alternate_contact_phone_number` | VARCHAR, nullable | Added 2026-09-19 (human report) — a rare, per-loan exception: an alternate contact (free-form, not a `Client` — typically outside the business's client base entirely, e.g. a relative handling this one pagaré). Must be both set or both null, enforced in `LoansService.assertAlternateContactIsValid()`. When set, every WhatsApp message about THIS specific loan (overdue/upcoming-due reminders, payment/paid-in-full confirmations, the new-loan notice) goes to `alternate_contact_phone_number` instead of the client's own number(s) — see `getRecipientPhoneNumbers()`/`groupInstallmentsByRecipient()`. A client with several loans, only one carrying this override, gets TWO separate reminder messages: their own (their other loans only) and the contact's (this loan only) — never merged, never silently dropped from both. `LoansService.refinance()` carries this over unchanged by default (same omit-to-carry-over/explicit-null-to-clear convention as `co_debtor_client_id` below). **Outbound only so far** — the contact replying (self-service menu: "Ver mis cuotas", "Ya pagué"/registering a payment) is a separate, not-yet-built piece: today a reply from this number is just an unrecognized inbound message, same as any other unknown number. Confirmed with the human that when built, it must resolve to this loan specifically and never expose the client's other loans, even if the contact asks for "toda la cuenta". |
| `created_at`, `updated_at`, `deleted_at` | TIMESTAMPTZ | standard |

**On the down payment ("cuota inicial"):** `loans.initial_payment` (Phase 13) was replaced 2026-09-03 — that model was mal planteado (purely informational, no due date, not a real installment). The down payment is now a real installment: `installments.is_down_payment` flags it (always `installment_number` 1 when present), interest-free, due on its own admin-chosen date, with mora still applying if missed. See `ReplaceInitialPaymentWithDownPaymentInstallment` migration and the `installments` table below.

**On the co-debtor and refinancing:** `LoansService.refinance()` carries the old loan's co-debtor over to the new loan unchanged by default when `coDebtorClientId`/`coDebtorRelationship` are **omitted** from the refinance dto — the refinance dto's co-debtor fields are optional and only override what's explicitly sent, so refinancing doesn't silently drop an existing co-debtor. Sending either field as an explicit `null` (as opposed to omitting it) deliberately clears the co-debtor on the new loan instead of carrying it over — added as a QoL fix (2026-08-30) after the frontend's "tiene codeudor" checkbox turned out to have no effect when unchecked, since omitting and explicitly-clearing were previously indistinguishable at the `??` fallback used here. The carried-over (or overridden, or cleared) `coDebtorClientId` is re-validated by `assertCoDebtorIsValid()` the same as on creation. See `docs/phases/PHASE_21_CLIENT_PROFILE.md` and `docs/phases/PHASE_26_CODEBTOR_CLIENT.md`.

**On `interest_rate`:** confirmed from real data that the rate is **not** automatically tiered by amount, despite an informal rule mentioned by the client ("6% under 1 million, 5% over"). Actual historical data shows loans of the same amount range with rates of 4%, 5%, and 6%. The safest interpretation — **pending final confirmation with the client** — is that the rate is set manually per loan at creation time, defaulting to whatever the current standard rate is, but editable. Do not hardcode an automatic tiering rule based on this early analysis.

**Changed after Phase 14:** `interest_rate` is no longer used to price new loans — a loan's actual cost is now expressed entirely through named concepts (see `interest_concept_types` / `loan_installment_concepts` below). The column was not removed or renamed: it is kept, unchanged in shape, as the base rate `installmentCalculations.ts` uses for moratory (mora) interest on overdue installments — the open question above about how this rate is assigned/changes over time is still unresolved, just now scoped specifically to its moratory role rather than to ordinary loan pricing.

**Superseded after Phase 23:** `interest_rate` is now only the *fallback* moratory formula, used exclusively for a loan with zero `moratorio`-category concepts assigned (every loan created before this phase, and any new loan the admin doesn't attach moratory concepts to). Once a loan has at least one moratory concept, `interest_rate` plays no role in its numbers at all — moratory interest is priced entirely through that loan's own `loan_installment_concepts` rows instead, computed live on read. The column is still not removed — dropping it would break every loan still on the fallback path. See `docs/phases/PHASE_23_DYNAMIC_CHARGES.md`.

**Renamed after Phase 31:** `interest_rate`'s UI label changed from "Tasa de interés" to "Incremento consolidado en caso de mora" (client users were misreading it as a charge separate from the mora ceiling, not the ceiling itself). Copy-only — the column, its shape, and its formula are unchanged. See `docs/phases/PHASE_31_LOAN_TERMINOLOGY.md`.

**Resolved, 2026-09-04 — is `interest_rate` dead code?** Client asked directly, since it's already superseded-for-moratory-purposes on any loan with concepts assigned (see above). Answer: not removable. It's the *only* moratory formula for any loan created before Phase 23 (or any loan an admin somehow creates today with zero moratory concepts attached), so dropping the column or its fallback branch would silently zero out mora on every one of those loans still active in the DB. Don't remove `interest_rate` without first auditing the whole loan book for any active loan still on the fallback path.

**Reverted the same day — `interest_rate` is NOT editable post-creation:** the answer above briefly shipped with `interest_rate` staying editable via `PATCH /loans/:id` for a loan with no `moratoryConcepts` (and moratory concept values editable for every other loan — see the next note and `loan_installment_concepts` below). The client tried the moratory-concepts version in `EditLoanDialog` and decided the same day there wasn't enough real use for editing a loan's numbers after creation to justify keeping either path — see `loan_installment_concepts`'s "NOT editable" note below for the final rule. `interest_rate` is now immutable once a loan is created, same as every other numeric field; only `description` survives as editable via `PATCH /loans/:id`.

**Superseded, 2026-09-09 — the "not removable" answer above no longer holds; `interest_rate` was removed entirely.** The audit this same date actually did (auditing every path that could ever create a loan with zero moratory concepts, not just historical data) found there wasn't one: every live path always assigns at least one. See "Removed, 2026-09-09" near the end of this document for the full story.

**Added after Phase 31 — `currentPrincipalBalance` (not a stored column):** `GET /loans/:id` ("saldo capital a la fecha") now also returns the loan's pure remaining principal across still-pending installments, computed on read via `calculatePayoff()`'s `totalPrincipalOwed` (same Phase 16 engine `payoff-quote`/`refinance-quote` already use) — deliberately excludes accrued interest, unlike `outstandingBalance` shown elsewhere in the client app. See `docs/phases/PHASE_31_LOAN_TERMINOLOGY.md`.

**On why there's no `status: 'overdue'` at the loan level:** a loan can have some installments overdue and others current, or even fully current with a future installment pending. "Overdue" is a derived state of an *installment*, not the loan as a whole. The loan's own dashboard/detail view aggregates its installments' statuses for display purposes but doesn't store a redundant "overdue" flag.

**Deletion (Phase 30):** `DELETE /api/v1/loans/:id` (admin only) lets an admin remove a loan created by mistake, but only while **none of its installments have any registered `Payment` row** — confirmed with the human ("eliminar si no tiene pago registrado"). Once a payment exists anywhere on the loan, the endpoint rejects with 409 and the loan must be handled some other way (e.g. refinanced) instead of deleted. Soft, per this table's own `deleted_at` convention — never a hard delete. Cascades explicitly to the loan's own `installments` rows (soft-deleted in the same transaction): TypeORM's `.softDelete()` only stamps the target table's own `deleted_at`, it does not cascade to relations the way a real FK `ON DELETE CASCADE` would (contrast with `client_references`, which deliberately does *not* cascade from a client's soft-delete — see that table's note above). Audit-logged as `loan.delete`.

### `installments`

Represents a single *cuota* within a loan.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `loan_id` | UUID | FK → `loans.id` |
| `installment_number` | INT | e.g. cuota 14 of 24 (`NO #` / `# DE CUOTAS` in source data) |
| `amount` | DECIMAL(12,2) | the installment's own amount (`VLR CUOTA`) — installments within a loan are not always equal, per real data |
| `principal_portion` | DECIMAL(12,2), nullable | Added Phase 14 — the capital-only part of `amount`, generated by the amortization schedule. Nullable because installments created before Phase 14 never had this calculated (their `amount` was a single hand-entered total with no capital/interest split). See `docs/phases/PHASE_14_INTEREST_CONCEPTS.md` and "Added in Phase 14" below. |
| `due_date` | DATE | this installment's specific due date (`FECHA COBRO` / `FECHA CUOTA`) |
| `status` | ENUM (`pending`, `paid`, `cancelled`) | overdue is **calculated on read**, never stored — see below. `cancelled` is set when the parent loan is refinanced with this installment still pending — see "Refinancing" |
| `is_down_payment` | BOOLEAN, default `false` | Added 2026-09-03, replacing `loans.initial_payment` (see that table's note above). True only for the loan's own down payment ("cuota inicial"), always `installment_number` 1 when present — interest-free (no corriente `loan_installment_concepts` rows generated for it), due on its own admin-chosen date, independent of the periodic schedule that governs installment 2 onward. Moratorio concepts still apply — mora is charged if it's missed too. Migration `ReplaceInitialPaymentWithDownPaymentInstallment`. |
| `created_at`, `updated_at`, `deleted_at` | TIMESTAMPTZ | standard |

~~`is_initial` BOOLEAN~~ — added in Phase 13, removed after client QA (2026-08-18) when a down payment wasn't yet a real installment. Reintroduced 2026-09-03 as `is_down_payment` once the business confirmed it now is one — not a repeat of the same mistake, see that column's note above.

**Overdue calculation (confirmed formula):**

```typescript
overdueDays = todayInBogota > installment.dueDate
  ? wholeCalendarDaysBetween(todayInBogota, installment.dueDate)
  : 0;

interest = overdueDays <= 6
  ? 0
  : installment.amount * (loan.interestRate / 100) / 30 * overdueDays;

totalDueForInstallment = installment.amount + interest;
```

This matches the manual calculations found across both source spreadsheets — verified against multiple real examples. The grace-period gate was added 2026-09-08 (originally `overdueDays <= 8`, narrowed to `overdueDays <= 6` on 2026-09-09 per client correction) — see that date's note near the end of this document.

**Bug fix, 2026-09-07 — `totalDueForInstallment` above is incomplete: it must also subtract any payments already registered against that pending installment.** See "Bug fix, 2026-09-07 — payment could exceed an installment's real remaining balance" near the end of this document for the full story; `enrichInstallment()`'s real formula is `max(0, installment.amount + interest - totalPaid)`.

**Bug fix, 2026-09-04 — the day-count was silently off by up to 2 days, always in the client's favor to be charged more, never the reverse.** Originally implemented with `differenceInDays(today, installment.dueDate)` — exact elapsed 24h periods between `today`'s precise timestamp (`new Date()`, whatever moment the calculation runs) and `dueDate`'s UTC-midnight parsing (`installments.due_date` is a 'date' column; `new Date('2026-09-10')` parses as `2026-09-10T00:00:00Z`). In Bogotá (UTC-5) that instant is actually **7:00pm the evening before** the calendar due date — so every installment was treated as "matured" (due, or starting to accrue mora) five hours earlier than its real calendar due date, and because `differenceInDays` truncates instead of rounding, the day-count itself came out 1 day short for most of the day and 2 days short after 7:00pm Bogotá. Never the other direction. This was first noticed via `calculatePayoff.ts`'s Phase 25 early-maturity window during a refinance (a cuota due 6 calendar days out was already entering the 5-day window, a day early), but affected every consumer of `calculateOverdueDays`/`calculateDaysUntilDue` identically, including ordinary mora on `enrichInstallment.ts`. Fixed by computing whole Bogotá calendar days instead: `today` is shifted by the fixed UTC-5 offset before being floored to a day number (Colombia has no DST, so this constant holds year-round — same precedent as the "Fixed by pinning every CronJob explicitly to America/Bogota" note elsewhere in this document), while `dueDate` needs no adjustment since it's already a pure calendar date. Deliberately still not `differenceInCalendarDays` — that normalizes to the server process's own local timezone (`installmentCalculations.spec.ts` has its own longstanding regression test guarding against exactly that); this fix keeps that server-timezone-independence property while ALSO getting the Bogotá calendar day right. See `installmentCalculations.ts` and its spec file for the full implementation and worked examples.

**Same bug, found in two more places the same day — `dueDateSchedule.ts`'s `todayDateString()`:** used by the overdue/upcoming-due WhatsApp reminder crons (`OverdueReminderService`/`UpcomingDueReminderService`'s `upcomingTargetDates()`, and `reminderInstallmentQueries.ts`'s two installment-lookup queries, which had their own separate inline `new Date().toISOString().slice(0, 10)` instead of calling the shared helper at all) to decide which installments are "due today" or "due in N days" for messaging purposes. Same root cause (raw UTC calendar date instead of Bogotá's) and same fix (shift by the fixed UTC-5 offset before reading the date). Lower stakes than the money-calculation bug above — this only affects which day a WhatsApp reminder considers a cuota to be due/overdue, not any dollar amount — but fixed for consistency, and because `reminderInstallmentQueries.ts` now calls the shared `todayDateString()` instead of duplicating the (buggy) logic inline.

**Bug fix, 2026-09-09 — every installment's `due_date` silently locked onto day 28 for any loan whose first cuota was meant to land on the 29th-31st.** Reported directly from production. Root cause was in the frontend, not `dueDateSchedule.ts`'s own month-arithmetic (`addMonthsToDateString`, which correctly clamps only the specific target months that are actually short, e.g. `2026-01-31` + 6 months correctly stays `2026-07-31`, not `2026-01-28`): `LoanForm`/`RefinanceLoanForm` ask the admin for "fecha de la primera cuota" (what's actually written on the pagaré) and back-compute `disbursedAt` client-side by subtracting one period (`computeDisbursedAt()`), since `POST /loans` still requires `disbursedAt`. That subtraction is lossy whenever the source day is 29-31 and the preceding month is shorter — e.g. subtracting a month from a March 31 due date clamps `disbursedAt` to `2026-02-28`. Once that already-clamped `disbursedAt` reached the backend, `LoansService.calculateDueDate` regenerated every installment as `disbursedAt + N periods`, and since day 28 is `<=` every month's day count, `Math.min(28, daysInTargetMonth)` never recovered — EVERY installment landed on day 28, not just the one that would have genuinely fallen in a short month. Fixed by having `LoanForm`/`RefinanceLoanForm` also send the admin's exact, unmodified input as a new optional `firstInstallmentDueDate` field (`CreateLoanDto`/`PreviewScheduleDto`/`RefinanceLoanDto`); when present, `calculateDueDate` anchors the whole schedule on it directly instead of re-deriving from the lossy `disbursedAt`. `disbursedAt` itself is still computed the same (still potentially an approximation for that specific edge case) but is now used only for the informational `disbursed_at` record column, no longer fed back into schedule generation. `LoanImportService` (Excel bulk import) is unaffected — its `disbursedAt` is a real historical date read from the spreadsheet, not back-computed from a due date, so it never sets `firstInstallmentDueDate` and keeps using the original (already-correct) `disbursedAt`-only generation. See `LoansService.calculateDueDate`/`PersistLoanParams.firstInstallmentDueDate` and `dueDateSchedule.spec.ts`'s new day-29/30/31-into-a-long-month regression tests.

### `payments`

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `installment_id` | UUID | FK → `installments.id` — **payments are tracked per installment**, not per loan, allowing partial payments against a specific cuota |
| `amount_paid` | DECIMAL(12,2) | |
| `paid_at` | DATE | |
| `observation` | TEXT | nullable — the source data has many free-text notes like "pagó en el local", "recibió en el Bordo" |
| `image_url` | VARCHAR, nullable | Added Phase 12. **Deprecated as of Phase 28** — a payment can now carry more than one receipt photo, tracked in `payment_images` below. Kept (not dropped) as a read-only fallback for any row created before Phase 28's migration backfilled it into `payment_images`; new payments no longer write to this column. |
| `void_reason` | TEXT, nullable | Added 2026-09-09 — see "Added 2026-09-09 — voiding/correcting a payment" below. `null` for any payment that's never been voided; required (enforced at the DTO level, not a DB constraint) whenever `deleted_at` is set via the void endpoint. |
| `funded_by_credit` | BOOLEAN, default `false` | Added 2026-09-14 — see `client_credit_ledger_entries` below. `true` only for a `Payment` created by `InstallmentsService.applyCreditToInstallment` (spending a client's saldo a favor); `false` for an ordinary cash/transfer payment. |
| `created_at`, `updated_at`, `deleted_at` | TIMESTAMPTZ | standard. `deleted_at` on a payment now has two possible meanings in practice — a genuinely orphaned row, or (as of 2026-09-09) a deliberately voided one. `void_reason` is what distinguishes the two: non-null only for the latter. |

### `payment_images`

Added Phase 28 — lets a payment carry more than one receipt photo (clients often send several proof-of-payment images for one cuota). Append-only, no soft delete, same convention as other photo-holding tables. `payments.image_url` above is deprecated in favor of this table; a data migration backfilled every pre-existing non-null `image_url` into its own row here.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `payment_id` | UUID | FK → `payments.id`, `ON DELETE CASCADE`, indexed |
| `image_url` | VARCHAR | required — same "externally hosted, api never touches the bytes" convention as the old `payments.image_url` |
| `created_at` | TIMESTAMPTZ | |

Also added Phase 28: `POST /installments/payments/bulk` registers payments against several installments in one request (one amount entered individually per installment, not a total split across them — confirmed with the human). The batch requires **full** payment of every installment in it; a short amount rejects the entire request (rolled back atomically) before anything is persisted. Partial payment stays on the existing single-installment endpoint, which already supported it via multiple `payments` rows per installment.

### `interest_concept_types`

Added Phase 14 — the admin-managed catalog of interest/fee concepts (e.g. "Interés remuneratorio", "Gastos de cobranza"). Confirmed with the human this must stay open-ended: the admin creates new concept types whenever needed, not a fixed/hardcoded list. See `docs/phases/PHASE_14_INTEREST_CONCEPTS.md`.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `name` | VARCHAR | |
| `default_calculation_type` | ENUM (`percentage`, `fixed_amount`) | |
| `default_value` | DECIMAL(12,4), nullable | a suggested starting value, always overridable per installment. Widened from DECIMAL(12,2) 2026-09-06 (`WidenConceptValuePrecision` migration, same target precision as `usury_rates.rate_percentage`) so a percentage cargo can actually be entered/stored to 4 decimals instead of silently rounding to 2 — scoped to percentage concepts only: `CreateInterestConceptTypeDto`/`InterestConceptTypesService.assertValuePrecision` still cap a `fixed_amount` value at 2 decimals (a plain currency figure has no legitimate use for more), even though the column itself now has room for either. |
| `category` | ENUM (`corriente`, `moratorio`), default `corriente` | Added Phase 23 — which side of the concept engine this type belongs to. `corriente` concepts price a loan's ordinary cost at generation time, unchanged since Phase 14. `moratorio` concepts only apply once an installment is overdue, computed live on read (never projected at generation time — future overdue days can't be known in advance). The default keeps every pre-Phase-23 row `corriente`, matching what it already implicitly was; no moratory concepts are pre-seeded — the admin creates his own, the same way as corriente ones. See `docs/phases/PHASE_23_DYNAMIC_CHARGES.md`. |
| `fixed_amount_distribution` | ENUM (`split_across_installments`, `repeated_each_installment`), nullable | Added Phase 23 — required (enforced at the DTO layer, "no silent default") when `default_calculation_type` is `fixed_amount` and `category` is `corriente`; meaningless (left `NULL`) for a `percentage` concept or for a `moratorio` fixed-amount concept, which is always charged once, flat, the moment an installment goes overdue. `first_installment_only` (charge once, on installment 1) was renamed to `repeated_each_installment` (charge the full amount on every installment, e.g. a recurring monthly fee) 2026-09-03 — the client had no use for the old option, per `RenameFirstInstallmentOnlyToRepeatedEachInstallment` migration. |
| `is_active` | BOOLEAN, default `true` | deactivating removes the type from the picker for new loans without touching `loan_installment_concepts` rows already generated from it — those snapshot their own name/value, unaffected by later catalog edits. Added 2026-09-03: a deactivated row can also be permanently deleted (`DELETE /interest-concept-types/:id`), but only if it was never referenced by any `loan_installment_concepts` row (checked with `withDeleted: true`, since that table soft-deletes) — a type created by mistake and never used can be fully removed; one already used on a loan can only stay deactivated. Mirrors `users`' deactivate-then-delete pattern. See `InterestConceptTypesService.remove()`. Added 2026-09-05: a deactivated type can also be reactivated (`PATCH /interest-concept-types/:id/activate`, sets `is_active` back to `true`) — safe unconditionally, including for a type already used on past loans, since nothing about reactivating touches those loans' already-snapshotted `loan_installment_concepts` rows. Client's own reasoning: a type used on real loans has no "delete" escape hatch (see above), so without this it would be stuck inactive forever if turned off by mistake or needed again later. See `InterestConceptTypesService.activate()`. |
| `created_at`, `updated_at`, `deleted_at` | TIMESTAMPTZ | standard |

**Redesigned, 2026-09-03**: briefly had an `is_usury_rate_concept` flag (a "mandatory concept" mechanism) — dropped via migration. The loan's own corriente/moratorio interest is no longer modeled here at all; it's a system-generated `loan_installment_concepts` row (`interest_concept_type_id: NULL`), built from `CreateLoanDto.corrienteInterestRate`/`moratoryInterestRate` (default and cap: current usury ceiling — see `LoansService.resolveConceptsWithInterest`). This table is purely optional business fees again, as before Phase 24's mandatory-concept detour.

### `loan_installment_concepts`

Added Phase 14 — one row per interest/fee concept applied to a specific installment (per installment, not per loan, since concepts can vary installment-to-installment — confirmed with the human).

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `installment_id` | UUID | FK → `installments.id`, `ON DELETE CASCADE` |
| `interest_concept_type_id` | UUID, nullable | FK → `interest_concept_types.id`, `ON DELETE SET NULL` — kept only as a soft reference for reporting; everything needed to display or recompute this concept already lives on this row |
| `name_snapshot` | VARCHAR | copied from the type at generation time |
| `calculation_type` | ENUM (`percentage`, `fixed_amount`) | snapshotted |
| `category` | ENUM (`corriente`, `moratorio`) | Added Phase 23 — snapshotted from the type at assignment time, same precedent as `name_snapshot`/`calculation_type`. |
| `value` | DECIMAL(12,4) | snapshotted — the % or flat figure actually used for this installment. Widened from DECIMAL(12,2) 2026-09-06 alongside `interest_concept_types.default_value` (same `WidenConceptValuePrecision` migration and reasoning — see that column's own note above); `LoansService.assertConceptValuePrecision` still caps a `fixed_amount` assignment at 2 decimals. |
| `computed_amount` | DECIMAL(12,2) | For a `corriente` row: the resulting currency amount this concept contributed to this installment, calculated once at generation time against the balance at that point, then stored — the schedule doesn't change with the passage of time the way mora does. For a `moratorio` row (Phase 23): always `0` — the row only records that the concept is assigned to the loan; the real charge is computed live on read once the installment is overdue (see `installments.dueDate` / mora formula below), never stored. |
| `created_at`, `updated_at`, `deleted_at` | TIMESTAMPTZ | standard |

**Moratory concept values are NOT editable post-creation — tried and reverted the same day, 2026-09-04:** `PATCH /loans/:id`'s `moratoryConcepts` briefly let the admin correct a `moratorio`-category row's `value` after creation (see git history for `LoansService.updateMoratoryConceptValues()`, now removed). Technically this was safe — nothing about a `moratorio` row's `value` is ever baked into `installments.amount` (see `computed_amount` above) — but after trying it in the real `EditLoanDialog.tsx` UI, the client decided it wasn't useful enough to justify a second way to change a loan's numbers after the fact. The rule landed on instead: every one of a loan's numbers (`principal_amount`, the cuota schedule, `interest_rate`, and every concept — `corriente` or `moratorio`) is fixed the instant the loan is created. A mistake there needs `POST /loans/:id/refinance`, which regenerates the schedule and — unlike a silent PATCH — notifies the client. `description` is the only field `PATCH /loans/:id` still changes (see `loans.description` below and `UpdateLoanDto`'s own comment) — a wording/typo fix has no bearing on what's owed, so it doesn't need `refinance()`'s full weight. As of the same day, both `POST /loans` and `POST /loans/:id/refinance` also require confirming a warning dialog client-side before they fire (`ConfirmCreateLoanDialog` in `LoanForm.tsx`, `ConfirmRefinanceDialog` in `RefinanceLoanForm.tsx`) — spelling out that the new/refinanced loan's numbers are now final and that confirming sends the WhatsApp message to the client immediately. The actual `create()`/`refinance()` call only fires from that dialog's confirm button, not the form's own submit button.

### `message_templates`

**Changed after Phase 33** — replaces the 4-value catalog below with the 13 real Meta-approved templates the client wrote; `account_summary` is retired outright with no replacement. See `docs/phases/PHASE_33_MESSAGE_TEMPLATES_V2.md` for the full template catalog (every body, parameter order, and button spec) and `docs/phases/PHASE_9_MESSAGE_TYPES.md` for the superseded model this replaces.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `name` | VARCHAR | admin-facing label, e.g. "Una cuota vencida (días 1-8)" |
| `type` | ENUM (13 values, matching the Meta template names literally — `nuevo_pagar_cliente_nuevo`, `nuevo_pagar_cuota_inicial_cliente_nuevo`, `nuevo_pagar_cliente_existent`, `nuevo_pagar_cuota_inicial`, `refinanciamiento_un_solo_pagar`, `una_cuota_proxima_vencer`, `varias_cuota_proxima_vencer`, `una_cuota_vencida`, `una_cuota_vencida_en_mora`, `varias_cuota_vencida`, `proxima_vencer_y_vencida`, `confirmacion_pago`, `pago_completo_paz_y_salvo`), **UNIQUE** | which Meta template this row is for — exactly one row per type |
| `content` | TEXT | the literal approved body text, for reference/display only — the actual send uses `meta_template_name` + ordered component parameters via `WhatsAppService.sendTemplateMessage`, not this column. **Not admin-editable** — updating it is a migration, like any other data change. |
| `meta_template_name` | VARCHAR | Added Phase 33 — the real Meta template name this row sends. Always identical to `type`'s string value in practice, but kept as its own column since the two are allowed to drift. |
| `meta_language_code` | VARCHAR | Added Phase 33 — the language code selected when the template was submitted to Meta. Confirmed `es` for all 13 as of Phase 33 — must match exactly or the send is rejected. |
| `cron_expression` | VARCHAR, nullable | Admin-editable cron schedule. As of Phase 33 this only applies to the two "schedule owner" rows — one per reminder family (see `WhatsappCronService` and `reminderFamily.ts`) — every other row leaves this `NULL` and has no cron job at all (new-loan/refinance and payment-confirmation types send synchronously at their triggering event; the remaining reminder-family rows share their family's single schedule). |
| `created_at`, `updated_at`, `deleted_at` | TIMESTAMPTZ | standard |

**Template selection** — which of the 13 templates a given send uses is decided in code, not stored: `newLoanTemplateSelection.ts` (new loan / refinance, by new-vs-existing client and with/without cuota inicial), `reminderTemplateSelection.ts` (overdue / upcoming-due / the mixed template, by count and days), and `paymentConfirmationTemplateSelection.ts` (payment confirmation / paid-in-full). Every reminder template (4 through 10) shares one closing-line mechanism — "nota adicional" (`notaAdicional.ts`) — filled with one of three fixed strings (normal / saldo pendiente / saldo a favor) since Meta templates can't show or hide a line conditionally.

### `message_logs`

One row per reminder **actually sent to a client** — not per installment. **2026-09-19** (human report): also not per client-messaging-event anymore — a client with `clients.alternate_phone_number` set gets one row per phone number the reminder/confirmation actually went to (see `alternate_phone_number`'s own note above and `getRecipientPhoneNumbers()`), each independently `sent`/`failed`.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `client_id` | UUID | FK → `clients.id` |
| `type` | ENUM — widened after Phase 33 to the union of the old 4 values and the new 13, since this table is append-only history: existing rows keep whichever value they already had, only new rows use the 13-value catalog | which message flow produced this log |
| `phone_number` | VARCHAR | snapshot at send time |
| `message_content` | TEXT | **Changed 2026-09-14** (human report — an admin reading a conversation's log couldn't tell if a real message had gone out, since this used to be just the ordered body parameters joined by `" \| "` for reference, e.g. `"Señor/a Juana Pérez \| 7 \| #1021 \| 17 \| Cuenta con un saldo a favor de $0."` — never the client-facing text). Now the real rendered body: `message_templates.content` (the literal Meta-approved wording, with its `{{1}}`, `{{2}}`, ... placeholders) with those same parameters substituted in via `renderTemplateBody()`, at send time — the exact text Meta sent the client, snapshotted once, not re-derived later against whatever `message_templates.content` says at read time (which could change via a future migration if a template is ever resubmitted with revised wording) |
| `status` | ENUM (`sent`, `failed`) | |
| `sent_at` | TIMESTAMPTZ | |
| `retried_at` | TIMESTAMPTZ, nullable | Added Phase 18 — set on the ORIGINAL (failed) row once it's manually retried. Still append-only: this is a stamp on the historical row, not an edit of what was actually sent. |
| `retry_of_message_log_id` | UUID, nullable | Added Phase 18 — self-referencing FK → `message_logs.id`, `ON DELETE SET NULL`. Set on the NEW row created by a retry, pointing back at the original it retried. Both columns null on rows never retried; a retry that itself fails can be retried again, chaining further. |
| `whatsapp_message_id` | VARCHAR, nullable | Added 2026-09-03 (bug fix, see below) — Meta's WAMID for this send, null on a `failed` send or a row from before this column existed. Lets an inbound button reply be traced back to exactly which send it replied to, via the webhook's `context.id`. |
| `created_at` | TIMESTAMPTZ | append-only, no `updated_at`/`deleted_at` |

**One-time cleanup, 2026-09-11** (human report): every existing `failed` row was deleted (migration `CleanupFailedMessageLogs`) — a backlog that had piled up while `WHATSAPP_SENDING_PAUSED` (2026-09-06) blocks every send, none of which would ever be retried while it stays that way. `sent` rows were untouched. See `ENVIRONMENT_VARIABLES.md`'s `PAYMENT_CONFIRMATION_MESSAGES_PAUSED` for the related switch that now stops `PaymentConfirmation`/`PaidInFull` from creating new `failed` rows here in the first place while historical payments are being backfilled.

**One-time cleanup, 2026-09-19** (human report): every existing `failed` row was deleted again (migration `CleanupFailedTestMessageLogs`) — ~107 rows left by a failed test run, none of them a real send. `sent` rows were untouched, same as the 2026-09-11 cleanup above.

**`message_content` rendering, added 2026-09-14** — `renderTemplateBody()` (`apps/api/src/whatsapp/templateBodyRenderer.ts`) does the `{{n}}` substitution; every send site (`PaymentConfirmationService.sendAndLog`, `OverdueReminderService`/`UpcomingDueReminderService.sendReminderForClient`, `NewLoanReminderService.sendNewLoanMessage`) already fetches the `MessageTemplate` row for `metaTemplateName`/`metaLanguageCode`, so this just also reads its `content`. Historical rows sent before this change keep their old `" \| "`-joined text as-is — not backfilled. `apps/client`'s conversation view (`WhatsappInboundMessagesPage.tsx`'s `AutomatedMessageBubble`) gained `whitespace-pre-wrap` so the real line breaks in a rendered message show up instead of collapsing into one line — the standalone "Mensajes" page's detail drawer (`MessageLogDrawer.tsx`) already had this class, since it was already built expecting the full natural text.

### `message_audiences` / `message_audience_clients` (retired — Phase 27)

Added Phase 18 — a curated group of clients attached to one `message_template`. **Retired as of Phase 27** for `overdue`/`upcoming_due` (the only two types that ever used it — see "Message audience" in `GLOSSARY.md`): no service reads these tables anymore, and the `GET`/`PUT /message-templates/:type/audience` endpoints and `MessageAudiencesService` were removed entirely. The tables themselves are **deliberately NOT dropped** — they may still hold historical meaning, and dropping schema is its own confirmed decision, not a side effect of the Phase 27 migration. The `MessageAudience` entity class still exists (still picked up by TypeORM's glob-based entity loading, for migrations) but is no longer registered in `WhatsappModule`'s DI, since nothing injects its repository anymore.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `message_template_id` | UUID | FK → `message_templates.id`, `ON DELETE CASCADE` |
| `name` | VARCHAR | |
| `created_at`, `updated_at`, `deleted_at` | TIMESTAMPTZ | standard |

`message_audience_clients` was `message_audiences`' TypeORM-managed `@ManyToMany`/`@JoinTable` join table (`message_audience_id`, `client_id`, both PK/FK composite) — no separate entity class.

### `client_message_frequencies`

Added Phase 27 — replaces `message_audiences` for `overdue`/`upcoming_due`, but with a different semantic: this throttles how OFTEN a client is messaged, never WHETHER they're eligible (that stays purely dynamic). See "Message frequency whitelist" in `GLOSSARY.md`.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `client_id` | UUID | FK → `clients.id`, `ON DELETE CASCADE`, **UNIQUE** |
| `minimum_days_between_messages` | INT | Set freely by the admin per client (`PUT /clients/:id/message-frequency`) — no hardcoded default, confirmed with the human rather than guessed. |
| `created_at`, `updated_at` | TIMESTAMPTZ | standard — no `deleted_at`; the entry is deleted outright (`DELETE /clients/:id/message-frequency`) when an admin clears it, matching `client_references`' no-soft-delete precedent. |

Unlike `message_audiences` (multiple rows allowed per template, service always uses "the most recently created one"), `client_message_frequencies` has a genuine 1:1 relationship with its client — a DB-level `UNIQUE` constraint on `client_id` plus a find-or-create upsert in `ClientsService` removes any "which row is canonical" ambiguity that pattern would otherwise need. Read by `MessageFrequencyThrottleService` (in the whatsapp module, not the clients module, since it also needs `message_logs` to compute "days since last message") — see `docs/phases/PHASE_27_MESSAGE_FREQUENCY.md`.

### `message_log_items`

Bridges a `message_log` to the specific installments it covered — since one message reports on multiple overdue installments across potentially multiple loans.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `message_log_id` | UUID | FK → `message_logs.id` |
| `installment_id` | UUID | FK → `installments.id` |
| `overdue_days_snapshot` | INT | overdue days **at the moment this message was sent** — stored here because it changes daily; this is historical record, not the live value |
| `interest_snapshot` | DECIMAL(12,2) | interest amount **at the moment this message was sent** |
| `created_at` | TIMESTAMPTZ | append-only |

This table is what lets us reconstruct "what exactly did we tell this client on this date" without recalculating from current data — important since overdue days and interest change every day, but the message sent is historical fact.

Reused as-is across all message types added in Phase 9, not extended: for an installment that isn't overdue (a `new_loan` or not-yet-due `upcoming_due`/`account_summary` line), `overdue_days_snapshot` and `interest_snapshot` are legitimately `0` — `enrichInstallment()` already returns `0` for both in that case, this isn't a special case. "Days until due" for `upcoming_due` is not stored as a separate column; it's preserved as text in `message_logs.message_content`.

### `audit_logs`

Added Phase 11 — a generic, append-only trail of sensitive actions across the system (clients, loans, payments, users), written automatically by a global interceptor rather than hand-added logging calls in each service. See `docs/phases/PHASE_11_AUDIT_LOG.md`.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `actor_user_id` | UUID, nullable | FK → `users.id`, `ON DELETE SET NULL` — nullable because not every action necessarily has an authenticated actor (e.g. a future cron-triggered action); `SET NULL` keeps the log entry (with its `metadata`) even after the acting user is deleted, rather than losing history |
| `action` | VARCHAR | `<entityType>.<verb>`, e.g. `client.create`, `loan.refinance`, `payment.register`, `user.deactivate` — free text, not an enum, since new actions are added by decorating a new endpoint (`@Audit()`), not by a schema migration |
| `entity_type` | VARCHAR | e.g. `client`, `loan`, `payment`, `user` |
| `entity_id` | UUID, nullable | the specific record this action affected — resolved from the endpoint's response for create actions, from the route's own `:id` otherwise (see `AuditLogInterceptor.resolveEntityId`) |
| `entity_label` | VARCHAR, nullable | a human-readable snapshot of that specific record — `"Juana Pérez (CC 1234567890)"`, `"Pagaré #743"`, `"Pago de $110.667 el 2026-09-03 — cuota 3 del pagaré #0910"` — resolved once at write time (see `AuditLogInterceptor.resolveEntityLabel`) and frozen, not re-derived from the live record on read; the record may have since changed or been soft-deleted. Added Phase 11 follow-up — client feedback: `entity_type` alone ("Cliente") said which module an action happened in but not which specific record, which stopped being usable once there were hundreds of clients. `null` when no labeling rule exists yet for that `entity_type`. |
| `metadata` | JSONB, nullable | the request's route params and body at the time of the action; known-sensitive fields (`password`, `passwordHash`, etc.) are redacted to `[redacted]` before this is ever written — never stored in the clear |
| `created_at` | TIMESTAMPTZ | append-only, no `updated_at`/`deleted_at` — an audit trail that can itself be edited or deleted defeats its purpose |

Written by `AuditLogInterceptor`, registered globally (`APP_INTERCEPTOR`) but a no-op for any endpoint not decorated with `@Audit(action, entityType)` — read-only routes, auth, health checks, etc. produce no entry. A failed request (a thrown exception) never produces a log entry either; a failed *write* to `audit_logs` itself is logged and swallowed rather than failing the real request it was trying to record.

**Coverage gap found and fixed, 2026-09-03** (human report — created/deleted a few `interest_concept_types` rows and found nothing in `/auditoria`): `InterestConceptTypesController`'s four mutating endpoints (create, update, deactivate, delete) had never been decorated with `@Audit()` at all, since Phase 14 predates this table (Phase 11). Added `entityType: 'interestConceptType'`, actions `interestConceptType.create/update/deactivate/delete`, and a matching label case in `AuditLogInterceptor.resolveEntityLabel` (reads `entity.name`, with the same pre-fetch-before-delete fallback `user.delete` uses, since `remove()` is a real SQL `DELETE` returning `void`). Confirmed still missing, not yet fixed, in the same sweep: `whatsapp` (reply, close-conversation, cron pause/resume/reschedule, manual send-reminder/send-upcoming-due) and `message_logs.retry` — the human chose to fix only `interest_concept_types` for now.

**Two follow-up fixes, 2026-09-04** (human report, screenshot of `/auditoria`): (1) `interestConceptType.create/update/deactivate/delete` had `@Audit()` metadata but no matching entry in the frontend's `ACTION_LABELS`/`ENTITY_TYPE_LABELS` dictionary (`apps/client/src/features/auditLogs/auditLogLabels.ts`) — same class of "presentation-only, frontend fell out of sync with a new `@Audit()` call" bug `docs/phases/PHASE_32_UI_FIXES.md` already documented for `loan.delete`/`payment.registerBulk`/etc.; fixed the same way, by adding the missing entries (this table's `entity_type`/`action` columns were never the problem — they'd been correct since 2026-09-03). (2) `payment.register`'s `entity_label` only ever said the amount and paid date ("Pago de $110.667 el 2026-09-03"), with no way to tell which loan or installment — `AuditLogInterceptor`'s `'payment'` case now looks the `Installment` (and its `loan` relation) up by the response's `installmentId` and appends `" — cuota N del pagaré #XXXX"` when found, falling back to the plain amount/date label otherwise (installment already deleted, or `payment.registerBulk`'s array response, which was never covered by this case to begin with). Required registering `Installment` alongside the other read-only lookup repositories already injected into `AuditLogModule`/`AuditLogInterceptor` (see that interceptor's constructor comments).

**Coverage gap partially closed, 2026-09-10** (human report — the Plantillas tab's per-family cron menu, `FamilyCronControl` in `MessageTemplatesPage.tsx`, left no trail in `/auditoria`): closes the "cron pause/resume/reschedule" item from the 2026-09-03 note above. `WhatsappController`'s three `/whatsapp/cron/:family/*` endpoints (pause, resume, schedule) are now decorated with `@Audit('whatsappCron.pause'|'whatsappCron.resume'|'whatsappCron.reschedule', 'whatsappCron')`. `AuditLogInterceptor.resolveEntityLabel`'s new `'whatsappCron'` case reads the reminder family off `params.family` (translated via a Spanish label map mirroring `MessageTemplatesPage.tsx`'s own `FAMILY_LABELS`) and distinguishes pause/resume/reschedule purely off the response shape, same convention as the `'payment'` case's register-vs-void split: pause/resume both return `{ paused: boolean }` (`WhatsappCronService.pause`/`resume`), reschedule returns the schedule-owner `MessageTemplate` (has `cronExpression`, no `paused`) — e.g. `"Cuotas vencidas — pausado"`, `"Nuevo pagaré / Refinanciación — nuevo horario: 0 8 * * 1"`. Still confirmed missing, not addressed by this fix: `whatsapp` (reply, close-conversation, manual send-reminder/send-upcoming-due) and `message_logs.retry`.

### `usury_rates`

Added Phase 15 — Colombia's legal usury ceiling, certified monthly by the Superintendencia Financiera. See `docs/phases/PHASE_15_USURY_RATE.md`.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `effective_month` | DATE, **UNIQUE** | first day of the certified month (e.g. `2026-08-01`). Unique because a month's rate is never edited — a correction is a new row for a different month, not an update. |
| `rate_percentage` | DECIMAL(7,4) | the monthly EFFECTIVE rate actually applied to loan interest — every downstream consumer (`LoansService` pricing percentage concepts per installment) reads this unchanged. As of 2026-09-03 it's computed automatically from `annual_rate_percentage` (see below), not typed by hand — widened from DECIMAL(5,2) in the same migration, since 2 decimal places would truncate a real value like 2.1605%. |
| `annual_rate_percentage` | DECIMAL(6,2), nullable | the raw annual rate as published by the Superintendencia (e.g. `29.24`), entered by the admin. Nullable only because it didn't exist before 2026-09-03 and no real rate had been entered in production yet (nothing to backfill) — `CreateUsuryRateDto` always requires it for new rows. See `docs/GLOSSARY.md` "Tasa de usura / Usury rate" for the annual→monthly conversion formula. |
| `created_by` | UUID, nullable | FK → `users.id`, `ON DELETE SET NULL` — same pattern as `audit_logs.actor_user_id` |
| `created_at` | TIMESTAMPTZ | append-only, no `updated_at`/`deleted_at` — **historical rows, never mutated**, confirmed non-retroactive with the human (a new month's rate applies only to interest accruing from that point forward) |

`UsuryRateService.getCurrentRate()` returns the most recent row plus a computed `isStale` flag (true when that row's `effective_month` isn't the current calendar month) — not stored, since the SFC's publication date isn't a fixed day (see the phase doc's domain research).

**Superseded after Phase 24:** enforcement is no longer a warning. `getCurrentRate()` returning `null` or `isStale: true` now hard-blocks `POST /loans`, `POST /loans/:id/refinance`, and `POST /loans/preview-schedule` outright — see `docs/phases/PHASE_24_USURY_MANDATORY.md`. The current rate's `ratePercentage` is also auto-applied as the `value` of every percentage-type `interest_concept_types` concept (corriente or moratorio) assigned to a loan, overriding whatever the request sends — only `fixed_amount` concepts stay admin-set. `loans.usury_ceiling_exceeded_at_creation`/`usury_justification` (Phase 15) were dropped by this phase's migration — a loan can no longer exceed the ceiling by construction, so nothing is left to flag.

### `whatsapp_inbound_messages`

Added Phase 22 — append-only, one row per inbound WhatsApp event Meta's webhook delivers (a template quick-reply button tap or free text a client sends in), whether or not it matched a known client. See `docs/phases/PHASE_22_WHATSAPP_WEBHOOK.md`.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `client_id` | UUID, nullable | FK → `clients.id`, `ON DELETE SET NULL` — an inbound message from a phone number that matches no client is still logged, never dropped. `SET NULL` (not `RESTRICT`) since this is historical record of an event, not a reference that should block a client's own soft-delete. |
| `from_phone_number` | VARCHAR | as received from Meta, before normalization — see below |
| `type` | ENUM (`button`, `text`, `image`, `document`, `audio`, `video`, `sticker`, `location`, `other`) | `button` covers both a template's quick-reply tap (Meta's `type: "button"` payload shape) and a session interactive `button_reply` (`type: "interactive"`) — both normalize to the same row shape here. The six media values were added 2026-09-11, see the note below; `other` is anything else (contacts, reactions, orders, system events, truly unrecognized types), kept rather than dropped. |
| `button_payload` | VARCHAR, nullable | the button's `payload`/`id`, only set when `type = 'button'` |
| `body_text` | TEXT, nullable | the message body for `text`, or the button's display text for `button` |
| `media_url` | VARCHAR, nullable | Added 2026-09-11. The Cloudinary URL an image/document attachment was re-hosted to — see the note below. Null for any non-media message, a media type that isn't re-hosted, or when the re-host hasn't succeeded (yet, or at all). |
| `meta_media_id` | VARCHAR, nullable | Added 2026-09-14. Meta's own media id for an audio/video attachment — deliberately NOT re-hosted to Cloudinary like `media_url` above. See the "Audio/video playback without Cloudinary" note below. |
| `raw_payload` | JSONB | the full webhook POST body, for debugging/replay |
| `received_at` | TIMESTAMPTZ | from Meta's own `timestamp` field on the message; falls back to server time if that's missing/malformed |
| `created_at` | TIMESTAMPTZ | append-only, no `updated_at`/`deleted_at` — same convention as `message_logs` |

**Phone number matching:** Meta sends the sender's number without a leading `+` (e.g. `573001234567`); `clients.phone_number` is stored E.164 with one (e.g. `+573001234567`). `client_id` is resolved by prepending `+` when absent, then matching against `clients.phone_number` exactly — see `normalizeIncomingPhoneNumber` in `apps/api/src/whatsapp/webhook/`.

**What's not yet built:** whether an inbound signal (e.g. a "No") persists as a standing client preference — still open, see `docs/phases/PHASE_22_WHATSAPP_WEBHOOK.md`. The button-flow/"menu" catalog and automated handling of unprompted free text are now built — see `whatsapp_conversation_states` below and `docs/phases/PHASE_34_INTERACTIVE_MENU.md`.

**Media types, 2026-09-11** (human report — a client's payment receipt photo rendered as a bare "—" in the inbox, same as any unrecognized event): `type` widened from 3 to 9 enum values so `image`/`document`/`audio`/`video`/`sticker`/`location` each get their own value instead of all falling into `other`. `body_text` is populated from whatever caption Meta attaches when the sender added one (image/document/video only — audio and stickers never support a caption in any WhatsApp client), falling back further to the filename for a document with no caption, or to raw coordinates for a location with no named place. See `extractInboundEvents.ts`'s `parseMessage`.

**Re-hosting the media itself, 2026-09-11:** a media id's underlying file only exists on Meta's servers temporarily — after that window closes, `raw_payload`'s copy of the id stops resolving to anything, permanently. `WhatsappMediaService` (`apps/api/src/whatsapp/webhook/whatsappMedia.service.ts`) downloads it from Meta's Media API right when the webhook event arrives and re-hosts it on Cloudinary, writing the result to `media_url`. It signs its upload through the same `UploadsService` (`apps/api/src/uploads`) the browser-initiated flow (`apps/client/src/lib/imageUpload.ts`) requests a signature from, rather than carrying its own copy of Cloudinary's signing algorithm — see that service's own comment. Needs the same `CLOUDINARY_CLOUD_NAME`/`CLOUDINARY_API_KEY`/`CLOUDINARY_API_SECRET` (see `ENVIRONMENT_VARIABLES.md`) as the browser flow — "pending, no account created yet" until that account exists, in which case this logs and skips. Runs synchronously inside the webhook request, before the live socket push — no background-job infrastructure exists in this project yet; revisit if a slow download/upload ever causes Meta to see the webhook as timing out.

Scoped to **only `image`/`document`**, the two kinds relevant as payment evidence for this business — `audio`/`video`/`sticker` keep their own recognized `type` (still logged, never dropped) but are deliberately never re-hosted, to avoid spending Cloudinary quota on something nobody needs to review as a comprobante.

**Audio/video playback without Cloudinary, 2026-09-14** (human report — the client wants a voice note playable and a video watchable right from the inbox, but explicitly does NOT want either one stored in Cloudinary): a new nullable `meta_media_id` column holds Meta's own media id for an audio/video message (`extractInboundEvents.ts`'s `parseMessage` now extracts it, same as image/document's `mediaId` always has), but `WhatsappWebhookService.persistEvent` never hands it to `WhatsappMediaService.downloadAndStore` — it just saves the raw id as-is. `GET /whatsapp/inbound-messages/:id/media` (`WhatsappMediaService.fetchMediaBytes`) fetches the file fresh from Meta's Media API on every request instead, streaming the bytes straight through with `@Res()` (bypassing the `{success, data}` envelope, same pattern `ClientsImportController`'s file downloads use) — nothing is ever persisted outside WhatsApp itself. Consequence: Meta's own copy is temporary (see this note's own first paragraph), so an old enough message's audio/video can 404 even though `meta_media_id` is still on file and the message itself is still logged — acceptable, since this is for reviewing a recent message, not long-term archival. The frontend (`WhatsappInboundMessagesPage.tsx`) fetches this endpoint as an authenticated blob (same `tokenStore` + raw `fetch` pattern `clientsImportApi.ts` uses for its own binary downloads) and plays it via `URL.createObjectURL`, since a plain `<audio src>`/`<video src>` can't carry the Bearer auth header this endpoint requires.

**Noted for later — reusing the re-hosted media in a payment record:** once a client's WhatsApp comprobante has a `media_url`, that same Cloudinary URL could pre-fill a payment's receipt photo when a worker registers that payment, instead of them re-downloading and re-uploading the same screenshot by hand. Needs a way to match a `whatsapp_inbound_messages` row to the specific installment being paid (by client + timing, or a manual picker) and a UI entry point on the payment form — not built, flagged here as a candidate follow-up, not scoped.

**Conversations are paginated server-side, 2026-09-14 (critical bug fix):** the inbox used to build its conversation list by fetching a single flat, globally-capped page of raw messages (`GET /whatsapp/inbound-messages`, ordered `received_at DESC`) and grouping it client-side — one shared budget across EVERY client's messages combined, not per conversation. A chatty client could crowd the other slots out of that budget entirely, hiding a quieter conversation from the list (and from being closeable) even though its `whatsapp_conversation_tickets` row still counted toward the pending badge; within an already-open thread, the same shared cap could also truncate that conversation's own history if enough OTHER clients had messaged recently. `GET /whatsapp/conversations` (`WhatsappWebhookService.findConversations`) now aggregates one row per contact directly in Postgres via `DISTINCT ON`, paginated by CONVERSATION instead of by message; a conversation's own history is fetched separately, scoped by `clientId`/`fromPhoneNumber`, once it's actually opened. A `clientIds` filter (unpaginated) backs the "Esperando asesor" queue specifically, resolving straight from the pending tickets' own client ids — a client whose ticket is pending but who's gone quiet since must still show up, regardless of how far back a recency-ordered page would otherwise put them. `whatsapp_manual_replies`' own read endpoint (`GET /whatsapp/inbound-messages/manual-replies`) got the identical fix — it used to be one flat, globally-capped window across every conversation's replies too.

### `whatsapp_conversation_states`

Added Phase 34 — one row per phone number currently mid-conversation with the self-service menu (main menu, "Mi cuenta" submenu, awaiting a payment receipt, or handed off to a human), tracking which screen a client is on so "Volver al menú" returns to the right one. Unlike `whatsapp_inbound_messages`, this is **not** append-only — one row per `phone_number`, upserted on every menu-navigation event, and not soft-deleted (ephemeral state, not a historical record). See `docs/phases/PHASE_34_INTERACTIVE_MENU.md`.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `phone_number` | VARCHAR, unique | one active state per number |
| `client_id` | UUID, nullable | FK → `clients.id`, `ON DELETE SET NULL` — same "log even if unrecognized" convention as `whatsapp_inbound_messages`, though in practice this table is only written for known clients (see below) |
| `current_menu` | ENUM (`main`, `mi_cuenta_submenu`, `awaiting_receipt`, `handed_off_to_human`) | which screen the client is on. `handed_off_to_human` added 2026-09-02 (bug fix) — a client tapping "Reportar un pago"/"Ya pagué" (once the receipt image arrives) or "Hablar con asesor" used to keep re-triggering an automated reply on every further message; both now transition here instead, where the bot goes silent until an admin explicitly closes the conversation (`WhatsappWebhookService.closeConversation`, `POST /whatsapp/inbound-messages/close-conversation`), which sends a generic closing message and clears the row. |
| `expires_at` | TIMESTAMPTZ | refreshed to now + 24h on every write, matching Meta's own session window — a row past this is treated as "no state" by query, not physically deleted |
| `created_at` / `updated_at` | TIMESTAMPTZ | |

**Only written for known clients:** `SelfServiceMenuService` requires a resolved `Client` to look up installments/payments for the breakdown and history actions, so an inbound event from an unrecognized phone number gets no automated menu reply and no row here — it's still logged in `whatsapp_inbound_messages` as before, per Phase 22's existing behavior.

**Reading it from the panel:** `GET /whatsapp/inbound-messages/conversation-state?phoneNumber=...` backs the inbound-messages inbox's "Responder"/"Cerrar conversación" gating (`apps/client`'s `WhatsappInboundMessagesPage.tsx`) — the manual reply box and close button are only shown while a number is in `awaiting_receipt` or `handed_off_to_human`.

**Cleanup:** expired rows are simply ignored by `WhatsappConversationStateService.getActive()` rather than deleted by a scheduled job — the simplest option, revisit if row volume ever becomes a real concern.

### `whatsapp_conversation_tickets`

Added 2026-09-13 (human report) — cobradores had no way to tell which WhatsApp conversations actually need a human vs. a client just clicking through the self-service menu. One row per client, upserted (not append-only, unlike `whatsapp_inbound_messages`) — unlike `whatsapp_conversation_states`, this never expires on its own: it tracks whether a HUMAN has resolved the client's request, which can legitimately take longer than 24h (a comprobante sent Saturday night might not get reviewed until Monday).

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `client_id` | UUID, unique | FK → `clients.id`, `ON DELETE RESTRICT` — live operational state a cobrador acts on, not a historical record that should go blank under a deleted client. Every trigger below only ever runs for a resolved `Client`, so this is never null. |
| `status` | ENUM (`pending`, `resolved`) | Deliberately just 2 states, not a 3-state pending/in-progress/resolved model: a middle state that stops counting toward the pending badge the moment someone opens the chat would let a conversation someone opened but got distracted from silently fall off the radar. |
| `trigger_kind` | ENUM (`advisor_requested`, `receipt_image`, `receipt_document`, `free_text`) | What most recently (re)opened this ticket — purely informational, shown in the inbox list so a cobrador knows why without opening the chat. |
| `pending_since` | TIMESTAMPTZ | Refreshed every time `status` (re)becomes `pending` — drives FIFO ordering (oldest-waiting-first) in the inbox, not `created_at`, since a reopened ticket jumps back to "just started waiting". |
| `resolved_at` | TIMESTAMPTZ, nullable | |
| `created_at` / `updated_at` | TIMESTAMPTZ | |

**Opened/reopened by:** `SelfServiceMenuService.handOffToAdvisor` (`advisor_requested`), the guided receipt flow completing (`handlePossibleReceipt`, `receipt_image`/`receipt_document` off the inbound event's own `type`), an unprompted image/document the client sends without going through "Reportar un pago" first (same handler, silently: no automated reply, no menu-state change; scoped to `image`/`document` only, not `audio`/`video`/`sticker`/`location`/`other`), and — 2026-09-14 — `handleFreeText`'s `free_text` case: a client who never touches the button menu at all, just keeps typing what they need. Fires only once the client has already received a menu at least once (i.e. the `resendCurrentMenu` branch, not the very first `sendMainMenu` on a fresh/expired conversation) and is still typing free text instead of tapping a button — a client's first-ever message is expected to be free text before they've seen any menu, and doesn't by itself mean anything's wrong.

**Resolved by:** the existing close-conversation action (`WhatsappWebhookService.closeConversation`, `POST /whatsapp/inbound-messages/close-conversation`) — closing IS resolving, regardless of whether the closing message itself actually sent. A no-op when the client has no ticket at all.

**Never resolved by time or by the WhatsApp session window closing** — only close-conversation does. This matters because of a real edge case: a client asks for an advisor at 9pm on a Saturday, nobody sees it until Monday, and Meta's 24h window has long since closed by then — if this table auto-resolved on some timeout, the client could see a contradictory sequence ("an advisor will contact you" → some auto "conversation closed" message → "we're still reviewing your case"). Keeping resolution 100% tied to the explicit human action makes that sequence impossible: the ticket just stays `pending` for as long as it takes.

**`sendClosingMessage`:** close-conversation takes an optional `sendClosingMessage` (default `true`, the only behavior it had before) — `false` resolves the ticket and clears `whatsapp_conversation_states` without sending the generic closing message at all. Exists for exactly the case above: once a ticket's 24h window has already closed, sending it would fail anyway (Meta rejects a free-form send outside the window), so a cobrador can resolve the ticket without WhatsApp ever seeing a doomed send attempt. `apps/client`'s "Cerrar conversación" button exposes this as an "Avisar al cliente" checkbox, checked by default.

**Business hours:** confirmed with the client — lunes a viernes 9am–7pm, sábados 9am–4pm, domingos cerrado (`apps/api/src/whatsapp/businessHours.ts`'s `isWithinBusinessHours`, fixed UTC-5 offset, no festivos check). `handOffToAdvisor` and the receipt-received acknowledgment (`SelfServiceMenuService.handlePossibleReceipt`) swap in out-of-hours copy telling the client they'll be attended once staff is back, instead of the normal wording — still a plain session message either way (the client's own inbound message already reopened the 24h window regardless of time of day), so this needed no Meta template approval. A separate, not-yet-built piece: when a cobrador finally acts on a ticket after its 24h window has already closed, a real send will fail outright (Meta rejects free-form sends outside that window) — the plan is a dedicated Meta-approved re-engagement template (draft name `seguimiento_solicitud`, category Utility), since sending a template does NOT itself reopen the free-form window, only the client replying to it does. Can't be built until that template is created and approved in Meta Business Manager (external dependency, same "pending" status as the Cloudinary account — see `whatsapp_inbound_messages`' own note above).

**Reading it from the panel:** `GET /whatsapp/tickets` — a flat list, no pagination (row volume is inherently small: one row per client that has ever needed a human), backing the inbox's pending badge/filter/pinning. Live-pushed via the same `WhatsappInboundGateway` other inbox events use (`ticket-update`).

**Audit:** `POST .../close-conversation` is now decorated `@Audit('whatsappTicket.resolve', 'whatsappTicket')` — closes another item off the 2026-09-03 coverage sweep noted above (`whatsappCron`'s own note). Its response carries no client, so the audit label is resolved by looking the client up from the submitted `phoneNumber` (matching either their primary or alternate number), not from the response.

**Added, 2026-09-13 — `whatsapp_manual_replies.self_service_reply_kind`:** `WhatsappOutboundLogService.log()` covers both the self-service menu's own automated replies AND `closeConversation`'s closing message, told apart only by `sentByUserId: null` for both — this nullable enum column (`main_menu`, `mi_cuenta_submenu`, `breakdown`, `payment_history`, `receipt_request`, `receipt_received_ack`, `advisor_handoff`, `volver_al_menu_follow_up`) further tags WHICH self-service action produced a reply, set only by `SelfServiceMenuService`'s `sendText`/`sendInteractive` wrappers — null for an admin's own typed reply or the closing message, same as before this column existed. Not yet surfaced in `apps/client`'s UI (still shown generically as "Automático") — that's a follow-up, not built here.

## Refinancing

When a loan is refinanced:

1. The old loan's `status` is set to `refinanced`.
2. A new loan row is created with `refinanced_from_loan_id` pointing to the old loan's `id`.
3. The new loan reuses the old loan's own `promissory_note_number` (see "Redesign, 2026-09-06" below), and gets its own `principal_amount` (typically the old balance + accrued interest) and its own set of `installments`.
4. The old loan's remaining pending installments, if any, have their `status` set to `cancelled` — a distinct status confirmed with the client, kept as historical record but excluded from overdue calculations, reminders, and dashboard totals (the same way `paid` installments are: `enrichInstallment` returns zero overdue days/interest/total due for both).

This mirrors patterns seen directly in the source data (e.g. `REFINANCIADO #981`, `SE REFINANCIO EN EL #1000`).

**Redesign, 2026-09-06 (confirmed with the client) — the new loan keeps the SAME promissory note number, replacing the old one under it, instead of getting a new number.** This matches how the business actually files pagarés physically: refinancing `#0800` produces a new loan that is *also* `#0800`, not a new `#1201`. `LoansService.refinance()` now sets `promissoryNoteNumber` server-side from `oldLoan.promissoryNoteNumber` — `RefinanceLoanDto` no longer accepts it as input at all, and `RefinanceLoanForm.tsx` no longer asks for or pre-fills a number.

A genuinely **new** loan (`create()`) still permanently blocks reusing any number that ever belonged to any other loan — active, paid, refinanced, or soft-deleted (confirmed with the client: a historical pagaré's number must stay unavailable to anything except that exact loan's own refinancing chain). `LoansService.assertPromissoryNoteNumberIsUnique()` is unchanged for this path. Refinancing is the one deliberate exception, and it doesn't go through that check at all: the reused number always already exists (on the loan being refinanced, and possibly on earlier loans further back in the same chain), so the strict check would always reject it — `persistLoanWithInstallments` skips it via `skipPromissoryNoteNumberUniquenessCheck`, set only by `refinance()`. Since a pagaré's number can therefore legitimately repeat across its own refinancing history (any number of `refinanced`/`paid` rows from that one chain sharing a number, plus at most one `active` row at a time), the old unconditional `loans.promissory_note_number` unique constraint had to be relaxed at the DB level too — replaced with a **partial unique index scoped to `status = 'active' AND deleted_at IS NULL`** (see migration `ScopePromissoryNoteNumberUniquenessToActiveLoans1788800000000`), which now serves only as a last-resort guard against a concurrent double-refinance race, not as the uniqueness rule for new loans (that's the application-layer check above). `getNextPromissoryNoteNumber()`/`GET /loans/next-promissory-note-number` is now only used by `LoanForm` (genuinely new loans) — refinancing has nothing left to suggest.

A separate, much rarer real-world case — merging several pagarés into one during a single refinance (seen in only 3-4 loans out of ~1200) — was deliberately **not** built as a first-class feature; the client agreed a manual workaround (paying off the absorbed loans via the existing "Liquidar anticipadamente" flow, then refinancing the remaining one for the combined amount) is sufficient given how rarely it comes up.

**Suggested principal (Phase 17, extended by Phase 25):** `GET /loans/:id/refinance-quote` suggests a `principalAmount` via the same `calculatePayoff()` engine Phase 16's payoff quote uses — principal remaining on pending installments, plus interest already caused (Art. 1653) on any matured one. As of Phase 25, a loan can be refinanced regardless of overdue installments (the earlier "client must be current first" rejection was removed, confirmed with the client, reunión 2026-08-25) — instead, an overdue installment's accrued corriente and moratory interest is folded into the suggested principal, and an installment due within the next 5 calendar days (not yet actually overdue) is treated the same way but contributes only its corriente interest, since no real mora has accrued on it yet. This is advisory only — `POST /loans/:id/refinance` still accepts whatever `principalAmount`/`concepts` the admin actually submits.

## Migrations

Same policy as before: no `synchronize: true`, one migration per schema change, committed in the same PR, migrations never edited after being merged. See prior version of this document's conventions — unchanged here except for the tables above.

```bash
npm run migration:generate -- src/migrations/DescriptiveName
npm run migration:run
npm run migration:revert
```

## Indexes

- Every foreign key (`client_id`, `loan_id`, `installment_id`, `message_log_id`, `actor_user_id`, `interest_concept_type_id`, `created_by` on `usury_rates`)
- `usury_rates.effective_month` — unique, and looked up on every loan creation/refinance to enforce the ceiling
- `loans.promissory_note_number` — looked up constantly, must be fast; the DB-level constraint is a partial unique index scoped to `status = 'active'` rows as of the 2026-09-06 refinancing redesign (see "Refinancing" above), no longer a plain column-level unique constraint — full "never reused by an unrelated new loan" uniqueness is enforced at the application layer instead (`LoansService.assertPromissoryNoteNumberIsUnique`)
- `clients.document_number` — for search and duplicate prevention
- `clients.phone_number` — for search and WhatsApp matching. **Unique, as of 2026-09-16** (human confirmed: two clients must never share a phone number) — see `AddUniqueConstraintToClientsPhoneNumber1790800000000`. Enforced the same way as `document_number`: `ClientsService.assertPhoneNumberIsUnique` pre-checks (including soft-deleted clients) before a friendlier `ConflictException` beats the DB constraint to it; the constraint itself is the last-resort guard against a concurrent-request race.
- `installments.due_date` and `installments.status` — the weekly CronJob queries heavily on both
- `audit_logs (entity_type, entity_id)` and `audit_logs (actor_user_id, created_at)` — back "show me the history for this record" and "show me what this user did, most recent first", the two filters the audit log screen supports (see `docs/phasesClient/PHASE_11_AUDIT_LOG.md`)
- `client_references.client_id` — every lookup is "give me this client's references"

## Open questions — confirm with client before finalizing

None currently open. (The only entry here — how `interest_rate` was determined/changed over time — was mooted 2026-09-09 when the column itself was removed; see "Removed, 2026-09-09" below.)

## Resolved from Phase 4

- ~~Whether installment amounts within a loan are always equal or can vary~~ → Confirmed: they can vary. `POST /loans` and `POST /loans/:id/refinance` both require an explicit `installmentAmounts` array (one amount per installment, must sum to `principalAmount`) rather than auto-splitting evenly.

## Resolved from Phase 6

- ~~What happens to remaining installments of a loan once it's refinanced~~ → Confirmed: they're marked `cancelled` — excluded from active overdue/reminder processing, kept as historical record. See "Refinancing" above.

## Added in Phase 9

- `message_templates.type` and `message_logs.type` — the system now supports four message types (`new_loan`, `upcoming_due`, `overdue`, `account_summary`), each with its own template, instead of a single global template. See `docs/phases/PHASE_9_MESSAGE_TYPES.md` for the full scope and the judgment calls made (e.g. why "list all active pagarés" and "total across all credits" were combined into one `account_summary` message instead of two).
- `loans.description` — free-text field supporting the `new_loan` message's "por concepto de X" line.

## Changed after Phase 9

- **`message_templates` is no longer admin-editable.** Phase 9 (and Phase 5 before it) treated `content` as something an admin edits freely through the API. In practice, WhatsApp only allows a business to *initiate* a conversation (as opposed to replying within an open 24h window) through a template Meta has pre-approved — see `CONFIGURACION_WHATSAPP_META.md`. A freely-editable `content` column in our own database doesn't reflect that reality: changing it without a matching change to the Meta-approved template would just break sending. So `is_active` and the create/update/activate/delete endpoints were removed (including the soft-delete endpoint added right before this change — same reasoning: deleting one of the 4 fixed rows would leave a message type with nothing to render and no way to recreate it outside a migration) — `type` is now `UNIQUE` (exactly one row per type), and `MessageTemplatesController` only exposes `GET /message-templates`, for the admin to see what's currently being sent.
- **Updating a template's content is a migration, not an API call** — the same controlled, reviewed process used for every other data change in this project (see "Migrations" above). `1784300000000-MakeMessageTemplatesStatic.ts` is both the migration that made this change and the one seeding the current canonical content per type; a future content change (e.g. after Meta approves new copy) follows the same pattern: a new migration.

## Added in Phase 11

- `audit_logs` — a generic, append-only trail of sensitive actions (client/loan/payment/user create/update/deactivate/reactivate/refinance/register), written automatically by a globally-registered interceptor rather than hand-added logging calls per service. See "`audit_logs`" above and `docs/phases/PHASE_11_AUDIT_LOG.md`.
- `InstallmentsController.registerPayment` now captures `@CurrentUser()` — previously it didn't capture the authenticated user at all. No new column on `payments`: the audit log entry is the record of who registered a payment, not a denormalized field on the payment itself.

## Added in Phase 12

- `payments.image_url` — nullable URL of the deposit receipt photo, hosted externally (Cloudinary). The api never receives or stores the image itself, only this string. See `docs/phases/PHASE_12_PAYMENT_ATTACHMENTS.md`.

## Added in Phase 14

- `interest_concept_types` — the admin-managed catalog of interest/fee concepts, extendable without a code change. Split by `category` (`corriente`/`moratorio`) as of Phase 23. See "`interest_concept_types`" above.
- `loan_installment_concepts` — the per-installment snapshot of concepts actually applied, immune to later catalog edits. See "`loan_installment_concepts`" above.
- `installments.principal_portion` — the capital-only part of an installment's `amount`, generated by the amortization schedule. Nullable for installments created before this phase.
- `loans.interest_rate` is no longer used to price new loans — see the "Changed after Phase 14" note under `loans` above. As of Phase 23 it's also superseded for moratory interest on any loan that has its own moratory concepts assigned — see "Superseded after Phase 23" under `loans` above. It remains only as the fallback formula for a loan with no moratory concepts.
- The amortization algorithm (declining balance, percentage concepts calculated against the balance before that installment's principal is subtracted, rounding remainder absorbed into the last installment) lives in `loans/amortization/generateSchedule.ts` — see `docs/phases/PHASE_14_INTEREST_CONCEPTS.md` for the full spec.
- **Not yet built:** the quote/simulator tool ("amortizador proyector") — the catalog and amortization engine it would reuse shipped first; see `docs/phases/PHASE_14_INTEREST_CONCEPTS.md`'s "Open question carried forward" section.

## Added in Phase 15

- `usury_rates` — historical, admin-entered monthly usury ceiling. See "`usury_rates`" above.
- ~~`loans.usury_ceiling_exceeded_at_creation`, `loans.usury_justification`~~ — **dropped in Phase 24** (see below), since a loan can no longer exceed the ceiling by construction.
- Enforcement was originally creation-time only, a warning rather than a block, and non-retroactive — see `docs/phases/PHASE_15_USURY_RATE.md` "Resolved". **Superseded in Phase 24** — see below.

## Added/changed in Phase 24

- Enforcement is now a hard block, not a warning: `POST /loans`/`POST /loans/:id/refinance`/`POST /loans/preview-schedule` all reject outright when the current month's rate is missing or stale. Still non-retroactive — a rate change never alters a past month's already-caused interest.
- Every percentage-type `interest_concept_types` concept (corriente or moratorio) assigned to a loan is auto-priced at exactly the current rate — not admin-editable — while `fixed_amount` concepts stay untouched. See `docs/phases/PHASE_24_USURY_MANDATORY.md`.
- `loans.usury_ceiling_exceeded_at_creation`/`usury_justification` (Phase 15) dropped via migration — the warning path they supported no longer exists.

## Added in Phase 18

- `message_templates.cron_expression` — admin-editable schedule per template; see "`message_templates`" above.
- `message_audiences`, `message_audience_clients` — curated per-template client group; see "`message_audiences`" above and "Message audience" in `GLOSSARY.md`.
- `message_logs.retried_at`, `message_logs.retry_of_message_log_id` — manual retry tracking, append-only (a retry always creates a new row rather than editing the original); see "`message_logs`" above.
- `loans.new_loan_message_sent_at` — lets the `new_loan` retry cron find loans still needing their message; see "`loans`" above.
- All four message types (`new_loan`, `upcoming_due`, `overdue`, `account_summary`) now have a cron job, not just the two that were already scheduled — additive audiences for the three with a dynamic condition, audience-only for `account_summary`, which has none. See `docs/phases/PHASE_18_MESSAGE_AUDIENCES.md` "Resolved".

## Added in Phase 21

- `clients` gained an extended KYC-style profile (document type/expiry-adjacent fields, address, employment, income, ID/selfie photo URLs) plus `data_processing_consent`, `consent_given_at`, `consent_document_url` — see "`clients`" above. All new profile columns are nullable; `data_processing_consent` is `NOT NULL DEFAULT false` but only *enforced* as required (via application logic, not a DB constraint) for interactively-created clients, not Excel imports.
- `client_references` — a new table for personal/comercial references, a dynamic add-many list per client. See "`client_references`" above.
- `loans` gained an optional co-debtor (codeudor): `co_debtor_full_name`, `co_debtor_document_type`, `co_debtor_document_number`, `co_debtor_phone_number`, `co_debtor_address`, `co_debtor_relationship`, `co_debtor_id_document_url`. Belongs to the loan rather than the client because whether a given loan has one varies per loan; at most one per loan. See "`loans`" above.
- The pagaré-photo field proposed early in this phase's design was discarded — not implemented, not present in any table.
- Legal basis and reasoning: Ley Estatutaria 1581 de 2012 + Decreto 1377 de 2013 ("Habeas Data"). The business owner is the "responsable del tratamiento"; this software is at most an "encargado" acting on instruction. The client's own authorization must happen physically/in person — the `data_processing_consent` checkbox in the app is staff-entered evidence that the physical authorization occurred, not the authorization itself, and sensitive/biometric data (`selfie_image_url`) is never made mandatory anywhere in the app, per the law's own restriction on conditioning any activity on a titular supplying sensitive data. See `docs/phases/PHASE_21_CLIENT_PROFILE.md` for the full decision log.

## Added in Phase 22

- `whatsapp_inbound_messages` — Collectify's first inbound WhatsApp capability, a webhook that receives what clients send back instead of only ever sending. See "`whatsapp_inbound_messages`" above.
- Two new env vars: `META_WHATSAPP_WEBHOOK_VERIFY_TOKEN` (Meta's handshake token) and `META_WHATSAPP_APP_SECRET` (signs `X-Hub-Signature-256`) — see `ENVIRONMENT_VARIABLES.md`.
- `GET`/`POST /api/v1/whatsapp/webhook` — the one deliberate `@Public()` exception in the `whatsapp` module; the API's global JSON-response envelope (`{success,data}`) is bypassed on the `GET` handshake's success path only, since Meta requires the bare `hub.challenge` string back.
- Only the not-blocked half of the phase shipped at the time — the button-flow catalog and automated reply logic shipped later, in Phase 34; preference persistence remains an open question. See `docs/phases/PHASE_22_WHATSAPP_WEBHOOK.md`.

## Added/changed in Phase 26

- **Co-debtor is now a linked `Client`, not flat columns.** `loans.co_debtor_full_name`, `co_debtor_document_type`, `co_debtor_document_number`, `co_debtor_phone_number`, `co_debtor_address`, `co_debtor_id_document_url` (Phase 21) were dropped outright via migration and replaced with `loans.co_debtor_client_id` (FK → `clients.id`) — no data migration/backfill, since no loan had ever been created with co-debtor data filled in at the time this shipped (confirmed with the business: "aun no sacamos la app entonces esos prestamos con codeudor no existen"). `co_debtor_relationship` is the one field kept as-is, standalone on `Loan` — see "`loans`" above.
- **A client can be co-debtor on more than one loan** (no uniqueness constraint on `co_debtor_client_id`), but **cannot be both the primary debtor and the co-debtor on the same loan** — enforced at the service layer (`LoansService.assertCoDebtorIsValid()`), not a DB `CHECK` constraint, matching this project's convention of keeping business rules in the service layer. Confirmed with the business.
- **No KYC-completeness gate on co-debtor eligibility** — any existing, active client can be attached as a co-debtor regardless of how much of their Phase 21 profile is filled in. Confirmed with the business: "Desde que tenga los campos obligatorios requeridos, no creo que haya problema."
- **`document_number` and address are now required at interactive client creation.** `ClientsService.create()` rejects a request missing `document_number`, or missing both `home_address` and `work_address` — application-level validation, not a DB `NOT NULL` constraint, same pattern as `data_processing_consent`/`document_type` (Phase 21). Unlike those two, **this rule is unconditional — it also applies to Excel-imported clients**, per explicit instruction from the business (documented as an exception to the Phase 21 bulk-import exemption precedent). The Excel import template (`clientLoanImportTemplate.ts`) documents both as conditionally required in its column hints.
- `GET /loans/:id` resolves `co_debtor_client_id` into a full client summary (`coDebtorClient`) on read, via `ClientsService.findByIdIncludingDeleted()` — deliberately permissive (never throws, includes soft-deleted) so a loan whose co-debtor was later deactivated still renders instead of breaking the detail view. This is a stricter/looser split from write-time validation (`ClientsService.findOne()`, which throws for a missing or soft-deleted id) — you can't newly attach a deactivated client as co-debtor, but an already-attached one deactivating later doesn't retroactively break the loan.
- The legacy, unused `POST /clients/import` endpoint and its supporting `clientsImportParser.ts` (superseded by the `ClientLoanImportService` bulk import flow, which the frontend actually calls) were removed as orphaned code, unrelated to the co-debtor/required-fields work above but done in the same phase.

## Added in Phase 34

- `whatsapp_conversation_states` — per-phone-number self-service menu state, closing Phase 22's "button-flow catalog" open question. See "`whatsapp_conversation_states`" above and `docs/phases/PHASE_34_INTERACTIVE_MENU.md`.
- No new endpoints or env vars — this phase is entirely webhook-driven, dispatched from the existing `POST /whatsapp/webhook`.
- Still open, unresolved by this phase: whether an inbound "No" persists as a standing preference (likely intersects `client_message_frequencies`, see "`client_message_frequencies`" above). See `docs/phases/PHASE_34_INTERACTIVE_MENU.md`'s open questions.
- **Resolved 2026-09-03**: the real per-template button layout, confirmed against Meta's actual configuration — three templates (`proxima_vencer_y_vencida`, `varias_cuota_vencida`, `varias_cuota_proxima_vencer`) carry "Más información" + "Ya pagué"; three (`una_cuota_vencida`, `una_cuota_vencida_en_mora`, `una_cuota_proxima_vencer`) carry "Ya pagué" only; every other template has no buttons. No template carries "Hablar con asesor" — that option only exists in the self-service menu's own main menu. See `docs/phases/PHASE_34_INTERACTIVE_MENU.md`'s "Resolved" section.

**Bug fix, 2026-09-02**: `current_menu` gained a fourth value, `handed_off_to_human` (see "`whatsapp_conversation_states`" above), plus two new admin endpoints — `GET`/`POST /whatsapp/inbound-messages/conversation-state` and `.../close-conversation` — and the corresponding `apps/client` UI ("Cerrar conversación" button on the inbound-messages inbox, replacing a stale reply-box gate that scanned for a literal `"1"` text left over from before the real menu existed).

## Redesign, 2026-09-03 — loan interest as a system field, not a catalog concept

A same-day sequence (mandatory catalog concept → auto-seeded → freely editable → sum-check → per-concept cap, each tried and reverted) ended with the human confirming the catalog-flag approach itself was wrong. Final design: `loans.corrienteInterestRate`/`moratoryInterestRate` (request fields, default and cap: current usury ceiling, "editable solo hacia abajo") become a system-generated `loan_installment_concepts` row per category — see `LoansService.resolveConceptsWithInterest`. `interest_concept_types` is optional business fees only, no flag. See `docs/phases/PHASE_24_USURY_MANDATORY.md` for the full history.

## Bug fix, 2026-09-03 — empty `loans.description` broke every new-loan WhatsApp send

Human report (production): created a loan, no `nuevo_pagar_cliente_nuevo` message was sent — and no `message_logs` row was created at all, meaning the failure happened before the WhatsApp API was even called. Root cause found in the production Railway console log: `WhatsAppService` got a `400` from Meta — `(#131008) Required parameter is missing … Parameter of type text is missing text value`.

`Loan.description` is optional (`CreateLoanDto.description?: string`, no `@IsNotEmpty`), and `newLoanTemplateSelection.ts`'s `selectNewLoanTemplate()` was forwarding `input.description ?? ''` straight into the `{{4}}` "Detalle del producto" body parameter for all four new-loan template variants. WhatsApp's template-send API rejects an empty-string text parameter outright — it must be present and non-empty, unlike a normal form field. Every new loan created with a blank description therefore failed to send its welcome message, silently: `sendNewLoanMessageSafely()` (per `docs/phases/PHASE_9_MESSAGE_TYPES.md`) catches and logs the failure so it never blocks loan creation, and `NewLoanReminderService.sendNewLoanMessage()` throws before reaching the `messageLogsRepository.save()` call inside `WhatsAppService.sendTemplateMessage`'s own error branch — so nothing showed up on `/message-logs` either, making this look like nothing was even attempted.

Fixed with `descriptionOrFallback()` in `newLoanTemplateSelection.ts`: trims `description` and substitutes the literal `"No especificado"` whenever it's null or blank/whitespace-only, for both the plain and "cuota inicial" new-loan template variants. No schema change — this is a pure template-parameter fix. Verified via unit tests (`newLoanTemplateSelection.spec.ts`) asserting the fallback for both `null` and whitespace-only description.

## Bug fix, 2026-09-03 — self-service "Ver mis cuotas" desglose

Two human reports on the self-service menu's breakdown message (`renderBreakdownMessage`/`renderAccountSummaryMessage` in `apps/api/src/whatsapp/messageRenderer.ts` and `selfServiceMenuMessages.ts` — reached from "Estado de cuenta"/"Cuotas pendientes" in the "Mi cuenta" submenu):

- **Emoji bullet numbering broke past the 10th installment.** `bulletForIndex()` only had emoji glyphs for 1-10 (`1️⃣`…`🔟`) and fell back to plain `"11."`, `"12."` text past that, breaking the visual consistency of the list. Fixed by composing a bullet from the individual digit keycap emojis for any two-digit number (e.g. `11` → `1️⃣1️⃣`, `12` → `1️⃣2️⃣`) instead of falling back to plain text.
- **Installments from different pagarés were interleaved by due date**, hard to follow at a glance for a client with more than one loan. `renderAccountSummaryMessage` now groups installments by `promissoryNoteNumber` under a `Pagaré #X:` header (first-appearance order, i.e. whichever pagaré has the earliest due installment listed first — the input is already dueDate-sorted), with the bullet numbering restarting inside each group and the redundant `"del pagaré #X"` phrase dropped from each line since the header already says it.
- **A client with only future (not-yet-due) installments and nothing overdue was shown the full desglose**, reading like an alarm for a debt that isn't actually late. `renderBreakdownMessage` now checks whether any returned installment has `overdueDays > 0`; if none do, it replies with a plain "estás al día con tus pagos" instead of listing them.

No schema or query change — `findPendingInstallmentsBreakdown` (`breakdownQueries.ts`) still returns every pending installment across a client's active loans; all three fixes are presentation-layer only. Verified via unit tests in `messageRenderer.spec.ts` and the new `selfServiceMenuMessages.spec.ts`.

**Follow-up, 2026-09-03**: `BREAKDOWN_TEMPLATE`'s closing line (`selfServiceMenuMessages.ts`) changed from "Total pendiente: {{grandTotal}}" to "El valor a pagar hoy es {{grandTotal}} 🚨" + "Quedamos atentos a cualquier consulta." — matching the confirmed real overdue-reminder phrasing (see `messageRenderer.ts`'s doc comment / `docs/GLOSSARY.md` → "Overdue reminder") instead of the more generic wording. Applies uniformly to every use of `renderBreakdownMessage` (Estado de cuenta, Cuotas pendientes, and the scoped "Más información" reply above), since they all share this one template.

## Bug fix, 2026-09-03 — reminder cron jobs ran in the server's time zone, not Colombia's

Human report: rescheduled the "Cuotas vencidas"/"Cuotas próximas a vencer" family cron to 14:40 via the admin panel's hour/minute picker; nothing fired, and no request appeared in the Railway log around that time at all.

`WhatsappCronService.registerJob()` constructed every `CronJob` (the `cron` npm package) without an explicit `timeZone`, so the cron fields were evaluated against the **server's own** system time zone — UTC on Railway — while `cronScheduleUtils.ts`'s picker builds its hour/minute from the admin's own local clock, assumed to be Colombia's (IMPROCRÉDITO operates out of Pasto — see the city baked into the new-loan template body). A picked "14:40" was actually scheduled for 14:40 UTC = 09:40 Colombia time, which had already passed earlier that same day by the time the admin checked at their own 14:40 — explaining both the silent no-send and the missing log line.

Fixed by pinning every `CronJob` explicitly to `America/Bogota` (Colombia has no DST, so no seasonal edge case) in `whatsappCron.service.ts`, regardless of what time zone the Node process itself runs in. Single-tenant, single-city business — hardcoded, not an env var. Verified directly against the `cron` package with `TZ=UTC`: `"40 14 * * *"` next-fires at `2026-09-04T14:40:00.000Z` without the fix vs. `2026-09-04T14:40:00.000-05:00` (i.e. the actually-intended Colombia wall-clock time) with it.

## Bug fix, 2026-09-03 — "Más información" answered with the client's whole account, not the reminder it replied to

Human report: tapping "Más información" on a reminder template (`proxima_vencer_y_vencida`, `varias_cuota_vencida`, `varias_cuota_proxima_vencer` — the three templates that carry this button) should answer only about the pagaré/installment(s) that specific reminder was about, not dump every pending installment across every one of the client's loans.

Previously `TemplateButtonPayload.MasInformacion` dispatched to the same `sendBreakdown()` handler as the self-service menu's own "Estado de cuenta"/"Cuotas pendientes" — by design for those two (an explicit "show me everything" request), but wrong for a reply to one specific reminder.

Fixed by tracing the button tap back to the exact reminder it replied to:

- `message_logs` gained `whatsapp_message_id` (Meta's WAMID for the send, see the table above) — `WhatsAppService.sendTemplateMessage()` now returns `{ sent, whatsappMessageId }` instead of a bare boolean, and every caller (`OverdueReminderService`, `UpcomingDueReminderService`, `NewLoanReminderService`, `PaymentConfirmationService`) persists it on the row it creates.
- `extractInboundEvents.ts`'s `ParsedInboundEvent` gained `contextMessageId` — Meta's inbound webhook carries `context.id` (the WAMID of the message a quick-reply button tap is replying to) for every template quick-reply tap.
- `SelfServiceMenuService.sendBreakdownForContext()` (the new `MasInformacion` handler): looks up the `message_logs` row by `whatsapp_message_id` + `client_id`, then its `message_log_items` for the exact installment ids that reminder was about, and renders the breakdown scoped to just those — via a new `findInstallmentsBreakdownByIds()` query (`breakdownQueries.ts`), which re-fetches their **current live** state (not the frozen send-time snapshot, since the client can tap the button days later). Falls back to the full-account breakdown (old behavior) when the tap can't be traced to a specific reminder — no context id on the event, or no matching `message_logs` row/items (an old message, or a send that never actually reached the API) — rather than replying with nothing.
- `EstadoCuenta`/`CuotasPendientes` (the self-service menu's own buttons) are unchanged — still the full account, by design.

Verified against a real local Postgres: seeded a `message_logs`/`message_log_items` pair scoping one specific overdue installment (out of 3 pending on the same client/loan), posted a real signed webhook payload with a matching `context.id` through the running API, and directly queried `findInstallmentsBreakdownByIds` against the live DB — returned exactly that 1 installment vs. 3 for the same client's full account.

## Removed, 2026-09-06 — `clients.neighborhood` ("Barrio")

Client request: the field was never actually used anywhere once entered — no report, filter, or WhatsApp message referenced it — so it was dropped outright rather than kept as dead weight, same call already made once for `loans.usury_justification`/`usury_ceiling_exceeded_at_creation` (see "Added/changed in Phase 24" above).

Dropped via a new migration (`1788700000000-DropNeighborhoodFromClients.ts`), not by editing the Phase 21 migration that added it — this project's migrations are never edited after being merged. Removed everywhere else it appeared: `Client` entity, `CreateClientDto`/`UpdateClientDto` (the latter inherits via `PartialType`), the Excel import (`clientsImportColumns.ts`'s column definition, `clientsImportTemplate.ts`'s header label, and `ClientsImportService`'s `CLIENT_MATCH_FIELDS` conflict check), `ClientForm.tsx`'s "Direcciones" section, and `ClientDetailPage.tsx`'s detail view.

## Bug fix, 2026-09-06 — phone number normalization

Client report, with a screenshot: a manually-created client showed `+57 321 940 2299` while a client imported the same day from Excel, typed as `3218204455`, was stored exactly as typed — no `+57`, no formatting. Root cause: `@IsPhoneNumber('CO')` on `CreateClientDto.phoneNumber`/`alternatePhoneNumber` and `CreateClientReferenceDto.phoneNumber` validates a number's format but never rewrites the value, so nothing canonicalized it before it reached the database — the frontend's `CO_PHONE_REGEX` gate on `ClientForm.tsx` only covers the interactive form, not the Excel import path, which has no client-side gate at all.

Fixed with `normalizePhoneNumber()` (`apps/api/src/clients/normalizePhoneNumber.ts`, using `libphonenumber-js`), wired in as `@Transform(({ value }) => normalizePhoneNumber(value))` ahead of `@IsPhoneNumber('CO')` on all three fields above. Since class-transformer's `@Transform` runs before class-validator's checks — both under the global `ValidationPipe({ transform: true })` in `main.ts`, and via the direct `plainToInstance()` call `ClientsImportService` makes for every Excel row — one fix normalizes both the manual-creation and the Excel-import paths to the same E.164 form. A value that fails to parse as a valid Colombian number is left unchanged (trimmed only); `@IsPhoneNumber('CO')` still rejects it, same as before.

Also added, same request: `onBlur` format validation on `ClientForm.tsx`'s `phoneNumber`/`alternatePhoneNumber` inputs, so a manually-typed bad format is flagged as soon as the user leaves the field instead of only at submit — this is a client-side regex check only, no additional request to the server.

## Reverted, 2026-09-06 — new-loan/refinance messages back to synchronous send

A same-day redesign (2026-09-05/06, undocumented here at the time) had briefly moved the "new loan"/refinance WhatsApp messages onto a scheduled sweep: a `ReminderFamily.NewLoan` cron job (`WhatsappCronService`, default weekly) called `NewLoanReminderService.runPendingLoanNotifications()`, which queried `loans` where `is_new_loan` is true and `new_loan_message_sent_at` is still null. Reverted the same day (confirmed with the human) after tracing a real gap it introduced: a historical/backfilled loan that slipped through with `isNewLoan` left `true` would only get caught — and wrongly message the client — whenever the sweep next ran, which could land well after `WHATSAPP_SENDING_PAUSED` (the admin's usual safeguard while backfilling) had already been lifted for legitimate traffic.

Back to how it worked before that redesign: `LoansService.create()`/`refinance()` call `NewLoanReminderService.sendNewLoanMessage()` synchronously right after persisting (wrapped in the same try/catch-and-log pattern as `PaymentConfirmationService`'s callers — a failed send never blocks the loan operation itself). `Loan.isNewLoan` still gates whether the send is even attempted (always `true` for `refinance()`, since a refinance can only ever apply to an already-active loan); a failed send is retried only via the existing manual `POST /message-logs/:id/retry`, same as any other failed message.

`ReminderFamily.NewLoan` and `NEW_LOAN_FAMILY_TYPES`'s use as a schedule-owning family are removed (`reminderFamily.ts`, `whatsappCron.service.ts`); the frontend's "Nuevo pagaré / Refinanciación" pause/schedule panel (`MessageTemplatesPage.tsx`) is removed with it. `NEW_LOAN_FAMILY_TYPES` itself stays as a plain `MessageType` grouping (used to describe each template's trigger, and by `LoanDetailPage.tsx` to filter a loan's own new-loan message from its log history) — it just isn't tied to a cron schedule anymore. `NEW_LOAN_REMINDER_CRON` (env var) is removed; `loans.new_loan_message_sent_at` stays as a pure audit trail (when the message last actually sent), no longer read by anything to decide whether to (re)send.

**One-time cleanup, 2026-09-18** (human report): during the brief window `LoanForm.tsx`'s "es un préstamo nuevo" checkbox was removed (between this revert and its restoration, see `Loan.isNewLoan`'s own comment), the form sent `isNewLoan: true` unconditionally for every loan typed in through it — historical/backfilled loans included. Any loan created in that window is stuck with the wrong value in the database even though the checkbox (and the correct `false` default) has been back since 2026-09-09. Migration `SetIsNewLoanFalseForExistingLoans` sets every currently-existing loan's `is_new_loan` to `false` unconditionally — confirmed with the human that every loan on file right now is old. A loan created after this migration runs is unaffected.

## Bug fix, 2026-09-07 — payment could exceed an installment's real remaining balance

Human report, with a screenshot: pagaré `#0920`, cuota of $850.000. A first payment of $800.000 was registered against it (real remaining balance: $50.000), then a second payment of the FULL $850.000 was accepted anyway, leaving the installment marked `paid` with `totalDue: 0` — the client had effectively been credited an extra $800.000 that was never actually owed.

Root cause: `enrichInstallment()`'s `totalDue` (`installment.amount + interest`, see the overdue-calculation formula above) never subtracted payments already registered against a `pending` installment — it always reported the installment's full nominal cost, regardless of how much had already been paid. `registerPayment()`/`registerBulkPayments()` in `installments.service.ts` only ever checked that a payment wasn't submitted *out of sequence* (Phase 32's "no pagar cuota 3 antes que la 2" rule) — nothing checked that a payment's `amountPaid` didn't exceed what was actually still owed on that specific cuota. Because `totalDue` fed directly into the register-payment dialog's displayed "Saldo", the cobrador saw (and was allowed to submit) a value far larger than the truth.

This single root cause turned out to affect every consumer of `enrichInstallment()`, not just the payment dialog: WhatsApp overdue reminders and the self-service menu ("Ver mis cuotas" / "Más información") kept telling a client who'd partially paid that they owed the FULL original amount; the Dashboard's "cuotas vencidas" total and overdue-client list overcounted by the same amount; the loans list's outstanding/overdue balance columns did too; and a client's `creditUsed`/`creditAvailable` (cupo) never credited a partial payment either.

**Fix, two parts:**

1. `enrichInstallment()` gained a 4th parameter, `totalPaid` (default `0`, backward compatible), subtracted from `totalDue` and clamped at 0 (`Math.max(0, amount + interest - totalPaid)`). Every call site that has a live installment (`installments.service.ts`, `loans.service.ts`, `clients.service.ts`, `dashboard.service.ts`, `whatsapp/reminderInstallmentQueries.ts`, `whatsapp/breakdownQueries.ts`) now fetches each installment's total paid-to-date via a new shared helper, `sumPaymentsByInstallmentId()` (`apps/api/src/loans/installments/paymentTotals.ts` — one batched query per list of installment ids, not N+1), and passes it through.

2. **New business rule, confirmed with the human:** `registerPayment()`/`registerBulkPayments()` now compute the installment's real live remaining balance (reusing `enrichInstallment()` itself, so the cap always matches what the dialog displays) and reject the payment with a `BadRequestException` if `amountPaid` exceeds it. A payment can no longer exceed a cuota's real remaining balance, full stop — this also means an installment already `paid`/`cancelled` (remaining balance 0) can no longer silently accept an extra payment, which reverses the specific edge case Phase 32 mentions in its own notes ("isn't skipping ahead of anything") for an already-settled cuota; that was undefined behavior before, not a confirmed rule, and is now explicitly rejected.

**Excess-payment handling — resolved 2026-09-14, see below.** The human originally confirmed rejecting the excess outright as the immediate fix, deferring what happens when a client hands over cash that physically exceeds what they owe. That question is now answered: see `client_credit_ledger_entries` further down.

**Side effect — the "saldo a favor" WhatsApp note was dormant, now fully reconnected:** `paymentConfirmation.service.ts`'s `overpaymentFor()`/`overpaymentAcrossInstallments()` and the `NotaAdicionalState.SaldoAFavor` template text existed specifically to tell a client "you paid more than this cuota" — reachable only when `totalPaid > installment.amount` after a registered payment, which stopped being possible once payments were hard-capped (this section, above). As of 2026-09-14 an overpayment is accepted again (routed into `client_credit_ledger_entries` instead of inflating the installment's own `Payment` row), and `PaymentConfirmationService`/`OverdueReminderService`/`UpcomingDueReminderService` now read the real ledger balance instead — see `client_credit_ledger_entries`'s own WhatsApp section below for how.

### `client_credit_ledger_entries`

Added 2026-09-14 (human report, préstamo #1170's investigation) — a payment exceeding what an installment owes is accepted again (see the bug fix above), but the excess is no longer folded into that installment's own `Payment.amount_paid` (which must never exceed what it truly owed, or every `totalDue`/remaining-balance calculation elsewhere would be corrupted). Instead it's tracked here as a client-level credit ("saldo a favor"), deliberately usable against **any** pending installment of **any** of the client's loans (confirmed with the human), not scoped to the loan/cuota it came from.

Append-only, same convention as `whatsapp_self_service_replies` — one row per credit event, never updated. A client's current available balance is `SUM(amount) WHERE type='created' − SUM(amount) WHERE type='applied'`, computed live (`ClientCreditBalanceService.getBalance`), not stored as a mutable running total.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `client_id` | UUID | FK → `clients.id`, `ON DELETE RESTRICT` — live financial state a cobrador/admin acts on, not a historical record that should go blank under a deleted client |
| `type` | ENUM (`created`, `applied`) | `created` = a payment's excess became credit; `applied` = credit was spent against a specific installment |
| `amount` | DECIMAL(12,2) | |
| `source_payment_id` | UUID, nullable | Set only for `created` — the (capped) `Payment` whose excess generated this credit. `ON DELETE RESTRICT`. |
| `resulting_payment_id` | UUID, nullable | Set only for `applied` — the real `Payment` row (`funded_by_credit = true`) the application created against the destination installment. `ON DELETE RESTRICT`. |
| `created_at` | TIMESTAMPTZ | |

**Generating credit is automatic, applying it never is — confirmed with the human, matching `docs/phases/PHASE_33_MESSAGE_TEMPLATES_V2.md`'s original requirement that netting a saldo a favor against a future cuota be an explicit operator action, never silent/automatic, for audit-trail reasons.** `InstallmentsService.registerPayment` caps the `Payment` row at what the installment actually owed and calls `ClientCreditBalanceService.recordExcess()` for any leftover — no user action needed beyond confirming the payment (the confirm dialog will need to disclose this, see the "not yet built" note below). Applying credit is `POST /installments/:id/apply-credit` (`{ clientId, amount }`) — `InstallmentsService.applyCreditToInstallment` validates via `ClientCreditBalanceService.assertCanApply` (amount positive, installment actually belongs to that client, amount doesn't exceed the available balance), then delegates the actual money movement to `registerPayment` itself (`fundedByCredit: true`) rather than duplicating its close/cascade/WhatsApp-confirmation logic. If the applied amount exceeds what that installment still needed, `registerPayment`'s own excess handling recycles the leftover right back into a fresh credit — the correct outcome, not a bug.

**Why `ClientCreditBalanceService` lives in `clients/`, not `loans/`:** a client's credit is usable against any of their loans, not scoped to one. `LoansModule` already imports `ClientsModule` (one-directional, pre-existing), so `InstallmentsService` injects `ClientCreditBalanceService` directly with no circular dependency — `ClientCreditBalanceService` itself never depends on `InstallmentsService` (it never creates a `Payment`; that responsibility stays entirely with `registerPayment`).

**`payments.funded_by_credit`** (added in the same migration, `AddClientCreditLedger1790700000000` — see its own 2026-09-15 comment on why it kept this name despite sharing a timestamp with `AddMetaMediaIdToWhatsappInboundMessages1790700000000`): `BOOLEAN NOT NULL DEFAULT false`. Set on the `Payment` `applyCreditToInstallment` creates, so the existing payment-history table can badge it as "vía saldo a favor" rather than a real cash collection, without needing its own separate view — it's a real `Payment` in every other respect (closes the installment, counts toward `totalPaid`, etc.).

**`apps/client` UI, built 2026-09-14:** `ClientCreditBanner.tsx` — a conditional banner (only rendered while the balance is > 0, same pattern as the existing "este préstamo fue refinanciado" banner) on `ClientDetailPage.tsx` and on `LoanDetailPage.tsx` for any of that client's loans, with an "Aplicar" button opening `ApplyClientCreditDialog.tsx`. On the client page the dialog shows a loan picker first (the credit isn't tied to one loan); on a loan page that loan is pre-selected. `RegisterPaymentDialog.tsx`'s confirm step already discloses the excess-becomes-credit case (see the frontend-fix note above it in this document). The loan detail's payment history table badges a credit-funded `Payment` ("Vía saldo a favor") using the new `funded_by_credit` column.

**WhatsApp messaging, reconnected 2026-09-14:** both template families now read `ClientCreditBalanceService.getBalance(clientId)` directly, replacing the narrow same-transaction math that (per the bug fix above) almost never triggers anymore.
- **Confirmations (templates 9-10, `paymentConfirmation.service.ts`):** `overpaymentFor`/`overpaymentAcrossInstallments` are gone — `sendPaymentConfirmation`/`sendPaidInFull` call `getBalance` directly for the client-wide figure.
- **Reminders (templates 4-8, `OverdueReminderService`/`UpcomingDueReminderService`'s `resolveNotaAdicional`):** `saldoPendiente.ts`'s per-installment gap is still checked first; only once that comes back empty is `getBalance` consulted for a `SaldoAFavor` note. Priority confirmed with the human: a client with BOTH a pendiente gap and an unclaimed favor balance at once sees the pendiente note, the more urgent of the two.
- **Alternate-contact carve-out, confirmed with the human:** a loan's `alternateContactPhoneNumber` scopes that message to just that one loan, but the ledger balance is client-wide (may come from a *different* loan). Any message routed to a contact instead of the client — a reminder's contact group, or a confirmation whose loan has the override set — always reports `Normal`, never the client's aggregate credit.

**Not built yet (separate follow-up piece, not in scope for this change):**
- `InstallmentsService.voidPayment`'s interaction with a payment that already generated (`sourcePaymentId`) or spent (`resultingPaymentId`) a credit — not decided yet.

**One consumer deliberately left out of scope:** `reminderInstallmentQueries.ts`'s `findUpcomingInstallmentsForClient()` (upcoming, not-yet-due installments) doesn't call `enrichInstallment()` at all and wasn't touched — a payment registered ahead of an installment's due date is a much rarer edge case than the overdue/pending ones this fix addresses, and doing so wasn't part of the confirmed scope.

**Subtlety — `interestSnapshot` on `message_log_items`:** `OverdueReminderService`/`UpcomingDueReminderService` used to derive `interestSnapshot` as `installment.totalDue - installment.amount`. Once `totalDue` started netting out `totalPaid`, that derivation would understate (or go negative for) a partially paid overdue installment's accrued interest. Fixed by adding an independent `interest` field to `reminderInstallmentQueries.ts`'s `OverdueInstallmentResult`, sourced directly from `enrichInstallment()`'s own `.interest` (computed before the `totalPaid` subtraction is applied), rather than re-deriving it from the now-adjusted `totalDue`.

**Known gap, flagged 2026-09-07 (found during code review of this fix, not yet fixed) — `LoansService.payoff()`/`getPayoffQuote()` ("Liquidar anticipadamente") bypass this entirely.** `calculatePayoff()` computes each pending installment's payoff cost from scratch (`amount` + interest, at face value, per the "Liquidación anticipada" formula) and never subtracts a payment already registered against that installment — unlike `enrichInstallment()`, it has no `totalPaid` parameter at all. `payoff()` then creates a new `Payment` row for that full, un-netted amount and saves it directly — it doesn't go through `registerPayment()`'s ceiling check either. Net effect: liquidating a loan that has even one partially-paid pending cuota re-charges that cuota's full cost on top of what was already collected — the same class of bug as `#0920`, through a code path this fix doesn't touch. `PayoffDialog.tsx` (frontend) has no protection against this either. Scoped out of this fix at the human's request pending a separate decision on how `calculatePayoff()` should account for existing payments.

## Bug fix, 2026-09-08 — closing an installment required only its capital, silently forgiving accrued mora

Human decision, made while reviewing the `#0920` fix above: `registerPayment()`/`registerBulkPayments()` marked a `pending` installment `paid` once accumulated payments reached `installment.amount` — capital only. This traces back to the literal wording of the original Phase 4 spec ("if accumulated payments cover the installment amount, mark it paid"), written before moratory interest was even a live, separately-tracked concept, and never revisited when Phase 23 introduced per-concept moratory charges. In practice this meant a cobrador could close any overdue cuota by collecting only its capital — every peso of accrued mora was silently forgiven, with no explicit decision, no audit trail, and no way to tell afterward that it had happened (a non-`pending` installment always reports `totalDue`/`interest`/`overdueDays` as `0` regardless of history — see `enrichInstallment()`'s non-Pending short-circuit above).

**Confirmed with the human:** closing a `pending` installment now requires covering its full live remaining balance — capital **and** accrued mora — computed the same way as the payment ceiling above (`InstallmentsService.resolveRemainingBalance`, reusing `enrichInstallment()`). `registerPayment()`'s post-save check changed from `totalPaid >= installment.amount` to `remainingBalanceAfter <= 0`. `registerBulkPayments()`'s floor check changed identically — a bulk entry must now match the installment's full remaining balance exactly (previously it only had to reach `installment.amount`), collapsing what were two separately-derived thresholds (floor from `amount`, ceiling from `totalDue`) into one.

This does not touch `Imputación del pago` (Art. 1653, "Liquidación anticipada" only, confirmed in Phase 16 as NOT extending to `registerPayment` — see `GLOSSARY.md`) — that rule is about the *order* interest and principal are paid off within a single early-payoff settlement. This change is about the *threshold* for closing an ordinary payment's installment at all, a question Phase 16 never actually addressed.

**Why this doesn't risk anatocismo (interest on interest):** mora is still always computed fresh each time directly from the installment's own unchanging `amount` (`amount × tasa/30 × overdueDays`, see the overdue-calculation formula above) — never from a "balance" that already includes previously accrued mora. An installment that stays `pending` longer because its mora hasn't been paid off simply keeps accruing more of the same daily mora on the same original capital, exactly as before; this change only affects when the installment is allowed to close, not how mora itself is calculated.

**Existing loans with mora already forgiven under the old rule are unaffected** — this only changes behavior for payments registered from now on. No backfill or reconciliation was proposed or requested for historical installments already closed under the old capital-only rule.

## Bug fix, 2026-09-08 — WhatsApp "saldo pendiente" note ignored accrued mora

Found while explaining the closing-rule change above to the human: `saldoPendiente.ts`'s `computeSaldoPendiente()` — which decides whether a reminder (Templates 4-8) appends "Cuenta con un saldo pendiente de $X por un abono incompleto" — derived that `$X` as `installment.amount - totalPaid`, never touching mora. Two consequences: (1) it always understated the real balance for a partially-paid overdue installment once any mora had accrued; (2) after the closing-rule fix directly above, it could fail to fire at all in the specific case a client's payments already cover `amount` exactly but leave mora outstanding — the cuota is still `pending` and the client still owes money, but `amount - totalPaid` computes to `0`.

Fixed by widening `InstallmentForSaldoPendiente` with an optional `totalDue` field: when present (every OVERDUE installment carries one already, from `findOverdueInstallmentsForClient()`'s own `enrichInstallment()` call — already net of payments and inclusive of accrued mora), it's used directly as the gap instead of re-deriving `amount - paid`. An UPCOMING (not-yet-due) installment still has no `totalDue` (see `findUpcomingInstallmentsForClient()`'s own out-of-scope note above) and falls back to the old `amount - paid` formula, which is fine there since nothing is overdue and mora is a non-issue. The gate stays "was there a nonzero payment at all" regardless of which formula computes the gap — an untouched overdue installment already owes its full `totalDue` via ordinary mora, and that's not what this note is for.

## Bug fix, 2026-09-08 — mora reported as $0 in WhatsApp, Dashboard and cupo for every current-generation loan

Found during a code review of the `#0920` payment-cap fix above, in a separate branch (`fix/mora-invisible-conceptos-vacios`) from the payment-cap/closing-rule/saldo-pendiente fixes documented above — an independent bug, not part of that same root cause.

`enrichInstallment()` defaults its `concepts` parameter to `[]` and, per its own doc comment, falls back to the legacy single-rate `interestRate` formula whenever `moratoryConcepts.length === 0`. That fallback was designed to be inert for any loan created since the Phase 23 redesign (#254): every such loan (`LoansService.create()`/`refinance()`, via `resolveConceptsWithInterest()`) always assigns at least one `LoanInstallmentConcept` row with `category: Moratorio` ("Intereses moratorios"), and the frontend (`LoanForm.tsx`/`RefinanceLoanForm.tsx`) sends `interestRate: 0` explicitly for every new/refinanced loan, with an explicit comment that this legacy field "never applies to a loan created through this form."

That assumption holds only if the caller actually fetches and passes the loan's real `LoanInstallmentConcept` rows. Four call sites instead hardcoded `concepts` to `[]` — from `enrichInstallment()`'s point of view this is indistinguishable from "this loan genuinely has no moratory concepts," so it took the legacy branch with `interestRate: 0` and computed **exactly $0 accrued mora**, regardless of how overdue the installment was:

- `whatsapp/reminderInstallmentQueries.ts`'s `findOverdueInstallmentsForClient()` — every WhatsApp overdue/upcoming reminder and the "saldo pendiente" note
- `whatsapp/breakdownQueries.ts`'s `toAccountSummaryInstallment()` — the self-service menu's "Ver mis cuotas" / "Estado de cuenta" / "Más información"
- `dashboard.service.ts`'s `gatherOverdueInstallments()` — the Dashboard's "cuotas vencidas" widget and each overdue client's `totalOverdueAmount`
- `clients.service.ts`'s `enrichActiveInstallments()` — `creditUsed`/`creditAvailable` (cupo) on `GET /clients/:id`, and the cupo guard `LoansService.create()` checks before allowing a new loan

The following call sites were already correct — they fetch each installment's real concepts via a batched query before calling `enrichInstallment()`, so this bug never affected them: `loans.service.ts`'s `summarize()`/`findOne()`/`payoff()`/`getPayoffQuote()`/`refinance()` (`GET /loans`, `GET /loans/:id`, and every `calculatePayoff()` call), and `installments.service.ts`'s `findAll()` and — critically — `resolveRemainingBalance()`, the function that actually enforces the payment ceiling on `registerPayment()`/`registerBulkPayments()`. `clients.service.ts`'s separate `enrichClientListItems()` (Clientes list's "Préstamos activos"/"En mora" columns) was checked too and is unaffected — it only reads `overdueDays`, never `totalDue`, so the legacy-formula fallback (which still computes `overdueDays` correctly regardless of interest) doesn't touch it.

**Net effect before this fix:** the amount actually enforced when collecting a payment was correct, but everything the client and admin could *see* about a current-generation loan's mora was not — WhatsApp always showed capital-only totals with zero mora, the Dashboard undercounted "cuotas vencidas," and a client's `creditAvailable` looked more generous than it really was.

**Fix:** extracted a shared `findConceptsByInstallmentId()` helper (`apps/api/src/loans/installments/conceptsByInstallmentId.ts`), mirroring `sumPaymentsByInstallmentId()`'s (`paymentTotals.ts`) existing batched-by-installmentId convention — one query per list of installment ids, not N+1. `loans.service.ts`/`installments.service.ts` keep their own pre-existing private copies of this same query unchanged (they were never the source of the bug); only the four broken call sites above were switched to fetch and pass real concepts through it. Each affected service/module gained a `LoanInstallmentConcept` repository injection (`clients.module.ts`, `dashboard.module.ts`, `whatsapp.module.ts`).

## Bug fix, 2026-09-08 — accrued mora paid off was reported as "saldo a favor" in the payment confirmation message

Human report from a Railway test send, found right after fixing the mora-invisible bug above: closed a $324.584 cuota (a $205.000 installment with $119.584 of accrued mora) with a single full payment, and the resulting `confirmacion_pago` WhatsApp message reported "Cuenta con un saldo a favor de $119.584" — the mora that was correctly owed and just collected, misreported as an overpayment credit.

Root cause: `paymentConfirmation.service.ts`'s `overpaymentFor()`/`overpaymentAcrossInstallments()` derived the overpayment as `totalPaid - installment.amount` — capital only, the same class of gap the `#0920` and "Cierre de cuota" fixes already closed elsewhere (see those sections above). Once the "Cierre de cuota" fix (this same date, above) started requiring a payment to cover capital **and** accrued mora before an installment can close, `totalPaid` legitimately exceeds `installment.amount` on every mora-bearing payment from now on — and this function had no way to tell that excess apart from a genuine overpayment.

Docs note this should have been caught by the `#0920` fix's own "Side effect — the 'saldo a favor' WhatsApp note is now dormant, correctly" claim (this document, above) — that reasoning assumed `overpaymentFor` compared against the installment's real `totalDue` (capital + mora), which was only true for `notaAdicional.ts`'s `saldoPendiente.ts` consumer, not for this one. `paymentConfirmation.service.ts` was never migrated onto that comparison; this is the gap that claim missed.

**Fix:** `overpaymentFor`/`overpaymentAcrossInstallments` now compare `totalPaid` against the installment's real total owed (capital + accrued mora), computed with the same `calculateOverdueDays`/`calculateInterest`/`calculateMoratoryCharges`/`calculateTotalDue` formulas `installments.service.ts`'s `resolveRemainingBalance` uses. Deliberately does NOT call `enrichInstallment()` directly: by the time `PaymentConfirmationService` runs, the installment has already been flipped to `Paid` (`installments.service.ts`), and `enrichInstallment()` short-circuits a non-Pending installment's `interest`/`totalDue` to `0` (see that function's own doc comment) — so the raw calculation functions are called directly instead, which only need `dueDate` and don't care about the installment's current status. `PaymentConfirmationService` gained a `LoanInstallmentConcept` repository injection, reusing the existing `findConceptsByInstallmentId()` helper from the fix above for the batched `sendPaidInFull` path. Verified with a unit test reproducing the exact reported numbers ($205.000 capital + $119.584 mora, paid $324.584 → no "saldo a favor").

## Bug fix, 2026-09-08 — mora was charged starting overdue day 1, not day 9 as the business actually requires

Human report: the self-service "Más información" breakdown showed a cuota due 7 days ago (`8️⃣ Cuota No. 9 por $208.348 venció hace 7 días`) already carrying $3.348 of mora on top of its real $205.000 amount, and a loan's detail-view Total column summed the same premature mora into its grand total.

Root cause: `docs/phases/PHASE_33_MESSAGE_TEMPLATES_V2.md`'s Template 6 note already stated the confirmed rule — "the business doesn't charge mora until day 9" — split into two Meta templates (`una_cuota_vencida` for días 1-8, `una_cuota_vencida_en_mora` from día 9) for exactly this reason. But that rule was only ever wired into `reminderTemplateSelection.ts`'s template-choice branch (`item.overdueDays > 8`), which decides *which message to send*, not into `installmentCalculations.ts`'s `calculateInterest`/`calculateMoratoryCharges`, which decide *how much mora is actually owed*. Those two functions had no grace-period gate at all — they charged mora proportional to `overdueDays` starting from day 1. The single-cuota "días 1-8" template happened to look correct only because that one call site (`reminderTemplateSelection.ts`) shows `item.amount` (capital only) instead of `item.totalDue` for that branch — but `totalDue`/`interest` themselves, read by every other consumer of `enrichInstallment()`/`calculatePayoff()` (the self-service breakdown for 2+ installments, a loan's Total column, the Dashboard's "cuotas vencidas" widget, cupo, and the payment ceiling/closing-rule check), already had the (wrong) day-1 mora baked in.

**Confirmed with the human:** once past the 8-day grace period, mora is calculated over the installment's FULL overdue days — day 9 is charged as 9 days of mora, not 1 (i.e. the grace period is a binary on/off gate, not a shifted starting point for the day count).

**Fix:** added `MORA_GRACE_PERIOD_DAYS = 8` to `installmentCalculations.ts`; `calculateInterest()` and `calculateMoratoryCharges()` now return `0` outright whenever `overdueDays <= MORA_GRACE_PERIOD_DAYS`, and apply the existing (unchanged) formula over the full `overdueDays` otherwise. Every consumer of these two functions — `enrichInstallment()` (and everything built on it: WhatsApp reminders/self-service menu, Dashboard, cupo, the payment ceiling) and `calculatePayoff()` — inherits the fix automatically, since none of them re-derive the formula themselves. `reminderTemplateSelection.ts`'s own `overdueDays > 8` check was switched to import and use the same `MORA_GRACE_PERIOD_DAYS` constant instead of a second hardcoded `8`, so the two can't drift apart again. `installments.due_date`/`overdueDays` itself (the "venció hace N días" figure quoted to clients) is unaffected — only the resulting mora *amount* changes.

## Operational toggle, 2026-09-08 — mora/cupo guard can be bypassed for the historical loan import

The business is backfilling historical pagarés into production. Phase 10's mora-block/cupo guard (`LoansService.assertClientCanTakeNewLoan`, checked by `create()` before persisting) was rejecting a client already carrying a >30-day-overdue installment from an earlier historical loan already imported in the same backfill — even though that "new" loan already happened in the real world and adds no actual new risk.

`LoansService.create()` already had a `skipCreditCheck` option scoped exactly for this ("modo histórico" — see that method's own doc comment), but it turned out to be aspirational: `LoanImportService.processRow()` never actually passed it, so every Excel-imported loan was still enforcing the guard. Fixed two things at once:

1. **The gap itself:** `LoanImportService` now passes `skipCreditCheck` through to `LoansService.create()` for every row.
2. **Made it a toggle, not a permanent bypass:** the value comes from a new `LOAN_IMPORT_SKIP_CREDIT_CHECK` env var (default `false`, see `docs/ENVIRONMENT_VARIABLES.md`) via a new `LoanImportConfig` group in `config/configuration.ts` — set it to `true` in Railway while the backfill is in progress, then back to `false` (or remove it) once done. No code change needed either way. Scoped to `LoanImportService` only: the interactive "Crear préstamo" form and its own guard are completely unaffected, so a collector still can't manually create a new real loan for a mora-blocked client during the backfill window. Logged once per import run (not per row) when enabled, so it's visible in Railway without being noisy.

**Superseded, 2026-09-09:** the whole toggle is gone — see "Changed, 2026-09-09" below. Mora no longer blocks loan creation anywhere, so there was nothing left to bypass.

## Bug fix, 2026-09-08 — a bulk payment's audit log entry didn't say which pagaré/cuotas it touched

Human report: `POST /installments/payments/bulk`'s audit log entry showed action "Registró un pago sobre varias cuotas" but no `entityLabel` at all — no way to tell which loan or installments a given bulk action actually paid.

Root cause: `AuditLogInterceptor.resolveEntityLabel`'s `'payment'` case only ever handled a single `Payment` response (`payment.register`'s shape) — it read `entity.amountPaid` directly, which is `undefined` on `payment.registerBulk`'s actual response (a `Payment[]` array), so the case fell straight through to `null`.

**Fix:** the `'payment'` case now checks `Array.isArray(entity)` first and, for a bulk response, builds a label summing the total amount across every payment in the batch plus a "cuota N del pagaré #X" fragment for each one (batched lookup — one query for every installment in the request, not N+1, same convention as `findConceptsByInstallmentId`/`sumPaymentsByInstallmentId`), e.g. *"Pago de $470.000 en 3 cuotas — cuota 4 del pagaré #0743, cuota 1 del pagaré #0810, cuota 2 del pagaré #0810"*. `payment.register`'s existing single-payment label is unchanged. No frontend change needed — `AuditLogsPage.tsx` already renders `entityLabel` verbatim.

## Added, 2026-09-08 — `clients.gender`

Client request: add "edad" and "sexo/género" to the client profile, in the interactive `ClientForm` and the Excel import alike, neither one mandatory. See `clients.gender` in the table above for the column itself.

"Edad" turned out not to need a column at all — `clients.date_of_birth` already existed since Phase 21, so age is computed from it on the frontend (`calculateAge` in `apps/client/src/lib/format.ts`) rather than stored redundantly. Shown next to "Fecha de nacimiento" on both `ClientForm.tsx` (live, as the date is picked) and `ClientDetailPage.tsx`.

`gender` itself: nullable `clients_gender_enum` (`masculino`/`femenino`/`otro`), added via `AddGenderToClients1789000000000`. Wired into `CreateClientDto` (optional, `@IsEnum`), `ClientForm.tsx` (an optional Select next to "Tipo de documento"), `ClientDetailPage.tsx`, and the clients-only Excel import (`clientsImportColumns.ts`'s `gender` column, aliases `sexo`/`genero`/`gender`, accepting `M`/`F`/`Otro` and a few English/Spanish variants — same `enumValues`-mapping pattern `documentType` already uses).

## Changed, 2026-09-08 — "cuota con interés" rounds to the nearest $100, not $1,000

Client request: `$1,000` rounded too aggressively on the smoothed installment total generated at loan creation/refinance (see `GLOSSARY.md`'s "Amortization method / Capital fijo" → "Cuota con interés" smoothing) — e.g. a true $345,400 cuota rounded down to $345,000, or $245,700 rounded up to $246,000. Narrowed to the nearest $100 instead (e.g. $135,456 → $135,500; $247,830 → $247,800), keeping the "round number" convenience of a flat identical cuota every installment while landing much closer to the real, unrounded figure.

Only one function implements this business rule server-side: `generateAmortizationSchedule()`'s `roundToNearestHundred()` (renamed from `roundToNearestThousand()`) in `apps/api/src/loans/amortization/generateSchedule.ts` — reused unchanged by loan creation, refinancing, and the preview-schedule/"Proyector rápido" quote endpoint, so all three picked up the change automatically. The only other place implementing this exact rounding was client-side only: `RefinanceLoanForm.tsx`'s own `roundToNearestHundred` (a display/pre-fill convenience for "Capital sugerido"/"Capital renegociado" when refinancing, never sent to the backend as-is — the admin can still hand-edit the field) — updated to match, so the two stay in sync. No other call site anywhere in either app implements a nearest-$1,000/$100 rounding rule.

## Changed, 2026-09-09 — mora grace period narrowed from 8 days to 6

Follow-up to "Bug fix, 2026-09-08 — mora was charged starting overdue day 1, not day 9 as the business actually requires" above. The client's first answer put the mora-free window at days 1-8 (mora starting day 9); once that fix shipped and the client saw it in a real WhatsApp message, they corrected it: **day 6 still has no mora, but day 7 already does.**

**Fix:** `installmentCalculations.ts`'s `MORA_GRACE_PERIOD_DAYS` changed from `8` to `6` — a one-line value change, since every consumer (`calculateInterest`, `calculateMoratoryCharges`, and everything built on them: `enrichInstallment()`, `calculatePayoff()`, WhatsApp reminders/self-service menu, the Dashboard, cupo, the payment ceiling, and `reminderTemplateSelection.ts`'s template-choice branch) already reads the constant rather than a hardcoded number. `docs/phases/PHASE_33_MESSAGE_TEMPLATES_V2.md`'s Template 6 doc updated to match (días 1-6 sin recargos / día 7+ con recargos) — no Meta resubmission needed, since neither approved template's body text hardcodes a day number.

Two test fixtures had hardcoded day-7 scenarios that assumed the OLD threshold (day 7 = still no mora) and would have silently passed the wrong behavior under the new one: `messageRenderer.spec.ts`'s recargos-flagging test (moved its "still in grace" fixture from day 7 to day 6) and `installmentCalculations.spec.ts`'s "full overdue days" test (recomputed its hand-checked expected amount for day 7 instead of the old day 9). Every other test referencing the grace period reads `MORA_GRACE_PERIOD_DAYS` dynamically and needed no numeric changes, only comment updates.

## Changed, 2026-09-09 — mora no longer blocks new-loan creation, only warns

Client decision — the most practical fix given that historical pagarés keep hitting this, and it would likely keep happening on new loans too: by the time a pagaré is actually being created, the negotiation, acceptance, and paperwork already happened, so a hard block at that exact step was the wrong place to catch it.

`LoansService.assertClientCanTakeNewLoan()` no longer checks mora at all — only cupo still rejects. `GET /clients/:id`'s `isMoraBlocked` is unchanged and still drives a red warning banner on `LoanForm.tsx`, it just no longer disables the form or the submit button. This also made the `LOAN_IMPORT_SKIP_CREDIT_CHECK` toggle (2026-09-08, see above) pointless — removed entirely, along with `LoansService.create()`'s `skipCreditCheck` option.

## Removed, 2026-09-09 — `loans.interest_rate` and the loan-only Excel import

Client decision, prompted by a display bug: the loan detail page's "Incremento en mora" card always showed 0% for any loan with real moratory concepts assigned (every current-generation loan), since it read `interest_rate` — the pre-Phase-23 legacy field — while the actual accrued mora came entirely from that loan's own `loan_installment_concepts` instead. Investigating whether it was safe to just delete the display bug's root field turned up two things:

1. **`interest_rate` was already structurally dead for every loan's real mora math, not just empirically unused.** `LoansService.resolveConceptsWithInterest()` — called unconditionally by both `create()` and `refinance()` — always builds a system-generated "Intereses moratorios" moratory concept (defaulting to the current usury ceiling if no rate is requested), so `enrichInstallment()`'s `moratoryConcepts.length === 0` fallback branch (the only place `interest_rate` was ever read) could never actually be reached through either loan-creation path. This was true before this change too — not something introduced by it.
2. **The one caller that *could* still reach that dead branch — the loan-only Excel import (`apps/api/src/loanImport`) — was itself confirmed unused.** It required a "Tasa moratoria (%)" column mapped straight to `interest_rate`, with no way to attach a real moratory concept, so an imported historical loan with no "cargo adicional" columns filled in would have hit the fallback. But the client confirmed the whole loan-only importer has no button or UI path to trigger it in `apps/client` at all (the original combined clients+loans importer was split in two on 2026-09-06 specifically because the client wanted to type loans in by hand after bulk-importing clients — see that date's note above) and was never going to be used. Removed outright rather than reworked: `apps/api/src/loanImport/` (controller, service, parser, columns, template, module, and their tests), its `AppModule` registration, and the `LOAN_COLUMNS`/template entry for `interestRate`. `apps/api/src/clientsImport` (the clients-only importer, actively used) is untouched. The audit log labels for `loanImport.execute`/`loanImport` (`apps/client/src/features/auditLogs/auditLogLabels.ts`) are kept, same precedent as `clientLoanImport.execute` from the 2026-09-06 split — purely so any historical audit row logged before this removal still translates instead of showing the raw action string.

With both of those confirmed, `interest_rate` was dropped entirely rather than just hidden:

- **Column dropped**: `1789200000000-DropInterestRateFromLoans.ts` (`ALTER TABLE "loans" DROP COLUMN "interest_rate"`). `Loan` entity, `CreateLoanDto`/`RefinanceLoanDto` no longer have the field; `LoanForm.tsx`/`RefinanceLoanForm.tsx` no longer send the `interestRate: 0` placeholder they used to.
- **The legacy fallback formula itself is gone**, not just its trigger condition: `enrichInstallment()` and `calculatePayoff()`/`calculateInstallmentPayoff()` no longer take an `interestRate` parameter at all — both always price moratory interest via `calculateMoratoryCharges()` against the installment's real `LoanInstallmentConcept` rows now, with zero concepts simply meaning zero mora (no separate branch needed, since `calculateMoratoryCharges([])` already returns `[]`). `installmentCalculations.ts`'s `calculateInterest()` (the single-rate formula) was deleted along with it — nothing else called it.
- Every call site that used to thread a loan's `interestRate` through to one of the two functions above (`LoansService`'s `summarize()`/`findOne()`/`getPayoffQuote()`/`payoff()`/`getRefinanceQuote()`, `InstallmentsService`'s `findAll()`/`resolveRemainingBalance()`, `ClientsService`'s `enrichActiveInstallments()`, `DashboardService`'s overdue-clients query, and the WhatsApp `breakdownQueries.ts`/`reminderInstallmentQueries.ts`/`paymentConfirmation.service.ts`) had that argument removed — none of them needed any other change, since the real moratory-concepts fetch these call sites already had (from the 2026-09-08 "concepts hardcoded to `[]`" fixes referenced throughout this document) was already the correct, complete input.
- The loan detail page's "Incremento en mora" `StatCard` (`LoanDetailPage.tsx`) was removed outright rather than reworked to show something else — the real per-concept rate is already shown as a tooltip on each moratory ("M"-tagged) column header in the cuotas table (`chargeHeaderTitle`), which is the right place for it since a loan can have more than one moratory concept and no single number can represent that.

## Added, 2026-09-09 — voiding/correcting a payment, and preventing the mistake at entry

Human report: a worker registered a payment as the cuota's full remaining balance when the client had actually only paid part of it, silently closing a cuota that should have stayed pending with a real balance owed. Root cause: `RegisterPaymentDialog.tsx`'s amount field used to pre-fill with the cuota's full balance (`Math.ceil(installment.totalDue)`) — a worker who received a partial payment but didn't think to edit the field before saving submitted a full payment instead. Three changes shipped together, all confirmed with the client:

**1. Stop pre-filling the amount.** The field now starts empty (`CurrencyInput` already treats `0` as empty); the cuota's real balance is shown just below it for reference only, no longer the value that gets silently submitted unedited.

**2. An explicit confirmation step before saving.** Both `RegisterPaymentDialog.tsx` and `BulkRegisterPaymentDialog.tsx` now show a second "Confirmar registro de pago" dialog summarizing exactly what the cuota will look like afterward ("PAGADA POR COMPLETA", or "con un saldo pendiente de $X") before anything is sent to the api — same two-step pattern `LoanForm.tsx`'s `ConfirmCreateLoanDialog` already used for creating/refinancing a loan. **The WhatsApp payment-confirmation send moved with it**: it was already tied synchronously to the register-payment API call succeeding (no backend change needed), so restructuring the frontend to defer that call until this dialog's own "Sí, registrar pago" button is what actually moved the send from the main form's old "Guardar" button to this confirmation step.

**3. `payments.void_reason`** (see the `payments` table above) — an admin-only "Anular pago" action, for when a wrong payment already made it through. Reuses the existing `deleted_at` soft-delete column rather than adding a new one: every existing query that sums or lists payments (`sumPayments`/`sumPaymentsByInstallmentId`, the WhatsApp breakdown/reminder/confirmation queries, the Dashboard) already excludes soft-deleted rows with zero code changes, since none of them pass `withDeleted: true`. Only `LoansService.getPayments()` (the loan detail's payment history) was changed to add `withDeleted: true`, so a voided payment stays visible there — shown crossed out, tagged "Anulado", with the reason as a tooltip — instead of silently vanishing.

- **Where it lives:** a button on each row of the loan detail's payment history, visible only to `user.role === 'admin'` (the strict admin check, not the module-based `canManageLoan` one — this is a financial correction tool, not general loan management).
- **What voiding does:** `PATCH /installments/payments/:id/void` (admin-only, `@Roles(UserRole.Admin)`) soft-deletes the payment and, **if that payment is what had closed its installment** (status was `Paid`), reopens the installment back to `Pending` — and the loan back to `Active` if it had cascaded to `Paid` — once the real remaining balance (recomputed net of the voided payment) comes out above 0. A `Cancelled` installment (superseded by a refinance) is left untouched; its debt already moved to the new loan. Wrapped in one transaction, same precedent as `registerBulkPayments()`.
  - Implementation note: `resolveRemainingBalance()`'s underlying `enrichInstallment()` always reports `totalDue: 0` for any installment not currently `Pending` (a paid/cancelled installment "owes nothing further" — see that function's own comment) — which would make the reopen check trivially always-false while the installment is still marked `Paid`. `voidPayment()` works around this by passing a `{ ...installment, status: Pending }` copy into that one call, so the real overdueDays/mora formula actually runs instead of short-circuiting to 0.
- **Reason is mandatory** — enforced by `VoidPaymentDto` (`@IsNotEmpty()`) and, redundantly, by the frontend dialog disabling its confirm button until something is typed.
- **Audit trail:** `@Audit('payment.void', 'payment')` logs the action; `AuditLogInterceptor`'s existing `'payment'` label builder (already shared with `payment.register`/`payment.registerBulk`) now checks the response's `deletedAt` and, when set, produces `"Pago de $X el <fecha> ANULADO — motivo: <reason>"` — still followed by the existing "— cuota N del pagaré #X" suffix that resolves the installment/loan, so an audit entry names exactly which cuota and which pagaré a void affected. `voidReason` falls back to "sin especificar" only if it's ever missing, which the mandatory-reason validation above should make unreachable in practice.

**Bulk payments were deliberately left as a single-step save**, not given the same two-step confirmation dialog content-wise — `registerBulkPayments()` requires every entry to fully settle its installment (no partial case exists there, per Phase 28), so there's no "PAGADA COMPLETA vs. saldo pendiente" branch to summarize; its own confirmation dialog instead just recaps the entry count and total before sending, with the same WhatsApp-send disclaimer. Voiding a payment that was part of a bulk batch works exactly the same as voiding any other single payment — the batch has no shared record beyond the individual `Payment` rows it created.

## Bug fix, 2026-09-14 — a cuota could get stuck "$1 pendiente" even after paying the exact amount shown

Human report, préstamo #1170: a worker registered a payment for exactly the amount `RegisterPaymentDialog` showed as the cuota's balance, and the confirmation summary still said it would leave "un saldo pendiente de $1". Root cause: `calculateMoratoryCharges`'s percentage formula (see `GLOSSARY.md` → "Interest / Interés") is a raw division chain that almost never lands on a whole peso (e.g. `$34,58`) — but every other figure in this app, including what `CurrencyInput` even lets someone type, is whole pesos only. A cuota whose `totalDue` carried that leftover fraction could never actually be zeroed out by a whole-peso payment.

**Fix**, confirmed with the human across two decisions (which rounding rule, and where to apply it — both asked via clarifying question rather than guessed, since this changes an actual money calculation):

1. Each moratory concept's own `amount` (`calculateMoratoryCharges`, `installmentCalculations.ts`) now rounds to the nearest whole peso via `Math.round`.
2. `calculateTotalDue` (installment amount + total interest) rounds the combined figure to the nearest **$100** — reusing `roundToNearestHundred`, moved here from `generateSchedule.ts` (both now import the one copy) so the live mora recalculation and the schedule smoothed at loan creation ("Changed, 2026-09-08" above) use the exact same rule.

**Confirmed tradeoff:** a small accrued mora (under $50) can round away to $0 rather than being charged — the human explicitly chose this over rounding to the nearest peso instead (which would never erase mora, at the cost of less "round" numbers), the same tradeoff the original cuota-smoothing feature already made at a larger scale.

**Test fixtures updated, not just added:** `installmentCalculations.spec.ts` had a `calculateTotalDue` block explicitly marked "verified against real spreadsheet data, do not modify without re-verifying" — its fixtures asserted the *unrounded* combined total (e.g. `520000 + 503360 = 1023360`). The human confirmed rounding inside `calculateTotalDue` itself (not just one layer up, in `enrichInstallment`) was the intended fix, so those fixtures were updated to the new nearest-$100 expectations rather than left describing behavior that no longer exists. `clients.service.spec.ts`'s `getCreditUsage` mora test also needed its fixture amounts bumped from a toy `300` scale to a realistic loan scale, since `303` rounding to `300` would have silently erased the entire effect that test exists to check for.

**Nothing changed in `apps/client`** — `RegisterPaymentDialog.tsx`/`BulkRegisterPaymentDialog.tsx`'s own `Math.ceil(installment.totalDue)` calls were the original symptom, but `totalDue` is now always an exact multiple of $100 by construction, so `Math.ceil` on it is a no-op — no frontend change needed.

## Feature, 2026-09-15 — downloadable Excel report of overdue installments

Human request: the client used to build this by hand from their paper records. `GET /clients/reports/overdue-installments` (`apps/api/src/overdueInstallmentsReport/`, its own module so it can import `DashboardModule` without adding a new dependency onto it from `ClientsModule`) streams an `.xlsx` file, one row per overdue installment — never aggregated by client, unlike `GET /dashboard/overdue-clients`.

**Bug fix, 2026-09-15 (human report — clicking the button crashed with `invalid input syntax for type uuid`):** first shipped as `GET /clients/overdue-installments-report`. `ClientsController` already has `GET /clients/:id`, and Nest/Express match routes in registration order, not by specificity — that one-segment literal path collided with `:id` (matched as though "id" were literally the string `"overdue-installments-report"`, crashing `ClientsService`'s UUID lookup). Nested under an extra `reports` segment instead of reordering module imports to "win" the race, which would only be one future merge away from silently breaking the same way again — two segments after `/clients/` can never match the single-segment `:id` pattern, regardless of controller registration order.

No new schema: `DashboardService.getOverdueInstallmentDetails()` (a thin public wrapper around the already-private `gatherOverdueInstallments()` used by `getSummary`/`getOverdueClients`) exposes the same fetch with the additional per-installment fields (`clientDocumentNumber`, `clientPhoneNumber`, `promissoryNoteNumber`, `alternateContactPhoneNumber`, `installmentNumber`, `dueDate`, `amount`, `interest`) those two never needed — so this report can never drift from what the Dashboard itself already counts as overdue.

**Sort order, confirmed with the human:** by pagaré (numeric-aware — a plain text sort would put `"#101"` before `"#2"`), then by cuota number as a tiebreaker — matching how the client tracked this manually before, not by urgency. `extractNumericPart`/`comparePromissoryNoteNumbers` were extracted from `loans.service.ts` (unchanged behavior, same bigint-based null-handling) into `apps/api/src/loans/promissoryNoteNumberSort.ts` so both the "Préstamos" list and this report share the identical comparator.

**Formatting, confirmed with the human** (their own client is described as a slow learner — the sheet needed to read as plainly as possible): a plain-language summary sentence (date generated, cuota count, total overdue amount) on row 1, header frozen through row 3 so it and the summary stay visible while scrolling, currency columns as real formatted numbers (`"$"#,##0`) rather than pre-formatted text, and a cuota 30+ days overdue highlighted in red — reusing the existing "mora block" threshold (`GLOSSARY.md` → "Cupo (credit limit)") rather than an unrelated number invented just for this.

Gated the same way `clientsImport`'s downloads are (`@RequireModule(AppModule.Clients)`) since the button lives on the Clientes page — not Dashboard, which has no module gate at all (see `AppModule`'s own comment on why).

## Feature, 2026-09-15 — front-desk "estado de cuenta" on the client profile

Human request: when a client walks into the office, the front desk needs to say "your pagaré #X owes cuota N for $Y" right away — they didn't want to open the messages module and read the client's last WhatsApp reminder, which goes stale the moment a same-day payment is registered.

`GET /clients/:id/account-status` (`ClientsService.getAccountStatus`) reuses `findOverdueInstallmentsForClient`/`findUpcomingInstallmentsForClient` (`apps/api/src/whatsapp/reminderInstallmentQueries.ts`) directly — the exact same queries `OverdueReminderService`/`UpcomingDueReminderService` already build their WhatsApp reminders from — so this view can never disagree with what the client was already told. No new schema, no new calculation.

**"Próxima a vencer" window, confirmed with the human:** the same admin-configurable `cron.upcomingDueReminderDays` the reminders themselves use (default 5 days), not a separately-invented number — showing every future installment would bury what actually matters today under cuotas that aren't due for months. `overdue` has no such cutoff — any installment past its due date shows, regardless of how overdue.

**Why this lives in `ClientsService`, importing from `whatsapp/`:** these are plain functions (no `@Injectable()`, no module-level DI), so importing them into `clients/` doesn't create a circular NestJS module dependency even though `WhatsappModule` separately imports `ClientsModule` — Nest's cycle detection is about `@Module()`/provider graphs, not a file importing a stateless helper from another domain folder.

**`apps/client` UI:** `ClientAccountStatusPanel.tsx`, rendered at the top of `ClientDetailPage.tsx` (above `ClientCreditBanner`) — unlike that banner, which hides entirely when there's nothing to show, this panel always renders, including a plain "Al día" message when both lists are empty: a front-desk lookup needs a clear "nothing pending" answer just as much as a list of what's owed.

## Related documents

- `GLOSSARY.md` — definitions of `pagaré`, `cuota`, `mora`, `refinanciación`, and other terms used above
- `ARCHITECTURE.md` — how these entities map to NestJS modules
