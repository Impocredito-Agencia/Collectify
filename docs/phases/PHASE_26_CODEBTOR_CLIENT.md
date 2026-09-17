# Phase 26 — Co-debtor as a Linked Client, Required Client Fields

## Goal

Two bundles requested by the client in the same meeting, merged into one phase — both touch the client-creation flow:

1. Replace `Loan`'s flat `co_debtor_*` columns (Phase 21) with a proper relationship to an existing `Client` record — a co-debtor is, functionally, another client of the business, and should be searchable/reusable as one instead of re-typed by hand on every loan.
2. Make `document_number` (cédula) and at least one address field required when a client is created interactively — today both are nullable/optional at the application level, unlike `dataProcessingConsent`/`documentType`, which Phase 21 already enforces as required on this same flow. Originally tracked as its own phase (formerly Phase 33 — Required Client Fields); merged into this phase at the human's request. Independent of the co-debtor work above — this applies to every interactively-created client, including one being created specifically to attach as a co-debtor.

## Resolved — confirmed directly with the human (reunión 2026-08-25)

Co-debtor:
- **Codeudor = another client:** "codeudor que sea como crear otro cliente porque codeudor al final es otro cliente."
- **Client must exist first:** "primero hay que crear un cliente antes de ponerlo como codeudor" — a loan's co-debtor is picked from existing clients (create-then-attach), not entered inline as free text at loan creation the way Phase 21 built it.

Required client fields:
- **Cédula obligatorio.**
- **Direcciones obligatorias, mínimo una** — at least one of `home_address`/`work_address` must be present; not both required.

## Open questions — resolved (2026-08-30)

These applied only to the co-debtor half of this phase — the required-fields half had none.

- [x] **What happens to loans that already have `co_debtor_*` data filled in under the Phase 21 model?** Resolved: no data migration needed. "Aun no sacamos la app entonces esos prestamos con codeudor no existen, solo borra lo que sea innecesario" — the app hadn't shipped yet, so no loan had ever been created with co-debtor data filled in. The old columns were dropped outright via migration, no backfill.
- [x] **Can the same client be a co-debtor on more than one loan, or even be both a primary debtor and a co-debtor at once?** Resolved: "No puede ser deudor y codeudor a la vez, pero si puede ser codeudor de mas de un prestamo." A client cannot be both debtor and co-debtor on the same loan (enforced in `LoansService.assertCoDebtorIsValid()`), but can be co-debtor on any number of different loans (no uniqueness constraint on `coDebtorClientId`).
- [x] Does a co-debtor client need any of Phase 21's KYC fields to be complete before being attachable? Resolved: no gate. "Desde que tenga los campos obligatorios requeridos, no creo que haya problema" — any existing, active client is eligible regardless of KYC profile completeness.

Also confirmed: `coDebtorRelationship` stays on `Loan` as a standalone free-text column rather than moving to `Client` — it describes this specific loan's relationship, not a property of the co-debtor themselves.

An additional instruction was given alongside these answers, expanding the required-fields half's scope: the cédula + at-least-one-address rules must also be enforced and documented as required in the Excel import template (column hints), not just on interactive client creation — see the "Required client fields" scope section below.

## Required reading before starting

`docs/phases/PHASE_21_CLIENT_PROFILE.md` (the `co_debtor_*` columns this phase replaces, and the existing required-field precedent — `dataProcessingConsent`/`documentType` — the required-fields half of this phase follows), `docs/DATABASE.md` (`loans`, `clients`), `docs/GLOSSARY.md` ("Codeudor / Co-debtor").

## Scope

### Co-debtor

