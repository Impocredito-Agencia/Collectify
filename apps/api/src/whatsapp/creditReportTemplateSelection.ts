import { formatPromissoryNoteLabel } from '../common/promissoryNoteLabel';

import { formatCurrency, formatTratamiento } from './messageRenderer';
import { MessageType } from './messageType.enum';
import {
  ReminderOverdueInstallment,
  TemplateSelectionResult,
} from './reminderTemplateSelection';

// Client request, 2026-10-30 — each notice states its day count literally in
// the Meta template's fixed text, so it only goes out on that exact day, never
// "from that day on".
export const CREDIT_REPORT_TYPE_BY_MORA_DAYS: Record<number, MessageType> = {
  30: MessageType.CreditReport30Days,
  50: MessageType.CreditReport50Days,
};

export const CREDIT_REPORT_MORA_DAYS = Object.keys(
  CREDIT_REPORT_TYPE_BY_MORA_DAYS,
).map(Number);

// A pagaré's mora is its OLDEST overdue cuota's days late (confirmed with the
// human, 2026-10-30): a newer cuota reaching 30 days sends nothing while an
// older one already sits at 44.
export function findOldestOverdueInstallment<
  T extends ReminderOverdueInstallment,
>(overdue: T[]): T | null {
  return overdue.length === 0
    ? null
    : overdue.reduce((a, b) => (a.overdueDays >= b.overdueDays ? a : b));
}

// `overdue` must hold a single pagaré's overdue cuotas. Null means that
// pagaré's mora isn't exactly on a notice day today, so nothing is sent.
// {{3}} is what the client must pay to get current on that pagaré: every
// overdue cuota, recargos included and abonos already netted out (confirmed
// with the human, 2026-10-30).
export function selectCreditReportTemplate(
  clientFullName: string,
  overdue: ReminderOverdueInstallment[],
): TemplateSelectionResult | null {
  const oldest = findOldestOverdueInstallment(overdue);
  const type = oldest && CREDIT_REPORT_TYPE_BY_MORA_DAYS[oldest.overdueDays];
  if (!oldest || !type) {
    return null;
  }

  const total = overdue.reduce((sum, i) => sum + i.totalDue, 0);
  return {
    type,
    bodyParameters: [
      formatTratamiento(clientFullName),
      formatPromissoryNoteLabel(oldest.promissoryNoteNumber),
      `$${formatCurrency(total)}`,
    ],
  };
}
