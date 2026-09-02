import { Repository } from 'typeorm';

import {
  Installment,
  InstallmentStatus,
} from '../loans/entities/installment.entity';
import { LoanStatus } from '../loans/entities/loan.entity';
import { Payment } from '../loans/entities/payment.entity';
import { enrichInstallment } from '../loans/installments/enrichInstallment';
import { calculateDaysUntilDue } from '../loans/installments/installmentCalculations';

import { AccountSummaryInstallmentForMessage } from './messageRenderer';

// Phase 34 — backs "Ver mis cuotas" / "Estado de cuenta" / "Cuotas
// pendientes": one shared breakdown of every pending installment (overdue
// or not) across a client's active loans. Adapted from the deleted
// AccountSummaryService's gatherPendingInstallments (Phase 9, retired
// outright by Phase 33 — see docs/phases/PHASE_33_MESSAGE_TEMPLATES_V2.md);
// same query shape, reused here for the self-service menu instead of a
// standalone message type.
export async function findPendingInstallmentsBreakdown(
  installmentsRepository: Repository<Installment>,
  clientId: string,
): Promise<AccountSummaryInstallmentForMessage[]> {
  const installments = await installmentsRepository.find({
    where: {
      status: InstallmentStatus.Pending,
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
      installmentNumber: installment.installmentNumber,
      promissoryNoteNumber: installment.loan.promissoryNoteNumber,
      totalDue: enriched.totalDue,
      overdueDays: enriched.overdueDays,
      daysUntilDue: calculateDaysUntilDue(new Date(installment.dueDate)),
    };
  });
}

export interface PaymentHistoryEntry {
  installmentNumber: number;
  promissoryNoteNumber: string;
  amountPaid: number;
  paidAt: string;
}

const PAYMENT_HISTORY_LIMIT = 10;

// Backs "Historial de pagos" — most recent payments across a client's
// loans, newest first. Capped at PAYMENT_HISTORY_LIMIT: this renders into a
// single WhatsApp text message, not a paginated view.
export async function findPaymentHistoryForClient(
  paymentsRepository: Repository<Payment>,
  clientId: string,
): Promise<PaymentHistoryEntry[]> {
  const payments = await paymentsRepository.find({
    where: { installment: { loan: { clientId } } },
    relations: { installment: { loan: true } },
    order: { paidAt: 'DESC' },
    take: PAYMENT_HISTORY_LIMIT,
  });

  return payments.map((payment) => ({
    installmentNumber: payment.installment.installmentNumber,
    promissoryNoteNumber: payment.installment.loan.promissoryNoteNumber,
    amountPaid: payment.amountPaid,
    paidAt: payment.paidAt,
  }));
}
