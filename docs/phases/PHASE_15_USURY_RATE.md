# Phase 15 — Usury Rate Ceiling (Tasa de Usura Global)

## Goal

Track Colombia's legal usury ceiling as a global, month-to-month value, and apply it automatically to moratory interest calculations instead of leaving `interest_rate` as an unchecked per-loan number with no relationship to what's actually legal.

## Domain research (informational — not a substitute for legal confirmation)

- Colombia's usury rate ("tasa de usura") is calculated as **1.5× the "Interés Bancario Corriente" (IBC)**, certified **monthly** by the Superintendencia Financiera de Colombia. It is a single national ceiling, not per-institution or per-product. Charging above it is a criminal offense under the Colombian Penal Code.
- Because it's certified monthly and changes (e.g. it moved from ~24% to ~29% effective annual rate across different months in past cycles), it cannot be hardcoded — it must be an admin-editable, dated value, which is exactly what the user asked for ("que se pueda actualizar mes a mes").
- There is no official free API for this value as of this research — the realistic implementation is an admin manually entering the new month's certified rate, not automated scraping.
- **Publication timing is not a fixed calendar day.** Confirmed directly from the SFC's own resolution (e.g. August 2026's Resolución 1139 was published July 31, based on bank data reported through the week of July 24 — i.e. right after the last full reporting week of the prior month closes, not on a predetermined day number). A reminder tied to a fixed day (e.g. "the 5th of each month") would be unreliable — some months it publishes on the 28th, others the 30th or 31st, shifting around weekends/holidays. **This is why the staleness check below compares against the current calendar month rather than a specific day.**

This research grounds the phase but does **not** replace the "Before starting" confirmation below — the exact enforcement mechanics are a real legal/business decision, not something to infer from general research.

## Resolved — confirmed directly with the human

1. **Scope of the ceiling:** a single global value. It does not vary by credit modality.
2. **What the ceiling validates:** the effective total cost — every Phase 14 concept plus moratory interest and any fixed fees, not just a field literally named "interés." This is what makes the check meaningful given the client's own stated reason for wanting configurable concepts (see `docs/phases/PHASE_14_INTEREST_CONCEPTS.md`'s "Important cross-reference" note).
3. **On violation:** a warning, not a hard block — the admin sees the loan/concept exceeds the current ceiling and can continue anyway, optionally with a justification note.
4. **When enforcement runs:** creation-time only, for now. Moratory interest is not automatically re-capped against the current usury rate on every read; this may be revisited later if the warning-only approach proves insufficient.
5. **Retroactivity:** not retroactive. A new month's rate only applies to interest accruing from that point forward — interest already caused under a prior month's rate is untouched. This confirms the historical `UsuryRate` table (dated rows, never mutated) below is the right shape, since past months' rates must remain queryable exactly as they were when they applied.

These answers are final for this phase — do not revisit them without a new confirmation round with the human.

6. **How a loan's effective rate is calculated for comparison against the ceiling:** the maximum per-installment rate implied by its concepts — percentage concepts contribute their value directly (already a periodic rate against the declining balance, same basis `generateAmortizationSchedule` uses); fixed-amount concepts are converted to an equivalent rate by dividing their computed currency amount by the balance before that installment. The max across all installments is compared against the stored monthly ceiling. Confirmed over annualizing the loan's total cost — simpler, and avoids introducing a mes-a-EA conversion formula with its own error surface. See `apps/api/src/usuryRates/calculateLoanEffectiveRate.ts`.

## Required reading before starting

`docs/DATABASE.md` (interest rate / mora sections), `docs/phases/PHASE_14_INTEREST_CONCEPTS.md` (this phase validates against its concept model).

## Scope (once the above is confirmed)

### Entities and migrations
- [x] `UsuryRate` entity: `id`, `effective_month` (DATE, unique), `rate_percentage` (DECIMAL), `created_by` (FK → `users`, nullable + `SET NULL`, same pattern as `audit_logs.actor_user_id`), `created_at`. **Historical rows, not a single mutable value** — append-only, no `updated_at`/`deleted_at`.
- [x] Migrations `CreateUsuryRatesTable`, `AddUsuryFieldsToLoans` (adds `loans.usury_ceiling_exceeded_at_creation` and `loans.usury_justification` — see Enforcement below).

