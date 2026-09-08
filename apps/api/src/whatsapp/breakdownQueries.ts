import { In, Repository } from 'typeorm';

import {
  Installment,
  InstallmentStatus,
} from '../loans/entities/installment.entity';
import { LoanStatus } from '../loans/entities/loan.entity';
import { Payment } from '../loans/entities/payment.entity';
import { enrichInstallment } from '../loans/installments/enrichInstallment';
import { calculateDaysUntilDue } from '../loans/installments/installmentCalculations';
import { sumPaymentsByInstallmentId } from '../loans/installments/paymentTotals';

import { AccountSummaryInstallmentForMessage } from './messageRenderer';

function toAccountSummaryInstallment(
  installment: Installment,
  totalPaid: number,
): AccountSummaryInstallmentForMessage {
  const enriched = enrichInstallment(
    installment,
    installment.loan.interestRate,
    [],
    totalPaid,
  );
  return {
    installmentNumber: installment.installmentNumber,
    promissoryNoteNumber: installment.loan.promissoryNoteNumber,
    totalDue: enriched.totalDue,
    overdueDays: enriched.overdueDays,
    daysUntilDue: calculateDaysUntilDue(new Date(installment.dueDate)),
  };
}

// Phase 34 — backs "Ver mis cuotas" / "Estado de cuenta" / "Cuotas
// pendientes": one shared breakdown of every pending installment (overdue
// or not) across a client's active loans. Adapted from the deleted
// AccountSummaryService's gatherPendingInstallments (Phase 9, retired
// outright by Phase 33 — see docs/phases/PHASE_33_MESSAGE_TEMPLATES_V2.md);
// same query shape, reused here for the self-service menu instead of a
// standalone message type.
export async function findPendingInstallmentsBreakdown(
  installmentsRepository: Repository<Installment>,
  paymentsRepository: Repository<Payment>,
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
  // Bug fix, 2026-09-07 — see enrichInstallment.ts's `totalPaid` param:
  // without this, "Ver mis cuotas"/"Estado de cuenta" told the client the
  // full original amount of a cuota they'd already partially paid.
  const totalPaidByInstallmentId = await sumPaymentsByInstallmentId(
    paymentsRepository,
    installments.map((installment) => installment.id),
  );

  return installments.map((installment) =>
    toAccountSummaryInstallment(
      installment,
      totalPaidByInstallmentId.get(installment.id) ?? 0,
    ),
  );
}

// Bug fix, 2026-09-03 (human report): backs "Más información" on a
// reminder template — the client tapped it to ask about the specific
// installment(s) that reminder was actually about, not their whole
// account. Given the exact installment ids a MessageLogItem row recorded
// for that reminder (see SelfServiceMenuService.sendBreakdownForContext),
// returns their CURRENT live state — same enrichment as
// findPendingInstallmentsBreakdown above — rather than replaying the
// snapshot values frozen at send time, since the client may tap the
// button days later and a stale overdue-day count would be wrong.
export async function findInstallmentsBreakdownByIds(
  installmentsRepository: Repository<Installment>,
  paymentsRepository: Repository<Payment>,
  installmentIds: string[],
): Promise<AccountSummaryInstallmentForMessage[]> {
  if (installmentIds.length === 0) {
    return [];
  }

  const installments = await installmentsRepository.find({
    where: { id: In(installmentIds) },
    relations: { loan: true },
    order: { dueDate: 'ASC' },
  });
  // Bug fix, 2026-09-07 — see findPendingInstallmentsBreakdown's identical
  // addition above ("Más información" hits this path, not that one).
  const totalPaidByInstallmentId = await sumPaymentsByInstallmentId(
    paymentsRepository,
    installments.map((installment) => installment.id),
  );

  return installments.map((installment) =>
    toAccountSummaryInstallment(
      installment,
      totalPaidByInstallmentId.get(installment.id) ?? 0,
    ),
  );
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
