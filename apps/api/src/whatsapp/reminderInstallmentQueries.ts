import { Between, LessThan, Repository } from 'typeorm';

import { addDaysToDateString, todayDateString } from '../loans/dueDateSchedule';
import {
  Installment,
  InstallmentStatus,
} from '../loans/entities/installment.entity';
import { LoanStatus } from '../loans/entities/loan.entity';
import { enrichInstallment } from '../loans/installments/enrichInstallment';
import { calculateDaysUntilDue } from '../loans/installments/installmentCalculations';

// Shared between OverdueReminderService and UpcomingDueReminderService —
// both now need BOTH an overdue and an upcoming picture for a client to
// decide whether UpcomingAndOverdueMixed applies (see
// reminderTemplateSelection.ts and docs/phases/PHASE_33_MESSAGE_TEMPLATES_V2.md),
// so this used to be two private, near-duplicate methods per service.

export interface OverdueInstallmentResult {
  id: string;
  installmentNumber: number;
  promissoryNoteNumber: string;
  amount: number;
  totalDue: number;
  overdueDays: number;
}

export async function findOverdueInstallmentsForClient(
  installmentsRepository: Repository<Installment>,
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

  return installments.map((installment) => {
    const enriched = enrichInstallment(
      installment,
      installment.loan.interestRate,
    );
    return {
      id: installment.id,
      installmentNumber: installment.installmentNumber,
      promissoryNoteNumber: installment.loan.promissoryNoteNumber,
      amount: installment.amount,
      totalDue: enriched.totalDue,
      overdueDays: enriched.overdueDays,
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