### Service and API
- [x] `UsuryRateService.getCurrentRate()` (+ computed `isStale`), `.setRate(dto, actorUserId)` (admin only, creates a new month's entry, rejects a duplicate month rather than overwriting it), `.getRateForMonth(date)` for non-retroactive historical lookups.
- [x] `POST /api/v1/usury-rates` — admin only.
- [x] `GET /api/v1/usury-rates/current`, `GET /api/v1/usury-rates` (history, admin only).

### Stale-rate alert (confirmed with the client — publication timing follow-up)
Since the SFC doesn't publish on a fixed day (see domain research above), a day-based reminder isn't reliable. Instead:
- [x] `GET /api/v1/usury-rates/current`'s response includes `isStale: boolean` — true when the most recent row's `effective_month` is not the current calendar month (i.e. nobody has entered this month's certified rate yet, whether it's the 1st or the 20th). Computed on read by comparing `effective_month` to today's year-month, not stored. **Two bugs fixed here 2026-09-30** — see `docs/DATABASE.md`'s notes of that date: the comparison used raw UTC instead of Bogotá time, and separately, "the most recent row" had no upper bound, so registering a future month's rate ahead of time made it "vigente" before its own month started.
- [x] No cron/scheduled job needed for this — it's a plain computed comparison, checked whenever the admin loads the relevant screen.

### Enforcement
- [x] Validation hook into `LoansService.persistLoanWithInstallments()` (shared by `create()`/`refinance()`, Phase 14's concept creation): `calculateMaxEffectiveInstallmentRate()` (see resolved question 6 above) is compared against `UsuryRateService.getCurrentRate()`. Never throws — a warning, per the confirmed answer. `Loan.usuryCeilingExceededAtCreation` snapshots the result at creation/refinance time (not recomputed on read, per confirmed answer 4); `Loan.usuryJustification` carries the optional admin note. `LoansService.previewSchedule()` returns the same warning (`{ installments, usuryWarning }`) so the admin sees it before committing, not just after.

### Tests (mandatory)
- [x] `UsuryRateService`: setting a new month's rate does not alter previous months' stored values; `getRateForMonth()` returns the correct historical value; a duplicate month is rejected.
- [x] `calculateMaxEffectiveInstallmentRate()`: percentage concepts contribute their value directly; fixed-amount concepts convert correctly against the balance before that installment; the max (not first/last) installment wins; a loan with no concepts returns 0.
- [x] Enforcement: a loan/concept exceeding the current ceiling is flagged (`usuryCeilingExceededAtCreation: true`) but still created, per the confirmed warning-only rule; `usuryJustification` is persisted when provided.
- [x] `isStale`: false when the latest row's `effective_month` matches the current month; true when it's from a prior month (e.g. it's now August and the latest entered rate is still July's).

### Swagger
- [x] New endpoints documented; `POST /loans`/`POST /loans/:id/refinance`/`POST /loans/preview-schedule` descriptions updated to explain the warning-only usury check.

## Definition of done for this phase

- [x] The current usury ceiling is visible and admin-updatable on a monthly cadence.
- [x] Past months' rates remain intact and queryable after a new month's rate is entered.
- [x] **Confirmed (client, publication-timing follow-up):** at the start of a new calendar month, if nobody has entered that month's certified rate yet, the admin sees a clear alert — not a fixed-day reminder, since the SFC's own publication date moves around.
- [x] The confirmed enforcement rule (creation-time only, warning not a block, non-retroactive) is implemented exactly as agreed — not guessed.
- [x] All items in `docs/DEFINITION_OF_DONE.md` checklist pass.

## After this phase

Added a "Tasa de usura / Usury rate" entry to `docs/GLOSSARY.md` and a `usury_rates` table section (plus the `loans.usury_ceiling_exceeded_at_creation`/`usury_justification` columns) to `docs/DATABASE.md`, including the confirmed non-retroactivity rule — done as part of this phase's own PR rather than left as a follow-up.

## Related documents

- `docs/phases/PHASE_14_INTEREST_CONCEPTS.md` — the concept model this phase's ceiling validates against
- `docs/DATABASE.md` — interest rate open question
