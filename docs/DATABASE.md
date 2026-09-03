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
│ role            │       │ phone_number     │          │ interest_rate             │  │
│ created_at      │       │ created_at       │          │ disbursed_at              │  │
│ updated_at      │       │ updated_at       │          │ installment_frequency     │  │
│ deleted_at      │       │ deleted_at       │          │ total_installments        │  │
└─────────────────┘       └──────────────────┘          │ status                    │  │
                                                          │ refinanced_from_loan_id   │  │
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
| `created_at`, `updated_at`, `deleted_at` | TIMESTAMPTZ | standard |

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
| `phone_number` | VARCHAR | E.164 format, e.g. `+573001234567` |
| `credit_limit` | DECIMAL(12,2), nullable | maximum credit exposure ("cupo") enforced at loan creation. Nullable — unset means no cupo is enforced for this client, same "absence of a value means the rule doesn't apply" convention as `loans.description`. Added Phase 10, see "Changed after Phase 10" below. |
| `document_type` | ENUM (`cedula_ciudadania`, `cedula_extranjeria`, `pasaporte`), nullable | Added Phase 21. As of Phase 26, `loans.co_debtor_document_type` (which shared this enum) is gone — a co-debtor is now a `Client` reference, so their `document_type` is read from this same column. |
| `date_of_birth` | DATE, nullable | Added Phase 21. |
| `document_issue_place` | VARCHAR, nullable | Added Phase 21. |
| `document_issue_date` | DATE, nullable | Added Phase 21 (client feedback after reviewing the built form — `document_issue_place` already existed, the date didn't). |
| `email` | VARCHAR, nullable | Added Phase 21. |
| `alternate_phone_number` | VARCHAR, nullable | Added Phase 21. |
| `home_address` | TEXT, nullable | Added Phase 21. As of Phase 26, at least one of `home_address`/`work_address` is enforced (rejected if both are missing/empty) in `ClientsService.create()` for interactively-created clients — see "Added/changed in Phase 26" below. |
| `work_address` | TEXT, nullable | Added Phase 21. Same either/or requirement as `home_address` above, as of Phase 26. |
| `neighborhood` | VARCHAR, nullable | Added Phase 21. |
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
| `promissory_note_number` | VARCHAR | **the business-facing identifier** — this is the `#743`, `#959` etc. seen in client messages and spreadsheets. Not the same as `id`. Must be unique and searchable. |
| `principal_amount` | DECIMAL(12,2) | total amount financed (`TOTAL` / `SALDO TOTAL` in the source sheets) |
| `interest_rate` | DECIMAL(5,2) | percentage, **moratory-only as of Phase 14** — see note below |
| `disbursed_at` | DATE | when the loan was given (`FECHA INICIAL`) |
| `installment_frequency` | ENUM (`monthly`, `biweekly`) | source data shows `MENSUAL` consistently; enum leaves room for other frequencies if they come up |
| `total_installments` | INT | total number of installments the loan is divided into (`CUOTAS`) |
| `status` | ENUM (`active`, `paid`, `refinanced`) | see `GLOSSARY.md` — **no `overdue` status at the loan level**, since overdue is an installment-level concept (see below) |
| `refinanced_from_loan_id` | UUID, nullable | self-referencing FK → `loans.id`. Set when this loan was created to replace an older one. See "Refinancing" below. |
| `description` | TEXT, nullable | free-text concept/reason for the loan (e.g. "Compra de Apple MacBook Air M5..."), used by the "new loan" WhatsApp message — see `docs/phases/PHASE_9_MESSAGE_TYPES.md`. Optional, same precedent as `payments.observation`. |
| `new_loan_message_sent_at` | TIMESTAMPTZ, nullable | Added Phase 18 — set once the "new loan" WhatsApp message actually succeeds (synchronously at creation/refinance, or via the retry cron). Lets the `new_loan` cron find loans still needing their message directly (`IS NULL`), instead of string-matching message content. See `docs/phases/PHASE_18_MESSAGE_AUDIENCES.md`. |
| `co_debtor_client_id` | UUID, nullable | Added Phase 26, replacing the flat `co_debtor_*` columns Phase 21 originally added (see "Added/changed in Phase 26" below). FK → `clients.id`, `ON DELETE RESTRICT` — same convention as `client_id` above; clients are only ever soft-deleted in this project, so `RESTRICT` never actually blocks a normal delete. A co-debtor is functionally just another client of the business — confirmed with the business ("codeudor al final es otro cliente") — so it's picked from existing clients rather than typed inline. At most one per loan. Validated in `LoansService.assertCoDebtorIsValid()`: must differ from this loan's own `client_id`, and must reference an existing, active (non-soft-deleted) client. |
| `co_debtor_relationship` | VARCHAR, nullable | Added Phase 21, kept standalone on `Loan` through the Phase 26 refactor — relación con el deudor principal is a property of this specific loan, not of the co-debtor client themselves (the same client could be "hermano" on one loan and "socio" as co-debtor on another). Free text. |
| `initial_payment` | DECIMAL(12,2), nullable | Added Phase 13 (corrected after client QA) — the "cuota inicial": a down payment the client already made **outside** the credit system to cover the part of the purchase this loan doesn't finance. Purely informational — not one of this loan's installments, has no due date, accrues no interest, and never affects `principal_amount` or the amortization schedule. See `docs/phases/PHASE_13_INITIAL_INSTALLMENT.md`. |
| `created_at`, `updated_at`, `deleted_at` | TIMESTAMPTZ | standard |

**On the co-debtor and refinancing:** `LoansService.refinance()` carries the old loan's co-debtor over to the new loan unchanged by default when `coDebtorClientId`/`coDebtorRelationship` are **omitted** from the refinance dto — the refinance dto's co-debtor fields are optional and only override what's explicitly sent, so refinancing doesn't silently drop an existing co-debtor. Sending either field as an explicit `null` (as opposed to omitting it) deliberately clears the co-debtor on the new loan instead of carrying it over — added as a QoL fix (2026-08-30) after the frontend's "tiene codeudor" checkbox turned out to have no effect when unchecked, since omitting and explicitly-clearing were previously indistinguishable at the `??` fallback used here. The carried-over (or overridden, or cleared) `coDebtorClientId` is re-validated by `assertCoDebtorIsValid()` the same as on creation. See `docs/phases/PHASE_21_CLIENT_PROFILE.md` and `docs/phases/PHASE_26_CODEBTOR_CLIENT.md`.

**On `interest_rate`:** confirmed from real data that the rate is **not** automatically tiered by amount, despite an informal rule mentioned by the client ("6% under 1 million, 5% over"). Actual historical data shows loans of the same amount range with rates of 4%, 5%, and 6%. The safest interpretation — **pending final confirmation with the client** — is that the rate is set manually per loan at creation time, defaulting to whatever the current standard rate is, but editable. Do not hardcode an automatic tiering rule based on this early analysis.

**Changed after Phase 14:** `interest_rate` is no longer used to price new loans — a loan's actual cost is now expressed entirely through named concepts (see `interest_concept_types` / `loan_installment_concepts` below). The column was not removed or renamed: it is kept, unchanged in shape, as the base rate `installmentCalculations.ts` uses for moratory (mora) interest on overdue installments — the open question above about how this rate is assigned/changes over time is still unresolved, just now scoped specifically to its moratory role rather than to ordinary loan pricing.

**Superseded after Phase 23:** `interest_rate` is now only the *fallback* moratory formula, used exclusively for a loan with zero `moratorio`-category concepts assigned (every loan created before this phase, and any new loan the admin doesn't attach moratory concepts to). Once a loan has at least one moratory concept, `interest_rate` plays no role in its numbers at all — moratory interest is priced entirely through that loan's own `loan_installment_concepts` rows instead, computed live on read. The column is still not removed — dropping it would break every loan still on the fallback path. See `docs/phases/PHASE_23_DYNAMIC_CHARGES.md`.

**Renamed after Phase 31:** `interest_rate`'s UI label changed from "Tasa de interés" to "Incremento consolidado en caso de mora" (client users were misreading it as a charge separate from the mora ceiling, not the ceiling itself). Copy-only — the column, its shape, and its formula are unchanged. See `docs/phases/PHASE_31_LOAN_TERMINOLOGY.md`.

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
| `created_at`, `updated_at`, `deleted_at` | TIMESTAMPTZ | standard |

~~`is_initial` BOOLEAN~~ — added in Phase 13, **removed after client QA** (2026-08-18): a cuota inicial is not one of the loan's installments at all (see `loans.initial_payment` above). Migration `ReplaceIsInitialWithInitialPayment`.

**Overdue calculation (confirmed formula):**

```typescript
overdueDays = today > installment.dueDate
  ? differenceInDays(today, installment.dueDate)
  : 0;

interest = installment.amount * (loan.interestRate / 100) / 30 * overdueDays;

totalDueForInstallment = installment.amount + interest;
```

This matches the manual calculations found across both source spreadsheets — verified against multiple real examples.

### `payments`

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `installment_id` | UUID | FK → `installments.id` — **payments are tracked per installment**, not per loan, allowing partial payments against a specific cuota |
| `amount_paid` | DECIMAL(12,2) | |
| `paid_at` | DATE | |
| `observation` | TEXT | nullable — the source data has many free-text notes like "pagó en el local", "recibió en el Bordo" |
| `image_url` | VARCHAR, nullable | Added Phase 12. **Deprecated as of Phase 28** — a payment can now carry more than one receipt photo, tracked in `payment_images` below. Kept (not dropped) as a read-only fallback for any row created before Phase 28's migration backfilled it into `payment_images`; new payments no longer write to this column. |
| `created_at`, `updated_at`, `deleted_at` | TIMESTAMPTZ | standard |

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
| `default_value` | DECIMAL(12,2), nullable | a suggested starting value, always overridable per installment |
| `category` | ENUM (`corriente`, `moratorio`), default `corriente` | Added Phase 23 — which side of the concept engine this type belongs to. `corriente` concepts price a loan's ordinary cost at generation time, unchanged since Phase 14. `moratorio` concepts only apply once an installment is overdue, computed live on read (never projected at generation time — future overdue days can't be known in advance). The default keeps every pre-Phase-23 row `corriente`, matching what it already implicitly was; no moratory concepts are pre-seeded — the admin creates his own, the same way as corriente ones. See `docs/phases/PHASE_23_DYNAMIC_CHARGES.md`. |
| `fixed_amount_distribution` | ENUM (`split_across_installments`, `first_installment_only`), nullable | Added Phase 23 — required (enforced at the DTO layer, "no silent default") when `default_calculation_type` is `fixed_amount` and `category` is `corriente`; meaningless (left `NULL`) for a `percentage` concept or for a `moratorio` fixed-amount concept, which is always charged once, flat, the moment an installment goes overdue. |
| `is_active` | BOOLEAN, default `true` | deactivating removes the type from the picker for new loans without touching `loan_installment_concepts` rows already generated from it — those snapshot their own name/value, unaffected by later catalog edits |
| `created_at`, `updated_at`, `deleted_at` | TIMESTAMPTZ | standard |

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
| `value` | DECIMAL(12,2) | snapshotted — the % or flat figure actually used for this installment |
| `computed_amount` | DECIMAL(12,2) | For a `corriente` row: the resulting currency amount this concept contributed to this installment, calculated once at generation time against the balance at that point, then stored — the schedule doesn't change with the passage of time the way mora does. For a `moratorio` row (Phase 23): always `0` — the row only records that the concept is assigned to the loan; the real charge is computed live on read once the installment is overdue (see `installments.dueDate` / mora formula below), never stored. |
| `created_at`, `updated_at`, `deleted_at` | TIMESTAMPTZ | standard |

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

One row per reminder **actually sent to a client** — not per installment.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `client_id` | UUID | FK → `clients.id` |
| `type` | ENUM — widened after Phase 33 to the union of the old 4 values and the new 13, since this table is append-only history: existing rows keep whichever value they already had, only new rows use the 13-value catalog | which message flow produced this log |
| `phone_number` | VARCHAR | snapshot at send time |
| `message_content` | TEXT | Phase 33 — for a Template Message send, this is the ordered list of body parameters joined for reference (the actual WhatsApp body text is Meta's, assembled from `meta_template_name` + these parameters, not stored verbatim here) |
| `status` | ENUM (`sent`, `failed`) | |
| `sent_at` | TIMESTAMPTZ | |
| `retried_at` | TIMESTAMPTZ, nullable | Added Phase 18 — set on the ORIGINAL (failed) row once it's manually retried. Still append-only: this is a stamp on the historical row, not an edit of what was actually sent. |
| `retry_of_message_log_id` | UUID, nullable | Added Phase 18 — self-referencing FK → `message_logs.id`, `ON DELETE SET NULL`. Set on the NEW row created by a retry, pointing back at the original it retried. Both columns null on rows never retried; a retry that itself fails can be retried again, chaining further. |
| `created_at` | TIMESTAMPTZ | append-only, no `updated_at`/`deleted_at` |

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
| `entity_label` | VARCHAR, nullable | a human-readable snapshot of that specific record — `"Juana Pérez (CC 1234567890)"`, `"Pagaré #743"`, `"Pago de $150.000 el 2026-08-18"` — resolved once at write time (see `AuditLogInterceptor.resolveEntityLabel`) and frozen, not re-derived from the live record on read; the record may have since changed or been soft-deleted. Added Phase 11 follow-up — client feedback: `entity_type` alone ("Cliente") said which module an action happened in but not which specific record, which stopped being usable once there were hundreds of clients. `null` when no labeling rule exists yet for that `entity_type`. |
| `metadata` | JSONB, nullable | the request's route params and body at the time of the action; known-sensitive fields (`password`, `passwordHash`, etc.) are redacted to `[redacted]` before this is ever written — never stored in the clear |
| `created_at` | TIMESTAMPTZ | append-only, no `updated_at`/`deleted_at` — an audit trail that can itself be edited or deleted defeats its purpose |

Written by `AuditLogInterceptor`, registered globally (`APP_INTERCEPTOR`) but a no-op for any endpoint not decorated with `@Audit(action, entityType)` — read-only routes, auth, health checks, etc. produce no entry. A failed request (a thrown exception) never produces a log entry either; a failed *write* to `audit_logs` itself is logged and swallowed rather than failing the real request it was trying to record.

### `usury_rates`

Added Phase 15 — Colombia's legal usury ceiling, certified monthly by the Superintendencia Financiera. See `docs/phases/PHASE_15_USURY_RATE.md`.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `effective_month` | DATE, **UNIQUE** | first day of the certified month (e.g. `2026-08-01`). Unique because a month's rate is never edited — a correction is a new row for a different month, not an update. |
| `rate_percentage` | DECIMAL(5,2) | the month's certified ceiling |
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
| `type` | ENUM (`button`, `text`, `other`) | `button` covers both a template's quick-reply tap (Meta's `type: "button"` payload shape) and a session interactive `button_reply` (`type: "interactive"`) — both normalize to the same row shape here. `other` is anything not yet handled (e.g. a sticker), kept rather than dropped. |
| `button_payload` | VARCHAR, nullable | the button's `payload`/`id`, only set when `type = 'button'` |
| `body_text` | TEXT, nullable | the message body for `text`, or the button's display text for `button` |
| `raw_payload` | JSONB | the full webhook POST body, for debugging/replay |
| `received_at` | TIMESTAMPTZ | from Meta's own `timestamp` field on the message; falls back to server time if that's missing/malformed |
| `created_at` | TIMESTAMPTZ | append-only, no `updated_at`/`deleted_at` — same convention as `message_logs` |

**Phone number matching:** Meta sends the sender's number without a leading `+` (e.g. `573001234567`); `clients.phone_number` is stored E.164 with one (e.g. `+573001234567`). `client_id` is resolved by prepending `+` when absent, then matching against `clients.phone_number` exactly — see `normalizeIncomingPhoneNumber` in `apps/api/src/whatsapp/webhook/`.

**What's not yet built:** whether an inbound signal (e.g. a "No") persists as a standing client preference — still open, see `docs/phases/PHASE_22_WHATSAPP_WEBHOOK.md`. The button-flow/"menu" catalog and automated handling of unprompted free text are now built — see `whatsapp_conversation_states` below and `docs/phases/PHASE_34_INTERACTIVE_MENU.md`.

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

## Refinancing

When a loan is refinanced:

1. The old loan's `status` is set to `refinanced`.
2. A new loan row is created with `refinanced_from_loan_id` pointing to the old loan's `id`.
3. The new loan gets its own `promissory_note_number`, `principal_amount` (typically the old balance + accrued interest), and its own set of `installments`.
4. The old loan's remaining pending installments, if any, have their `status` set to `cancelled` — a distinct status confirmed with the client, kept as historical record but excluded from overdue calculations, reminders, and dashboard totals (the same way `paid` installments are: `enrichInstallment` returns zero overdue days/interest/total due for both).

This mirrors patterns seen directly in the source data (e.g. `REFINANCIADO #981`, `SE REFINANCIO EN EL #1000`).

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
- `loans.promissory_note_number` — looked up constantly, must be fast and unique
- `clients.document_number` — for search and duplicate prevention
- `clients.phone_number` — for search and WhatsApp matching
- `installments.due_date` and `installments.status` — the weekly CronJob queries heavily on both
- `audit_logs (entity_type, entity_id)` and `audit_logs (actor_user_id, created_at)` — back "show me the history for this record" and "show me what this user did, most recent first", the two filters the audit log screen supports (see `docs/phasesClient/PHASE_11_AUDIT_LOG.md`)
- `client_references.client_id` — every lookup is "give me this client's references"

## Open questions — confirm with client before finalizing

- [ ] Exact rule (if any) for how `interest_rate` is determined or changes over time

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

## Related documents

- `GLOSSARY.md` — definitions of `pagaré`, `cuota`, `mora`, `refinanciación`, and other terms used above
- `ARCHITECTURE.md` — how these entities map to NestJS modules