#### Entities and migrations
- [x] `Loan.coDebtorClientId` (UUID, nullable) — FK → `clients.id`, `ON DELETE RESTRICT` (clients are only ever soft-deleted in this project, so `RESTRICT` never blocks a normal delete — same convention as `client_id`).
- [x] Migration `1785700000000-ReplaceCoDebtorFieldsWithClientLink.ts` (drops the 7 old `co_debtor_*` columns, adds `co_debtor_client_id` + `co_debtor_relationship`, adds the FK + index; `down()` reverses fully).
- [x] Retired `co_debtor_full_name`, `co_debtor_document_type`, `co_debtor_document_number`, `co_debtor_phone_number`, `co_debtor_address`, `co_debtor_id_document_url` outright — no backfill needed, confirmed no loan had real co-debtor data pre-launch.
- [x] `co_debtor_relationship` kept standalone on `Loan` (confirmed: describes the specific loan's relationship, not a property of the co-debtor client).

#### Service and API
- [x] `POST /loans` / `POST /loans/:id/refinance` / `PATCH /loans/:id`: accept `coDebtorClientId` + `coDebtorRelationship` instead of the flat co-debtor fields; validated by `LoansService.assertCoDebtorIsValid()` (must differ from the loan's own `clientId`, must reference an existing, active client).
- [x] `LoansService.refinance()`'s existing "carry the old loan's co-debtor over by default" behavior (`docs/DATABASE.md` "On the co-debtor and refinancing") is preserved, now carrying `coDebtorClientId`/`coDebtorRelationship` instead of the flat fields.
- [x] Loan detail response includes the co-debtor's client summary (`coDebtorClient`, resolved via `ClientsService.findByIdIncludingDeleted()`), not snapshotted flat columns.

#### Tests (mandatory)
- [x] A loan can be created with an existing client as co-debtor; the relation resolves correctly on read.
- [x] A loan can be created/refinanced/updated with no co-debtor at all (unaffected, matching Phase 21's "at most one, optional" rule).
- [x] Refinancing carries the co-debtor relation forward by default, same as the flat-column behavior it replaces, and can be overridden field-by-field.
- [x] Rejects a client set as both debtor and co-debtor on the same loan, and rejects a `coDebtorClientId` that doesn't reference an existing, active client — on create, refinance, and update.
- [x] No dedicated data-migration test needed — resolved as "nothing to migrate" (see "Open questions" above).

#### Swagger
- [x] `POST /loans`/`POST /loans/:id/refinance`/`PATCH /loans/:id` DTOs and loan detail response updated.

### Required client fields

#### Service and API
- [x] `ClientsService.create()`: reject (matching the existing pattern used for `dataProcessingConsent`/`documentType`) when `documentNumber` is missing/empty, or when both `homeAddress` and `workAddress` are missing/empty — application-level validation, not a DB `NOT NULL` constraint. Applies to every interactive `POST /clients` call, including one made to create a co-debtor.
- [x] **Excel-imported clients are NOT exempt from these two rules** — this deliberately breaks from the Phase 21 `dataProcessingConsent`/`documentType` exemption precedent, per explicit instruction from the business. `ClientLoanImportService` already routes every row through `ClientsService.create()`, so the same rejection applies there too, surfaced as a per-row import error rather than a parser-level check. The Excel template (`clientLoanImportTemplate.ts`) documents `homeAddress`/`workAddress` as conditionally required ("Obligatorio si no llenas...") in its column hints; `documentNumber` was already a required column.

#### Tests (mandatory)
- [x] `POST /clients` rejects a request missing `documentNumber`.
- [x] `POST /clients` rejects a request with both address fields empty, and accepts one with at least one populated.
- [x] Excel import correctly surfaces the new rejection as a per-row error (not exempt, unlike Phase 21's two fields).

#### Swagger
- [x] `POST /clients` DTO/description updated to note both new requirements and their non-exemption for bulk import.

## Definition of done for this phase

- [x] A loan's co-debtor is an existing `Client`, referenced by id at the API/data layer (`coDebtorClientId`) and selected via a search/select picker in `LoanForm.tsx`/`RefinanceLoanForm.tsx` — see `docs/phasesClient/PHASE_26_CODEBTOR_CLIENT.md` for the client-side details.
- [x] Existing loans' co-debtor data is handled exactly per the confirmed answer to the data-migration open question (nothing to migrate) — not silently dropped.
- [x] A client cannot be created interactively without a cédula and at least one address, including when created to serve as a co-debtor.
- [x] Excel-imported clients are NOT exempt from the two new required-field rules (deliberate departure from the Phase 21 precedent, confirmed with the business).
- [x] All items in `docs/DEFINITION_OF_DONE.md` checklist pass. Confirmed, 2026-09-15 (this line had been left unchecked since the phase shipped via PR #66 — re-verified now rather than trusting the merge alone): `apps/api` — `npm run lint`, `npm run build`, and every co-debtor-touching spec (`loans.service`, `upcomingDueReminder`, `newLoanReminder`, `dashboard.service`, `overdueReminder`) all pass, 185 tests. `apps/client` — `npm run lint`, `npm run build`, `npm run test` all pass, 38 tests.

## QoL follow-up (2026-08-30) — resolved

Three quality-of-life items requested after the initial co-debtor picker landed:

- [x] Exclude the loan's own client from the co-debtor search results (`LoanForm.tsx`/`RefinanceLoanForm.tsx`) — see `docs/phasesClient/PHASE_26_CODEBTOR_CLIENT.md`.
- [x] Fix `RefinanceLoanForm`'s "tiene codeudor" checkbox having no effect when unchecked: `LoansService.refinance()` now distinguishes an omitted `coDebtorClientId`/`coDebtorRelationship` (carry over) from an explicit `null` (clear) instead of using `??`, which couldn't tell the two apart. `RefinanceLoanDto` widened to `string | null`. Covered by `'clears the co-debtor when the dto explicitly sets both fields to null'` in `loans.service.spec.ts`. See `docs/DATABASE.md`'s "On the co-debtor and refinancing" note.
- [x] Auto-refresh the co-debtor search results when the admin returns from creating a client in a new tab — client-side only, via `useClients()`'s new `refetchOnWindowFocus`/`staleTime` options. See `docs/phasesClient/PHASE_26_CODEBTOR_CLIENT.md`.

## After this phase

`docs/DATABASE.md`'s `loans` and `clients` table sections, `docs/GLOSSARY.md`'s "Codeudor / Co-debtor" entry, and `docs/phases/PHASE_21_CLIENT_PROFILE.md`'s "Mandatory vs. optional" decision log have all been updated to describe the linked-client model and the two additional required-at-creation fields.

## Related documents

- `docs/phases/PHASE_21_CLIENT_PROFILE.md` — the flat co-debtor columns this phase replaces, and the required-field precedent the second half of this phase follows
- `docs/phases/PHASE_8_EXCEL_IMPORT.md` — confirmed unaffected by the required-fields half
- `docs/phasesClient/PHASE_26_CODEBTOR_CLIENT.md` — the client-side half of this bundle
- `docs/DATABASE.md`, `docs/GLOSSARY.md`
