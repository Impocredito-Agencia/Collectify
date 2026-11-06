import { InstallmentStatus } from '../entities/installment.entity';
import { InstallmentWithCalculated } from '../installments/enrichInstallment';

// Phase 35 — what a deleted pagaré's cuotas looked like at the moment it was
// deleted, stored once on loans.deletion_snapshot so the read-only view
// shows exactly those figures forever. Mora is calculated-on-read for a live
// loan (see enrichInstallment); this freezes it instead, since a deleted
// pagaré's mora must not keep accruing. Plain JSON, no ids or relations —
// it's a record of figures, not a link to rows that may change.
export interface DeletedInstallmentSnapshot {
  installmentNumber: number;
  isDownPayment: boolean;
  dueDate: string;
  amount: number;
  principalPortion: number | null;
  status: InstallmentStatus;
  overdueDays: number;
  // Every moratorio charge as one figure — enrichInstallment's `interest`.
  interest: number;
  totalPaid: number;
  totalDue: number;
  conceptBreakdown: {
    name: string;
    category: string;
    amount: number;
  }[];
}

export interface LoanDeletionSnapshot {
  // ISO instant the figures were taken at.
  takenAt: string;
  installments: DeletedInstallmentSnapshot[];
}

export function buildLoanDeletionSnapshot(
  installments: InstallmentWithCalculated[],
  totalPaidByInstallmentId: Map<string, number>,
  takenAt: Date,
): LoanDeletionSnapshot {
  return {
    takenAt: takenAt.toISOString(),
    installments: installments.map((installment) => ({
      installmentNumber: installment.installmentNumber,
      isDownPayment: installment.isDownPayment,
      dueDate: installment.dueDate,
      amount: installment.amount,
      principalPortion: installment.principalPortion,
      status: installment.status,
      overdueDays: installment.overdueDays,
      interest: installment.interest,
      totalPaid: totalPaidByInstallmentId.get(installment.id) ?? 0,
      totalDue: installment.totalDue,
      conceptBreakdown: installment.conceptBreakdown.map((concept) => ({
        name: concept.name,
        category: concept.category,
        amount: concept.amount,
      })),
    })),
  };
}
