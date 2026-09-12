import { Between, LessThan, Repository } from 'typeorm';

import { addDaysToDateString, todayDateString } from '../loans/dueDateSchedule';
import {
  Installment,
  InstallmentStatus,
} from '../loans/entities/installment.entity';
import { LoanStatus } from '../loans/entities/loan.entity';
import { LoanInstallmentConcept } from '../loans/entities/loanInstallmentConcept.entity';
import { Payment } from '../loans/entities/payment.entity';
import { findConceptsByInstallmentId } from '../loans/installments/conceptsByInstallmentId';
import { enrichInstallment } from '../loans/installments/enrichInstallment';
import { calculateDaysUntilDue } from '../loans/installments/installmentCalculations';
import { sumPaymentsByInstallmentId } from '../loans/installments/paymentTotals';

// Shared between OverdueReminderService and UpcomingDueReminderService —
// both now need BOTH an overdue and an upcoming picture for a client to
// decide whether UpcomingAndOverdueMixed applies (see
// reminderTemplateSelection.ts and docs/phases/PHASE_33_MESSAGE_TEMPLATES_V2.md),
// so this used to be two private, near-duplicate methods per service.

export interface OverdueInstallmentResult {
  id: string;
  // Human report, 2026-09-19 — lets callers (OverdueReminderService,
  // UpcomingDueReminderService) split a client's consolidated reminder by
  // recipient: a loan with alternateContactPhoneNumber set routes its own
  // installments to that contact instead of the client, in a separate
  // message scoped to just that loan — see
  // groupInstallmentsByRecipient.ts.
  loanId: string;
  alternateContactPhoneNumber: string | null;
  installmentNumber: number;
  promissoryNoteNumber: string;
  amount: number;
  totalDue: number;
  overdueDays: number;
  // Bug fix, 2026-09-07 — the accrued moratory interest alone, straight
  // from enrichInstallment (never adjusted for totalPaid below). Added so
  // callers that need "just the interest portion" (overdueReminder.service.ts
  // and upcomingDueReminder.service.ts's MessageLogItem.interestSnapshot)
  // have it directly, instead of deriving it as `totalDue - amount` — which
  // broke once totalDue started netting out payments already made (a
  // partially paid overdue installment would otherwise report an
  // understated, even negative, "interest").
  interest: number;
}

export async function findOverdueInstallmentsForClient(
  installmentsRepository: Repository<Installment>,
  paymentsRepository: Repository<Payment>,
  // Bug fix, 2026-09-08 — was missing entirely; every caller passed `[]`
  // straight to enrichInstallment below. See that call's own comment.
  loanInstallmentConceptsRepository: Repository<LoanInstallmentConcept>,
  clientId: string,
): Promise<OverdueInstallmentResult[]> {
  // Bug fix, 2026-09-04 — was `new Date().toISOString().slice(0, 10)` (the
  // UTC calendar date, wrong for ~5 hours a day in Bogotá); todayDateString()
  // now corrects for the fixed UTC-5 offset. See its own comment in
  // dueDateSchedule.ts and docs/DATABASE.md's note of that date.
  const today = todayDateString();

  const installments = await installmentsRepository.find({
    where: {
      status: InstallmentStatus.Pending,
      dueDate: LessThan(today),
      loan: { clientId, status: LoanStatus.Active },
    },
    relations: { loan: true },
    order: { dueDate: 'ASC' },
  });
  // Bug fix, 2026-09-07 — see enrichInstallment.ts's `totalPaid` param and
  // docs/DATABASE.md's note of this date: without this, a client who'd
  // already made a partial payment on an overdue installment kept being
  // reminded of the FULL original amount, not what's actually still owed.
  const totalPaidByInstallmentId = await sumPaymentsByInstallmentId(
    paymentsRepository,
    installments.map((installment) => installment.id),
  );
  // Bug fix, 2026-09-08 — concepts was hardcoded to `[]` below, which
  // silently reported ZERO accrued mora in every WhatsApp reminder and
  // the self-service "saldo pendiente" note for any loan with real
  // moratory concepts assigned (every current-generation loan). See
  // docs/DATABASE.md's note of this date.
  const conceptsByInstallmentId = await findConceptsByInstallmentId(
    loanInstallmentConceptsRepository,
    installments.map((installment) => installment.id),
  );

  return installments.map((installment) => {
    const enriched = enrichInstallment(
      installment,
      conceptsByInstallmentId.get(installment.id) ?? [],
      totalPaidByInstallmentId.get(installment.id) ?? 0,
    );
    return {
      id: installment.id,
      loanId: installment.loanId,
      alternateContactPhoneNumber: installment.loan.alternateContactPhoneNumber,
      installmentNumber: installment.installmentNumber,
      promissoryNoteNumber: installment.loan.promissoryNoteNumber,
      amount: installment.amount,
      totalDue: enriched.totalDue,
      overdueDays: enriched.overdueDays,
      interest: enriched.interest,
    };
  });
}

