# Phase 16 — Early Payoff and Interest-First Allocation (Liquidación Anticipada)

## Goal

Let the system tell a client exactly how much they owe if they pay off their loan today, calculated correctly instead of simply summing remaining installment totals — Colombian law does not allow forcing a client to pay interest that hasn't been caused yet. This also generalizes to any payment that covers more than one overdue installment at once: interest owed is settled first, and only the remainder reduces principal.

## Domain research (informational — not a substitute for legal confirmation)

Colombian Civil Code, Article 1653 ("Imputación del pago a intereses"): if both principal and interest are owed, a payment is applied **first to accrued interest**, and only the excess to principal — unless the creditor expressly consents to apply it to principal directly. Worked example from the research: capital 100, interest 30, a payment of 50 pays the 30 of interest first, and the remaining 20 goes to principal. This is the general rule this phase implements, but the exact mechanics of applying it across multiple installments in one payment (see "Before starting" below) are a design decision, not something the law specifies at that level of detail.

## Resolved — confirmed directly with the human

1. **What counts as "interest" for imputación purposes:** moratory interest **and** the sum of every Phase 14 concept baked into an installment's `amount` (everything above `principalPortion`) — not just moratory interest alone. This is what makes the rule meaningful given Phase 14's concepts exist specifically to cover costs beyond a single "interés" field (same reasoning as Phase 15's usury-ceiling scope).
2. **Multi-installment allocation:** interest-first **globally** across all pending installments, then principal globally — not a per-installment waterfall. Within this phase's own scope (see point 5 below — payoff is always for the full quoted amount, never partial) this produces the same numbers as a waterfall would; the distinction is confirmed now specifically because `docs/phases/PHASE_17_REFINANCING_RECALC.md` reuses `calculatePayoff()` and may need it for a partial/different scenario — recorded here so that reuse doesn't have to re-ask this question.
3. **Future, not-yet-due installments:** included in the quote, at **principal face value with zero interest** — no moratory interest (none has accrued) and no Phase 14 concept charges either, since those represent financing cost for a period that hasn't happened yet. Only installments that have matured (due today or already overdue) contribute their concept charges and any moratory interest.
4. **Initial installment (Phase 13), if still unpaid:** contributes only its own amount as principal, **never** as interest — consistent with it never accruing mora in the first place.
5. **Biggest question — scope of the change:** a **separate, explicit "liquidar anticipadamente" flow**. `registerPayment` and today's one-payment-per-installment behavior are completely untouched. The new flow only ever settles the loan for the **full** quoted amount (closing it out entirely) — there is no partial early-liquidation payment in this phase's scope, matching the client-side UI being a read-only summary plus a single confirm action, not an amount field. `Payment.installment_id` stays a required single FK; nothing about the existing data model changes.

These answers are final for this phase — do not revisit them without a new confirmation round with the human.

## Required reading before starting

`docs/phases/PHASE_14_INTEREST_CONCEPTS.md`, `docs/phases/PHASE_15_USURY_RATE.md` (both feed into what "interest owed" means here), `docs/phases/PHASE_4_LOANS_INSTALLMENTS.md` (current `Payment`/`Installment` model).

## Scope (once the above is confirmed)

### Calculation module
- [x] `loans/payoff/calculatePayoff.ts` — pure function implementing the confirmed allocation rule, sibling to `installmentCalculations.ts`, unit-tested the same way as `installmentCalculations.spec.ts`.

### Endpoint
- [x] `GET /api/v1/loans/:id/payoff-quote` — returns the amount due today to close out the loan, with a breakdown per installment (interest applied, principal applied).
- [x] `POST /api/v1/loans/:id/payoff` — per the confirmed answer to question 5, a new endpoint (not a `registerPayment` generalization) that registers one `Payment` row per still-pending installment for the full quoted amount, marks every installment `paid`, and the loan `paid`, in one transaction. No partial-amount payoff.

### Tests (mandatory)
- [x] `calculatePayoff()`: single overdue installment, multiple overdue installments, mix of overdue and not-yet-due, presence of an initial installment, an installment due exactly today, the `principalPortion: null` legacy fallback, an empty installment list.
- [x] The chosen endpoint correctly registers the resulting split payments and updates installment/loan status accordingly — plus rejects a non-active loan.

### Swagger
- [x] New endpoint(s) documented, including a clear explanation of the allocation rule in the description.

## Definition of done for this phase

- [x] A loan's payoff quote reflects interest owed to date, not blindly summing remaining installment totals.
- [x] The confirmed allocation and scope-of-change answers are implemented exactly as agreed — not guessed.
- [x] All items in `docs/DEFINITION_OF_DONE.md` checklist pass.

## After this phase

Added "Liquidación anticipada / Early payoff" and "Imputación del pago" to `docs/GLOSSARY.md`. `docs/DATABASE.md` did not need updating — `Payment`'s relationship to `Installment` is unchanged (confirmed answer 5: a separate flow, not a `registerPayment` generalization), `payoff()` just creates ordinary `Payment` rows the same way `registerPayment` always has.

## Follow-up, 2026-09-23 — interest true-up (ajuste de interés causado)

Payoff (and the refinance suggested principal, which reuses it) charged capital only for not-yet-due installments, but ignored that the averaged flat cuota under-collects interest early in the schedule — after 10 of 12 cuotas of a 2.600.000 / 3,9% loan the client had paid 84.417 less interest than the loan caused, and payoff never recovered it. Confirmed with the human against that exact example: quote = pending capital 433.333,30 + 84.417. Implemented as `calculateInterestTrueUp()` (pure, sibling to `calculatePayoff.ts`) feeding a new `interestTrueUp` option/field on `PayoffQuote`; Art. 1653 is unchanged — no interest is charged for a *period* not yet caused, this only settles interest of periods that already were. See `docs/GLOSSARY.md` → "Liquidación anticipada" for the full rules. Not changed: `registerPayment` (paying cuotas 11-12 ahead as ordinary payments still charges each its full $271.600 — separate, undecided question).

## Related documents

- `docs/phases/PHASE_14_INTEREST_CONCEPTS.md`, `docs/phases/PHASE_15_USURY_RATE.md` — feed the "interest owed" calculation
- `docs/phases/PHASE_17_REFINANCING_RECALC.md` — reuses this phase's calculation module
