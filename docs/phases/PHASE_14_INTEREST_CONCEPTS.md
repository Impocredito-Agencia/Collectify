# Phase 14 — Configurable Interest Concepts (Amortizador)

> **Superseded 2026-09-04:** the "cuota fija" (level-payment/French) correction described below under "Scope decisions" was itself reversed after the human compared the app's output against the client's real, actively-used Excel loan calculator and confirmed (via direct question, not a guess) that the business actually lends using **capital fijo** ("German"-style: constant principal per installment, interest on the declining balance, so the total shrinks each period) — not a level total payment. The French/cuota-fija reasoning below is kept for history, per this project's convention, but does not reflect current behavior. See `apps/api/src/loans/amortization/generateSchedule.ts`'s own comment for the current algorithm.

## Goal

Today a loan has exactly one `interest_rate` field, used exclusively to calculate moratory interest on overdue installments — there is no "ordinary" interest charged on principal at all, and installment amounts are hand-entered totals with no capital/interest split. Colombian law caps how much can legally be charged and labeled as interest (see `docs/phases/PHASE_15_USURY_RATE.md`), so in practice lending businesses charge part of the cost of the loan under other named concepts (e.g. "gastos de cobranza", administrative fees) rather than as a single interest percentage. This phase replaces manual installment-amount entry with a real amortization schedule: the admin defines the principal, term, and a set of interest/fee concepts (picked from an admin-managed, extensible catalog — not a fixed list), and the system computes every installment's amount, split into capital and each concept's contribution, on a declining balance.

## ⚠️ Size warning — read before scoping implementation work

This is confirmed as the largest phase in this batch — the human confirmed the system must generate the full amortization schedule automatically, on a declining balance, with concepts that can vary installment-to-installment. This is a real amortization engine, replacing `docs/phases/PHASE_4_LOANS_INSTALLMENTS.md`'s original decision that "there is no automatic even-split; the caller provides one amount per installment." **Treat this as reopening that decision, not new scope in isolation** — the same courtesy given to Phase 17's reopening of Phase 6. Given the confirmed size, still consider splitting the implementation into two PRs (data model + catalog CRUD first, generation algorithm second) even though the scope itself is no longer ambiguous.

## Resolved — confirmed directly with the human

The open questions this phase originally carried are now resolved. Recorded here (not silently deleted) so a future reader can see what was decided and why, matching the project's convention for this kind of ambiguous financial rule:

- ~~Is a "concepto" a percentage on some base, a fixed fee, or both?~~ → **Confirmed: percentage-type concepts are calculated on the outstanding balance at the start of each installment period** (declining balance, not a one-time calculation on the original principal). Fixed-amount concepts are a flat figure per installment, unaffected by balance.
- ~~Does this introduce ordinary/remuneratory interest on principal?~~ → **Confirmed: yes.** This is genuinely new — the system has only ever charged moratory interest before this phase.
- ~~Are installment amounts still hand-entered, or does the system compute them?~~ → **Confirmed: the system computes them.** The admin no longer types a total per installment — they define principal, term, frequency, and concepts, and the schedule is generated. This directly reopens `docs/phases/PHASE_4_LOANS_INSTALLMENTS.md`'s "no automatic even-split" decision.
- ~~Are concepts identical across every installment, or can they vary?~~ → **Originally confirmed they could vary — reversed after client QA (2026-08-18, see the cuota fija correction below): concepts are now fixed for the whole term of a loan**, set once at creation. Per-installment concept overrides were removed once the business requirement turned out to be a level (equal) total payment per installment, which isn't well-defined if concepts vary period to period.
- ~~How do existing loans migrate?~~ → **Not applicable — nothing is in production yet**, confirmed directly by the human. No backward-compatibility or backfill work is needed; this phase can assume a clean slate.
- ~~Can an admin edit/deactivate a concept type already used on existing loans — snapshot or live?~~ → **Confirmed: snapshot.** A loan's installments keep the concept name/value they were generated with, even if the catalog entry is later edited or deactivated. Deactivating a type only removes it from the picker for *new* loans.
- ~~Does the client want a global, admin-editable catalog of reusable concept types, or pure per-loan free text?~~ → **Confirmed: a global catalog** (`InterestConceptType`) — the admin manages it centrally and each loan selects from it at creation, value overridable per loan (not per installment — see the cuota fija correction below). This is what shipped (see Scope below), superseding the earlier per-loan free-text sketch some drafts of this document carried.

