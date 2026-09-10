import { ConceptCalculationType } from '../../interestConceptTypes/entities/interestConceptType.entity';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Colombia has no DST, so this fixed offset holds year-round — same
// precedent as pinning CronJob timezones directly to 'America/Bogota' in
// whatsappCron.service.ts (see docs/DATABASE.md's cron TZ bug fix).
const BOGOTA_UTC_OFFSET_MS = 5 * 60 * 60 * 1000;

// `dueDate` is a 'date' column, parsed as UTC midnight (e.g.
// new Date('2026-09-10') -> 2026-09-10T00:00:00.000Z) with no time-of-day
// component — that UTC-midnight timestamp already IS its calendar date, so
// it needs no timezone adjustment of its own.
function dueDateDayNumber(dueDate: Date): number {
  return Math.floor(dueDate.getTime() / MS_PER_DAY);
}

// `today` is a genuine instant (almost always `new Date()`, "right now"),
// not a calendar date — so, unlike dueDate above, figuring out "what
// calendar date is it in Bogotá right now" requires shifting by the fixed
// UTC-5 offset FIRST, then taking that shifted instant's own UTC day
// number.
function todayDayNumberInBogota(today: Date): number {
  return Math.floor((today.getTime() - BOGOTA_UTC_OFFSET_MS) / MS_PER_DAY);
}

// Confirmed formula — verified against real spreadsheet data
// (docs/GLOSSARY.md → Interest). Do not modify without re-verifying against
// the fixtures in installmentCalculations.spec.ts.
//
// Whole Bogotá CALENDAR days between `today` and `dueDate`. Deliberately
// NOT differenceInCalendarDays (normalizes to the SERVER process's own
// local timezone, which must never affect the result — see the
// "off-by-one when the server runs behind UTC" regression test below) and
// NOT a raw differenceInDays on exact instants either (the original
// formula here) — that measures elapsed 24h periods from `today`'s precise
// timestamp against dueDate's UTC-midnight parsing, which silently shifted
// every result by a day (two after 7pm Bogotá), always in the direction of
// treating a cuota as due/overdue earlier than the calendar actually says.
// Bug found and fixed 2026-09-04 — see docs/DATABASE.md's note of that date
// for the full before/after analysis (it was first noticed as an unusually
// early "cuota entra al refinanciamiento" via the 5-day early-maturity
// window, but affects every caller of this file's two exported day-count
// functions the same way).
export function calculateOverdueDays(
  dueDate: Date,
  today: Date = new Date(),
): number {
  const overdueDays = todayDayNumberInBogota(today) - dueDateDayNumber(dueDate);
  return overdueDays > 0 ? overdueDays : 0;
}

// Symmetric to calculateOverdueDays — 0 once the due date has passed or is
// today, since "days until due" only means something for a future date.
// Used by the upcoming-due and account-summary messages, see
// docs/phases/PHASE_9_MESSAGE_TYPES.md, and by the refinance early-maturity
// window, see calculatePayoff.ts.
export function calculateDaysUntilDue(
  dueDate: Date,
  today: Date = new Date(),
): number {
  const daysUntilDue =
    dueDateDayNumber(dueDate) - todayDayNumberInBogota(today);
  return daysUntilDue > 0 ? daysUntilDue : 0;
}

// Bug fix, 2026-09-08 (human report) — the business doesn't charge mora
// during an installment's first N overdue days (see
// docs/phases/PHASE_33_MESSAGE_TEMPLATES_V2.md's Template 6 note: "the
// business doesn't charge mora until day 9"). That rule was only ever
// applied to which WhatsApp template/wording to send
// (reminderTemplateSelection.ts's own check against this same constant)
// — it never gated the actual money calculation here, so every consumer
// of calculateMoratoryCharges (the self-service breakdown, a loan's
// Total column, the Dashboard, cupo, and the payment ceiling) silently
// charged mora starting day 1. Confirmed with the human: once past the
// grace period, mora is charged over the FULL overdue days (no offset)
// — this constant only gates whether it's charged at all, it doesn't
// shift the formula. Keep in sync with reminderTemplateSelection.ts's
// own check.
//
// Narrowed from 8 to 6, 2026-09-09 (client correction) — the client
// clarified the real cutoff: day 6 still has no mora, but day 7 already
// does ("si el mensaje ya dice 7 días vencidos, ya debe estar aplicado
// el mora"). With this gate (`overdueDays <= MORA_GRACE_PERIOD_DAYS`),
// that means the threshold itself is 6, not 7 — day 6 satisfies
// `6 <= 6` (no mora), day 7 fails `7 <= 6` (mora applies).
export const MORA_GRACE_PERIOD_DAYS = 6;

export interface MoratoryConceptAssignment {
  name: string;
  calculationType: ConceptCalculationType;
  value: number;
}

export interface MoratoryChargeItem {
  name: string;
  amount: number;
  // Added 2026-09-06 (client request — no visual way to tell what rate a
  // given pagaré was actually made at, since the resulting currency amount
  // alone doesn't reveal it, and it can legitimately change from one loan
  // to the next as the usury ceiling moves month to month). Echoes the
  // concept's own snapshotted rate/amount straight through — see
  // enrichInstallment.ts's identical addition to ConceptBreakdownItem,
  // which is what actually surfaces this on GET /loans/:id.
  calculationType: ConceptCalculationType;
  value: number;
}

// Phase 23 — computes each moratory concept assigned to a loan (see
// enrichInstallment.ts) via LoanInstallmentConcept. Computed on read,
// never projected ahead of time, since future overdue days can't be
// known in advance (confirmed with the human, see
// docs/phases/PHASE_23_DYNAMIC_CHARGES.md).
//
// Removed, 2026-09-09 — this used to also generalize a legacy single-rate
// formula (calculateInterest, keyed off Loan.interestRate) for a loan
// with no moratory concepts assigned; both that formula and the column
// were dropped once verified dead (see enrichInstallment.ts's own note).
//
// A percentage concept is charged over the full overdue days, same shape
// as the old single-rate formula, just per-concept instead of one rate
// for the whole loan. A fixed_amount concept is charged once, flat, the
// moment the installment is overdue — it does not scale with
// overdueDays (confirmed with the human).
export function calculateMoratoryCharges(
  installmentAmount: number,
  overdueDays: number,
  concepts: MoratoryConceptAssignment[],
): MoratoryChargeItem[] {
  return concepts.map((concept) => ({
    name: concept.name,
    amount:
      // Bug fix, 2026-09-08 — the grace period gates every moratory
      // concept, not just a single legacy formula.
      overdueDays <= MORA_GRACE_PERIOD_DAYS
        ? 0
        : concept.calculationType === ConceptCalculationType.Percentage
          ? ((installmentAmount * (concept.value / 100)) / 30) * overdueDays
          : concept.value,
    calculationType: concept.calculationType,
    value: concept.value,
  }));
}

export function calculateTotalDue(
  installmentAmount: number,
  interest: number,
): number {
  return installmentAmount + interest;
}
