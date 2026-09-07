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

export function calculateInterest(
  installmentAmount: number,
  interestRate: number,
  overdueDays: number,
): number {
  return ((installmentAmount * (interestRate / 100)) / 30) * overdueDays;
}

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

// Phase 23 — the per-concept generalization of calculateInterest above,
// used when a loan has moratory concepts assigned via
// LoanInstallmentConcept (see enrichInstallment.ts and calculatePayoff.ts
// for the legacy-formula fallback when it doesn't). Computed on read, same
// as calculateInterest — never projected ahead of time, since future
// overdue days can't be known in advance (confirmed with the human, see
// docs/phases/PHASE_23_DYNAMIC_CHARGES.md).
//
// A percentage concept uses the exact same shape as calculateInterest, just
// per-concept instead of a single rate — a loan with one percentage
// moratory concept at the same value as the legacy interestRate produces an
// identical number, so migrating a loan onto the new engine causes no
// silent jump. A fixed_amount concept is charged once, flat, the moment the
// installment is overdue — it does not scale with overdueDays (confirmed
// with the human).
export function calculateMoratoryCharges(
  installmentAmount: number,
  overdueDays: number,
  concepts: MoratoryConceptAssignment[],
): MoratoryChargeItem[] {
  return concepts.map((concept) => ({
    name: concept.name,
    amount:
      overdueDays <= 0
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
