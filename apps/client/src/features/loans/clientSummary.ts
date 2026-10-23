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
    .filter((installment) => installment.status === InstallmentStatus.Pending)
    .map((installment) => {
      const surcharges = calculateMoraCharged(
        installment.amount,
        installment.interest,
      );
      return {
        installmentId: installment.id,
        installmentNumber: installment.installmentNumber,
        isDownPayment: installment.isDownPayment,
        dueDate: installment.dueDate,
        overdueDays: installment.overdueDays,
        amount: installment.amount,
        surcharges,
        paidSoFar: Math.max(
          0,
          Math.round(installment.amount + surcharges - installment.totalDue),
        ),
        totalDue: installment.totalDue,
      };
    });
  const overdueRows = rows.filter((row) => row.overdueDays > 0);
  const sumTotalDue = (items: ClientSummaryRow[]) =>
    items.reduce((sum, row) => sum + row.totalDue, 0);

  return {
    rows,
    paidCount: installments.filter(
      (installment) => installment.status === InstallmentStatus.Paid,
    ).length,
    totalCount: installments.filter(
      (installment) => installment.status !== InstallmentStatus.Cancelled,
    ).length,
    overdueCount: overdueRows.length,
    overdueTotal: sumTotalDue(overdueRows),
    hasPartialPayments: rows.some((row) => row.paidSoFar > 0),
  };
}