## Open question — resolved, quote/simulator tool built (2026-08-18)

~~Quote/simulator persistence (client, "Amortizador de financiamiento" meeting follow-up): should a generated quote... be persisted as its own record, or is it a pure live calculator with no database footprint?~~ → **Confirmed with the human: a quote is never persisted — only once a credit is actually created does anything get saved.** ("Si es solo cotización no se debe guardar, si es una vez creado el crédito entonces sí.") No `LoanQuote` entity, no new table.

No new endpoint was added either — `POST /loans/preview-schedule` (already built alongside the amortization engine itself, before this question was even resolved) already satisfies every requirement the "Quote / simulator tool" section below asked for: no `clientId`/`promissoryNoteNumber`, nothing persisted, and it **is** the identical code path `LoansService.create()` uses, so a quoted number can never drift from what a real loan would produce. Reusing it — rather than adding a second endpoint that would compute the exact same thing — is what actually satisfies "must reuse the identical calculation code path," not just adjacent to it. The client-side "Cotizador" screen (`docs/phasesClient/PHASE_14_INTEREST_CONCEPTS.md`) calls this endpoint directly.

## Scope decisions — read before implementing

- **Concept types are admin-managed and dynamic, not a fixed/hardcoded list.** The admin must be able to create new kinds of interest/fee concepts at any time (e.g. add a "Seguro" concept next year without a code change). Implemented as a small admin-managed catalog (`InterestConceptType`), not free text — a catalog keeps names consistent across loans (needed for future reporting like "total gastos de cobranza cobrados este mes") while still letting the admin add a brand-new type inline at loan-creation time.
- ~~Principal is amortized in even installments (linear/"German"-style), not a level total payment ("French"-style).~~ → **Corrected after client QA (2026-08-18): the business needs level (equal) total payments.** Confirmed directly with the human: every installment's total must be identical (cuota fija), with interest front-loaded and capital back-loaded internally — the standard French/annuity amortization. This also resolved the concepts-can-vary-per-installment question in the other direction from what was originally scoped below: **concepts are now fixed for the whole term of a loan, set once at creation** — this is what makes a level payment well-defined at all. Per-installment concept overrides (`installmentConceptOverrides`/`LoanConceptAssignmentDto` overrides, `InstallmentConceptOverrideDto`) were removed entirely, not left as dead functionality. All percentage-type concepts are combined into a single per-period rate and solved for with the standard annuity formula (`corePayment = P × r / (1 − (1+r)⁻ⁿ)`); fixed-amount concepts are added on top of that level core payment. See `apps/api/src/loans/amortization/generateSchedule.ts` for the implementation and `generateSchedule.spec.ts` for the worked example. The original reasoning below is kept for history.

- ~~Original (superseded) reasoning:~~ Principal was originally amortized in even installments (linear/"German"-style), not a level total payment, because concepts could vary installment-to-installment — solving for a level total payment across a varying concept set isn't well-defined in general. This concern no longer applies now that concepts are fixed per loan.

## Market research — completed (client requested, not a substitute for confirming the above)

The client asked us to look at how Sistecrédito and Addi name these concepts, "para acuñar los mismos términos." Findings, informational only:

