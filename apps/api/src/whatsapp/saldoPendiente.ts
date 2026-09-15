// "Saldo pendiente" for the reminder templates' nota adicional (Templates
// 4-8) — the sum, across a client's overdue/upcoming installments included
// in one reminder, of any partial payment already registered that didn't
// fully cover that installment (still Pending, per
// docs/phases/PHASE_33_MESSAGE_TEMPLATES_V2.md's "nota adicional"
// mechanism). Derived directly from existing Payment rows — nothing new is
// stored. "Saldo a favor" is NOT computed here — an overpayment marks its
// installment Paid immediately (installments.service.ts), so it never
// shows up among the Pending installments a reminder is about; that case
// is detected separately, by OverdueReminderService/UpcomingDueReminderService
// reading ClientCreditBalanceService's ledger once this comes back empty
// (human report, 2026-09-14) — see those services' resolveNotaAdicional.
export interface InstallmentForSaldoPendiente {
  id: string;
  amount: number;
  // Bug fix, 2026-09-08 — optional. When present (every OVERDUE installment
  // passed in by OverdueReminderService/UpcomingDueReminderService already
  // has one, via findOverdueInstallmentsForClient's enrichInstallment call),
  // this is used as the gap directly instead of `amount - paid`: it already
  // nets out every payment AND folds in accrued mora (see
  // enrichInstallment.ts's `totalPaid` param), so the note this feeds
  // ("Cuenta con un saldo pendiente de $X") reports the client's real
  // remaining balance, not just the unpaid slice of capital. Left undefined
  // for an UPCOMING (not-yet-due) installment — those never carry a
  // totalDue (see findUpcomingInstallmentsForClient's own doc comment on
  // why that's out of scope) — which falls back to the old `amount - paid`
  // formula below; mora is a non-issue there since nothing is overdue yet.
  totalDue?: number;
}

export interface PaymentForSaldoPendiente {
  installmentId: string;
  amountPaid: number;
}

export function computeSaldoPendiente(
  installments: InstallmentForSaldoPendiente[],
  payments: PaymentForSaldoPendiente[],
): number {
  const paidByInstallmentId = new Map<string, number>();
  for (const payment of payments) {
    paidByInstallmentId.set(
      payment.installmentId,
      (paidByInstallmentId.get(payment.installmentId) ?? 0) +
        payment.amountPaid,
    );
  }

  return installments.reduce((total, installment) => {
    const paid = paidByInstallmentId.get(installment.id) ?? 0;
    // Still gated on paid > 0 regardless of totalDue's presence — an
    // overdue installment with NOTHING paid on it yet already owes its
    // totalDue in full, but that's just ordinary mora, not an "abono
    // incompleto"; this note is specifically for a partial payment that
    // fell short, not for "you haven't paid at all."
    if (paid <= 0) {
      return total;
    }
    const gap = installment.totalDue ?? installment.amount - paid;
    return gap > 0 ? total + gap : total;
  }, 0);
}
