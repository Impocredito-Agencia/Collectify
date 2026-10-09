import { renderInstallmentsBreakdownList } from './messageRenderer';
import {
  ReminderOverdueInstallment,
  ReminderUpcomingInstallment,
} from './reminderTemplateSelection';

// Human report, 2026-10-09 — a reminder covering several cuotas
// (varias_cuota_vencida, proxima_vencer_y_vencida, varias_cuota_proxima_vencer
// and their *_30dias variants) only tells the client a count and one summed
// total, so the saved message alone didn't let a cobrador see which cuotas,
// and for how much each, that total was made of — exactly what they need
// when the client answers with an abono for just one of them. This is that
// cuota-by-cuota desglose as of send time, stored next to the message
// (message_logs.breakdown_content). Internal only: the client never
// receives it.
//
// Null for a single-cuota reminder — its own body already names the cuota,
// the pagaré and the amount.
export function renderReminderBreakdown(
  overdue: ReminderOverdueInstallment[],
  upcoming: ReminderUpcomingInstallment[],
): string | null {
  if (overdue.length + upcoming.length <= 1) {
    return null;
  }

  return renderInstallmentsBreakdownList([
    ...overdue.map((installment) => ({
      installmentNumber: installment.installmentNumber,
      promissoryNoteNumber: installment.promissoryNoteNumber,
      totalDue: installment.totalDue,
      overdueDays: installment.overdueDays,
      daysUntilDue: 0,
    })),
    ...upcoming.map((installment) => ({
      installmentNumber: installment.installmentNumber,
      promissoryNoteNumber: installment.promissoryNoteNumber,
      // Same figure the upcoming templates themselves report.
      totalDue: installment.amount,
      overdueDays: 0,
      daysUntilDue: installment.daysUntilDue,
    })),
  ]);
}
