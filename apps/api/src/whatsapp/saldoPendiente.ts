// "Saldo pendiente" for the reminder templates' nota adicional (Templates
// 4-8) — the sum, across a client's overdue/upcoming installments included
// in one reminder, of any partial payment already registered that didn't
// fully cover that installment (still Pending, per
// docs/phases/PHASE_33_MESSAGE_TEMPLATES_V2.md's "nota adicional"
// mechanism). Derived directly from existing Payment rows — nothing new is
// stored. "Saldo a favor" is NOT computed here — an overpayment marks its
// installment Paid immediately (installments.service.ts), so it never
// shows up among the Pending installments a reminder is about; detecting a
// lingering unclaimed credit would need its own design and is left as
// Normal for now, see the phase doc.
export interface InstallmentForSaldoPendiente {
  id: string;
  amount: number;
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
    const gap = installment.amount - paid;
    return paid > 0 && gap > 0 ? total + gap : total;
  }, 0);
}