- **Addi** (closest comparable — Colombian fintech, small/short-term consumer credit) publishes an actual rate sheet with three cost buckets: **"Tasa de interés"** (remuneratory, varies by risk profile), **"Respaldo (fianza)"** — a guarantee/backing fee paid to a third-party guarantee fund, charged as a percentage + IVA of the purchase amount, payable diluted across installments — and **"Gastos de cobranza"**, an explicit tiered percentage of overdue capital that increases with days overdue (10-30, 31-60, 61-90, 91-120 días), each tier with its own min/max peso caps, charged from day 10 of mora. Source: [Addi — Tasas y tarifas](https://co.addi.com/tasas-tarifas).
- **Sistecrédito** charges a monthly interest rate plus an **"Aval"** (guarantee) fee plus IVA, both scaled to the client's risk profile — and is legally required to disclose, before the client accepts, the "tasa de interés remuneratoria," "tasa de interés moratoria," "tasa máxima legal vigente," "valores o cargos adicionales," "garantías, avales o servicios accesorios," and "gastos de cobranza" as distinct line items. Source: [Sistecrédito — Información para el consumidor](https://www.sistecredito.com/informacion-para-el-consumidor/).
- Broader Colombian consumer-credit market terminology (credit cards, via Bold's educational content): **"cuota de manejo"** (recurring account/handling fee), **"seguros asociados"** (bundled insurance — life, unemployment, purchase protection), **"comisión por estudio de crédito"** (one-time application/underwriting fee). Source: [Bold — Costos de las tarjetas de crédito en Colombia](https://bold.co/academia/educacion-financiera/tarjetas-de-credito-en-colombia-costos-y-tarifas-asociadas).

**Suggested initial catalog** (pending the client's actual go-ahead on which to use, and on the catalog question above) — mapping the client's own proposed concepts to closer market-standard naming where one exists:

| Client's term | Closer market equivalent (optional swap) | Notes |
|---|---|---|
| Gastos de cobranza | Same term — this is already the standard name (Addi uses it verbatim, with an explicit tiered-by-mora-days structure worth mirroring) | Confirm if a flat % or Addi-style tiered-by-days structure is wanted — the latter is more work (ties into per-installment mora days) |
| Uso de plataforma | "Cuota de manejo" is the closer market-recognized term for a recurring platform/account fee | Client's own phrasing may poll better with their specific customer base — this is a suggestion, not a requirement |
| Comisión de pagos virtuales | Matches "comisión" terminology used broadly (e.g. comisión por estudio de crédito) | No direct market equivalent for this exact concept — client's phrasing is already clear |
| Mensajería express personalizada de notificación | No market equivalent found — appears specific to this business | Keep as-is |
| (not yet proposed by client) | "Respaldo" / "Aval" — a guarantee fee, used by both Addi and Sistecrédito | Worth asking the client if they want an equivalent concept, since it's standard in this exact market segment |

## Required reading before starting

`docs/GLOSSARY.md`, `docs/DATABASE.md` (interest rate open question — this phase resolves it), `docs/phases/PHASE_4_LOANS_INSTALLMENTS.md` (the installment-generation decision this phase reopens).

## Scope

### Entities and migrations
- [x] `InterestConceptType` entity (the admin-managed catalog, built): `id`, `name` (VARCHAR — e.g. "Interés remuneratorio", "Gastos de cobranza"), `default_calculation_type` (enum: `percentage` | `fixed_amount`), `default_value` (DECIMAL, nullable — a suggested starting value, always overridable per installment), `is_active` (BOOLEAN), timestamps + soft delete. **Admin-managed catalog** — CRUD via `/interest-concept-types`, admin only, mirroring the CRUD-ability `MessageTemplatesController` used to have before Phase 9 made it static (this is the opposite case: these concepts must stay freely editable, since the client's explicit ask is to never need a code change to add/rename/reprice one).
- [x] `LoanInstallmentConcept` entity (per installment, not per loan, since concepts can vary installment-to-installment — confirmed, see resolved question above): `id`, `installment_id` (FK → `installments`), `interest_concept_type_id` (FK → `interest_concept_types`, nullable via `SET NULL` so deleting a catalog entry never touches historical installments), `name_snapshot` (VARCHAR, copied from the type at generation time), `calculation_type` (enum, snapshotted), `value` (DECIMAL, snapshotted — the % or flat figure used), `computed_amount` (DECIMAL — the actual currency amount this concept contributed to this installment, calculated once at generation time against the balance at that point, then stored — installment schedules don't change with the passage of time the way mora does).
- [x] `Installment`: added `principal_portion` (DECIMAL, nullable — the capital-only part of this installment's total `amount`). This is what `docs/phases/PHASE_16_EARLY_PAYOFF.md` and `docs/phases/PHASE_17_REFINANCING_RECALC.md` need to compute "interest caused vs. principal remaining."
- [x] Migrations: `CreateInterestConceptTypesTable`, `CreateLoanInstallmentConceptsTable`, `AddPrincipalPortionToInstallments`.
- [x] `Loan.interest_rate` is no longer used for new loans created after this phase — new loans express their entire cost through concepts instead. It was not removed from the schema; it is now moratory-only (kept as the base rate `installmentCalculations.ts` uses for overdue installments).
- [ ] Still open, deferred to `docs/phases/PHASE_15_USURY_RATE.md` scoping: whether moratory interest keeps using `Loan.interest_rate` as its own independent mechanism (current behavior, unchanged by this phase) or should instead derive from one of the loan's own concepts — flag this explicitly when scoping Phase 15, don't silently duplicate a rate.

### Concept type management (admin catalog)
- [ ] `InterestConceptTypesService`: `create()`, `findAll()` (active types, for the loan-creation picker), `update()`, `deactivate()` — admin only.
- [ ] `POST /api/v1/interest-concept-types`, `GET /api/v1/interest-concept-types`, `PATCH /api/v1/interest-concept-types/:id`, `PATCH /api/v1/interest-concept-types/:id/deactivate` — admin only.

### Amortization generation
- [ ] `loans/amortization/generateSchedule.ts` — pure function, sibling to `installmentCalculations.ts`, unit-tested the same way as `installmentCalculations.spec.ts`. Input: `principalAmount`, `totalInstallments`, `installmentFrequency`, `firstInstallmentDueDate`, and a per-installment list of concept assignments (`{ conceptTypeId, calculationType, value }[]` for each installment index — defaulting to the same set for every installment unless the admin overrides specific ones). Algorithm:
  1. `principalPortion = principalAmount / totalInstallments`, with any rounding remainder absorbed into the **last** installment (mirrors how `assertInstallmentAmountsMatchPrincipal` already tolerates a small delta today).
  2. `runningBalance = principalAmount`.
  3. For each installment `i` from 1 to N, in order:
     - For each of installment `i`'s assigned concepts: if `percentage`, `computedAmount = runningBalance × (value / 100)`; if `fixed_amount`, `computedAmount = value`.
     - `installment.amount = principalPortion (or remaining balance on the last installment) + sum(computedAmount across this installment's concepts)`.
     - Store the `LoanInstallmentConcept` rows for this installment with their snapshotted values.
     - `runningBalance -= principalPortion` (this is the balance the *next* installment's percentage concepts apply to).
- [ ] `LoansService.create()` / `refinance()`: replace the current `installmentAmounts[]` input with `{ principalAmount, totalInstallments, installmentFrequency, firstInstallmentDueDate, installmentConcepts }`, call `generateSchedule()`, persist the resulting installments and their concepts.

### Reporting
- [x] `GET /api/v1/loans/:id` and `GET /api/v1/installments`: each installment response includes `principalPortion` and `conceptBreakdown: { name, amount }[]` (from the stored `LoanInstallmentConcept` rows — no need to recalculate, they were computed once at generation time).

### Quote / simulator tool ("amortizador proyector" — confirmed in scope, client meeting follow-up)
The client's actual use case, in their own words: a prospect walks into the office asking "how much would I pay if I borrowed $X over Y months," and the person helping them needs to turn the screen around and show a clear, large breakdown on the spot — **before** any `Loan` record exists.
- [x] ~~`POST /api/v1/loans/quote` (or similar...)`~~ → **built as a reuse of the existing `POST /api/v1/loans/preview-schedule` instead of a new endpoint** (2026-08-18) — see "Open question... resolved" above for why a second endpoint would have undermined the "identical calculation code path" requirement rather than satisfied it.
- [x] ~~If open question 7 resolves to "persist it"...~~ → resolved to "pure calculator" (see above) — no `LoanQuote` entity, no new table.

### Tests (mandatory)
- [x] `generateSchedule()`: single concept flat across all installments (balance declines correctly, sums to principal exactly); concepts that vary per installment; a mix of percentage and fixed-amount concepts; rounding remainder lands on the last installment; a single-installment loan.
- [x] `InterestConceptTypesService`: create/update/deactivate; a deactivated type no longer appears in `findAll()` but existing `LoanInstallmentConcept` rows referencing it are unaffected (snapshot behavior).
- [x] `LoansService.create()`/`refinance()`: generated installments' `principalPortion` values sum exactly to `principalAmount`.
- [x] `conceptBreakdown` sums correctly to the installment's total.
- [x] Existing loans without concepts continue to work exactly as before (backward compatibility — `LoanInstallmentConcept` rows are optional per installment).
- [x] A loan's stored concept values never change when the `InterestConceptType` catalog is edited afterward — confirms the snapshot behavior above is actually enforced, not just assumed.
- [x] ~~Not yet applicable — deferred until the quote/simulator tool is built...~~ → satisfied by construction, not by a new test: the quote screen calls `POST /loans/preview-schedule` directly, the exact same endpoint/code path `previewSchedule.controller.spec` and `LoansService.create()` already exercise — there is no second implementation that could drift.

### Swagger
- [ ] New entities, DTOs, catalog endpoints, and the updated loan-creation payload documented, including a clear explanation of the amortization algorithm in the description.

## Definition of done for this phase

- [x] An admin can create a new interest/fee concept type at any time, without a code change or deployment.
- [x] A loan can be created by specifying principal, term, and concepts — the system generates every installment's amount, with its capital/concept breakdown, automatically.
- [x] The exact breakdown of what a client owes, by concept, is retrievable per installment without recalculating anything.
- [x] **Confirmed (client, "Amortizador de financiamiento" note, part B):** once a loan is created, its concepts' names/types/values are frozen — editing the `InterestConceptType` catalog afterward never retroactively changes an already-created loan's numbers. This is the natural consequence of `LoanInstallmentConcept` storing its own snapshotted values rather than a live reference to the catalog row, and is covered by a dedicated test (see above).
- [x] An admin (or collector — confirmed with the human this isn't admin-only, since it touches no client data and persists nothing) can generate an on-the-spot quote for a prospective client ("Amortizador de financiamiento" note, part A) without creating a `Loan` record, with math guaranteed to exactly match what a real loan would produce — the "Cotizador" screen, calling the existing `POST /loans/preview-schedule`. See `docs/phasesClient/PHASE_14_INTEREST_CONCEPTS.md`.
- [x] The confirmed answers to every "Before starting" question are implemented exactly as agreed — not guessed.
- All items in `docs/DEFINITION_OF_DONE.md` checklist pass.

## After this phase

Update `docs/DATABASE.md` (new `interest_concept_types`, `loan_installment_concepts` tables, `installments.principal_portion` column, and resolve the `interest_rate` open question — note it's superseded by concepts for loans created after this phase, and now moratory-only) and `docs/GLOSSARY.md` (add "Interest concept type / Tipo de concepto de interés" and "Interest concept / Concepto de interés"; update "Interest rate / Tasa de mora" to reflect that ordinary interest is now concept-based). Also update `docs/phases/PHASE_4_LOANS_INSTALLMENTS.md`'s own text to note its "no automatic even-split" decision was superseded here, so the two documents don't silently contradict each other. ~~Still pending (blocked on the quote/simulator persistence question above, not yet actioned)~~ — resolved (2026-08-18): the quote tool needed no new table (pure calculator, no persistence — see above), so there is nothing further to add here beyond this note.

## Important cross-reference — Phase 15 must validate the total, not just "interés"

The client's own stated reason for wanting configurable concepts is to avoid charging everything under the single label "interés," which would otherwise breach `docs/phases/PHASE_15_USURY_RATE.md`'s legal ceiling. This means Phase 15's open question #2 ("does the ceiling validate only the nominal interest concepts, or the effective total cost including moratory interest and any fixed fees?") is no longer a neutral toggle — if Phase 15 ends up validating only a field literally named "interés," the usury-ceiling check becomes meaningless by construction, since it would never see the concepts specifically designed to sit outside that label. Whoever confirms Phase 15's open questions with the client should confirm this explicitly, and be told this isn't a minor implementation detail — it determines whether the ceiling check does anything at all. Not legal advice; if there's any doubt about whether structuring charges this way is itself compliant, that's a question for the client's own legal/financial advisor, not something to infer from this codebase.

## Related documents

- `docs/phases/PHASE_4_LOANS_INSTALLMENTS.md` — the installment-generation decision this phase supersedes
- `docs/phases/PHASE_15_USURY_RATE.md` — the legal ceiling this phase's concepts must be validated against (see cross-reference above)
- `docs/phases/PHASE_16_EARLY_PAYOFF.md`, `docs/phases/PHASE_17_REFINANCING_RECALC.md` — both consume `principal_portion` introduced here
- `docs/DATABASE.md` — open question on `interest_rate` this phase resolves
