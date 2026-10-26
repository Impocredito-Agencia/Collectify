import { InstallmentStatus } from '@/features/installments/installmentsApi';
import { calculateMoraCharged } from '@/lib/moraWaiver';

import type { Installment } from '@/features/installments/installmentsApi';

// Client request, 2026-10-23 — the numbers behind LoanClientSummaryDialog,
// the screenshot-friendly "estado de cuenta" an admin sends to the debtor.
// Deliberately coarser than LoanDetailPage's InstallmentsTable: no
// per-concept columns, just what the debtor needs (days late, the cuota,
// its mora surcharges as one figure, and what to pay).
export interface ClientSummaryRow {
  installmentId: string;
  installmentNumber: number;
  isDownPayment: boolean;
  // Client request, 2026-10-26 — paid cuotas are listed too, so the debtor
  // sees their whole plan; they owe nothing, so every money figure past
  // `amount` is 0 for them.
  isPaid: boolean;
  dueDate: string;
  overdueDays: number;
  amount: number;
  // Every moratorio charge (intereses moratorios, gastos de cobranza…) as
  // one figure, AFTER the backend's $100 rounding of the cuota's total
  // (calculateMoraCharged) — not the raw Installment.interest, which can
  // be up to $50 off — so amount + surcharges − paidSoFar always equals
  // totalDue on the debtor's screenshot.
  surcharges: number;
  // Partial payments already made on this cuota. totalDue already nets
  // them out (see apps/api/src/loans/installments/enrichInstallment.ts),
  // so this is just the difference, never stored on its own.
  paidSoFar: number;
  totalDue: number;
}

export interface ClientSummary {
  rows: ClientSummaryRow[];
  paidCount: number;
  // Cancelled cuotas (left over from a refinance) aren't part of the
  // debtor's plan anymore, so they count nowhere.
  totalCount: number;
  overdueCount: number;
  overdueTotal: number;
  hasPartialPayments: boolean;
}

export function buildClientSummary(installments: Installment[]): ClientSummary {
  const rows = installments
    .filter((installment) => installment.status !== InstallmentStatus.Cancelled)
    .map((installment) => {
      const isPaid = installment.status === InstallmentStatus.Paid;
      // The api already returns 0 interest/totalDue for a paid cuota, so
      // only paidSoFar (which would otherwise come out as the full amount)
      // needs the explicit guard.
      const surcharges = isPaid
        ? 0
        : calculateMoraCharged(installment.amount, installment.interest);
      return {
        installmentId: installment.id,
        installmentNumber: installment.installmentNumber,
        isDownPayment: installment.isDownPayment,
        isPaid,
        dueDate: installment.dueDate,
        overdueDays: isPaid ? 0 : installment.overdueDays,
        amount: installment.amount,
        surcharges,
        paidSoFar: isPaid
          ? 0
          : Math.max(
              0,
              Math.round(
                installment.amount + surcharges - installment.totalDue,
              ),
            ),
        totalDue: isPaid ? 0 : installment.totalDue,
      };
    })
    .sort((a, b) => a.installmentNumber - b.installmentNumber);
  const overdueRows = rows.filter((row) => row.overdueDays > 0);
  const sumTotalDue = (items: ClientSummaryRow[]) =>
    items.reduce((sum, row) => sum + row.totalDue, 0);

  return {
    rows,
    paidCount: rows.filter((row) => row.isPaid).length,
    totalCount: rows.length,
    overdueCount: overdueRows.length,
    overdueTotal: sumTotalDue(overdueRows),
    hasPartialPayments: rows.some((row) => row.paidSoFar > 0),
  };
}
