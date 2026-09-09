import { MORA_GRACE_PERIOD_DAYS } from '../loans/installments/installmentCalculations';

import { formatCurrency, formatTratamiento } from './messageRenderer';
import { MessageType } from './messageType.enum';
import { NotaAdicionalInput } from './notaAdicional';
import { composeReminderNotaAdicional } from './notaAdicional';

function money(amount: number): string {
  return `$${formatCurrency(amount)}`;
}

function upcomingDaysPhrase(daysUntilDue: number): string {
  if (daysUntilDue === 0) {
    return 'hoy';
  }
  if (daysUntilDue === 1) {
    return 'mañana';
  }
  return `en ${daysUntilDue} días`;
}

function overdueDaysPhrase(overdueDays: number): string {
  return overdueDays === 1 ? 'hace 1 día' : `hace ${overdueDays} días`;
}

export interface ReminderOverdueInstallment {
  installmentNumber: number;
  promissoryNoteNumber: string;
  amount: number;
  totalDue: number;
  overdueDays: number;
}

export interface ReminderUpcomingInstallment {
  installmentNumber: number;
  promissoryNoteNumber: string;
  amount: number;
  daysUntilDue: number;
}

export interface TemplateSelectionResult {
  type: MessageType;
  bodyParameters: string[];
}

// The one place that decides among the 5 reminder templates (Templates
// 4-8, see docs/phases/PHASE_33_MESSAGE_TEMPLATES_V2.md) — shared by
// OverdueReminderService and UpcomingDueReminderService so the mixed
// UpcomingAndOverdueMixed template is only ever defined in one place.
// Which of the two SERVICES is allowed to actually select it for an
// automated (cron) send is a separate concern — see
// OverdueReminderService's doc comment (reversed 2026-09-07) for why the
// weekly job owns that case exclusively now, not the daily one.
export function selectReminderTemplate(
  clientFullName: string,
  overdue: ReminderOverdueInstallment[],
  upcoming: ReminderUpcomingInstallment[],
  notaAdicional: NotaAdicionalInput,
): TemplateSelectionResult {
  const tratamiento = formatTratamiento(clientFullName);
  const nota = composeReminderNotaAdicional(notaAdicional);

  if (overdue.length > 0 && upcoming.length > 0) {
    const overdueTotal = overdue.reduce((sum, i) => sum + i.totalDue, 0);
    const upcomingTotal = upcoming.reduce((sum, i) => sum + i.amount, 0);
    return {
      type: MessageType.UpcomingAndOverdueMixed,
      bodyParameters: [
        tratamiento,
        String(overdue.length),
        money(overdueTotal),
        String(upcoming.length),
        money(upcomingTotal),
        nota,
      ],
    };
  }

  if (overdue.length > 1) {
    const oldest = overdue.reduce((a, b) =>
      a.overdueDays > b.overdueDays ? a : b,
    );
    const total = overdue.reduce((sum, i) => sum + i.totalDue, 0);
    return {
      type: MessageType.MultipleOverdueInstallments,
      bodyParameters: [
        tratamiento,
        String(overdue.length),
        overdueDaysPhrase(oldest.overdueDays),
        money(total),
        nota,
      ],
    };
  }

  if (overdue.length === 1) {
    const [item] = overdue;
    if (item.overdueDays > MORA_GRACE_PERIOD_DAYS) {
      return {
        type: MessageType.SingleOverdueInstallmentWithSurcharge,
        bodyParameters: [
          tratamiento,
          String(item.installmentNumber),
          item.promissoryNoteNumber,
          overdueDaysPhrase(item.overdueDays),
          money(item.totalDue),
          nota,
        ],
      };
    }
    return {
      type: MessageType.SingleOverdueInstallment,
      bodyParameters: [
        tratamiento,
        String(item.installmentNumber),
        item.promissoryNoteNumber,
        money(item.amount),
        overdueDaysPhrase(item.overdueDays),
        nota,
      ],
    };
  }

  if (upcoming.length > 1) {
    const soonest = upcoming.reduce((a, b) =>
      a.daysUntilDue < b.daysUntilDue ? a : b,
    );
    const total = upcoming.reduce((sum, i) => sum + i.amount, 0);
    return {
      type: MessageType.MultipleUpcomingInstallments,
      bodyParameters: [
        tratamiento,
        String(upcoming.length),
        money(total),
        upcomingDaysPhrase(soonest.daysUntilDue),
        nota,
      ],
    };
  }

  const [item] = upcoming;
  return {
    type: MessageType.SingleUpcomingInstallment,
    bodyParameters: [
      tratamiento,
      String(item.installmentNumber),
      item.promissoryNoteNumber,
      money(item.amount),
      upcomingDaysPhrase(item.daysUntilDue),
      nota,
    ],
  };
}