export async function findClientIdsWithOverdueInstallments(
  installmentsRepository: Repository<Installment>,
): Promise<string[]> {
  // Bug fix, 2026-09-04 — see todayDateString()'s own comment above.
  const today = todayDateString();

  const installments = await installmentsRepository.find({
    where: {
      status: InstallmentStatus.Pending,
      dueDate: LessThan(today),
      loan: { status: LoanStatus.Active },
    },
    relations: { loan: true },
  });

  return [
    ...new Set(installments.map((installment) => installment.loan.clientId)),
  ];
}

export interface UpcomingInstallmentResult {
  id: string;
  // See OverdueInstallmentResult's identical fields' own comment.
  loanId: string;
  alternateContactPhoneNumber: string | null;
  installmentNumber: number;
  promissoryNoteNumber: string;
  amount: number;
  daysUntilDue: number;
}

// Reworked 2026-09-07 (human) — was an exact-day match (`dueDate` equal to
// one of a fixed list of today+offset target dates, e.g. today+5/+3/+1).
// That's fragile against the admin's own day-of-week cron picker: skip a
// day in the schedule and whichever installments needed checking exactly
// that day are silently gone forever, with no way to recover them (traced
// live with the human — a due-Friday installment got zero reminders under
// a Mon/Wed/Fri schedule, while a due-Saturday one got all three). Now
// cumulative instead, mirroring how findOverdueInstallmentsForClient/
// findClientIdsWithOverdueInstallments already work (`dueDate < today` —
// once true, stays true every subsequent run until resolved): "due within
// the next `maxDaysUntilDue` days" stays true across multiple runs, so a
// less-than-daily schedule just means a client gets reminded on whichever
// of their selected cron days falls inside that window — never zero,
// unlike the exact-match version. Deliberately excludes today itself
// (`dueDate > today`) to keep matching the old behavior of never
// auto-reminding on the due date itself; upcomingDaysPhrase()'s 'hoy'
// branch is only reachable via a manual on-demand send.
export async function findUpcomingInstallmentsForClient(
  installmentsRepository: Repository<Installment>,
  clientId: string,
  maxDaysUntilDue: number,
): Promise<UpcomingInstallmentResult[]> {
  const today = todayDateString();
  const installments = await installmentsRepository.find({
    where: {
      status: InstallmentStatus.Pending,
      dueDate: Between(
        addDaysToDateString(today, 1),
        addDaysToDateString(today, maxDaysUntilDue),
      ),
      loan: { clientId, status: LoanStatus.Active },
    },
    relations: { loan: true },
    order: { dueDate: 'ASC' },
  });

  return installments.map((installment) => ({
    id: installment.id,
    loanId: installment.loanId,
    alternateContactPhoneNumber: installment.loan.alternateContactPhoneNumber,
    installmentNumber: installment.installmentNumber,
    promissoryNoteNumber: installment.loan.promissoryNoteNumber,
    amount: installment.amount,
    daysUntilDue: calculateDaysUntilDue(new Date(installment.dueDate)),
  }));
}

export async function findClientIdsWithUpcomingInstallments(
  installmentsRepository: Repository<Installment>,
  maxDaysUntilDue: number,
): Promise<string[]> {
  const today = todayDateString();
  const installments = await installmentsRepository.find({
    where: {
      status: InstallmentStatus.Pending,
      dueDate: Between(
        addDaysToDateString(today, 1),
        addDaysToDateString(today, maxDaysUntilDue),
      ),
      loan: { status: LoanStatus.Active },
    },
    relations: { loan: true },
  });

  return [
    ...new Set(installments.map((installment) => installment.loan.clientId)),
  ];
}
