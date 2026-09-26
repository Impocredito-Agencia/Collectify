import { In, Repository } from 'typeorm';

import { Payment } from '../entities/payment.entity';

// Bug fix, 2026-09-07 — shared by every caller that needs "how much has
// actually been paid on this installment so far" (see
// enrichInstallment.ts's new `totalPaid` parameter). Extracted here instead
// of duplicated per caller because the same batched-by-installmentId shape
// is now needed in loans.service.ts, installments.service.ts,
// clients.service.ts, dashboard.service.ts, and two whatsapp query modules —
// see docs/DATABASE.md's note of this date for the full list of places this
// closes the gap in.
//
// One query for N installments (not N queries), same convention as
// findConceptsByInstallmentId in loans.service.ts/installments.service.ts.
export async function sumPaymentsByInstallmentId(
  paymentsRepository: Repository<Payment>,
  installmentIds: string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (installmentIds.length === 0) {
    return map;
  }

  const payments = await paymentsRepository.find({
    where: { installmentId: In(installmentIds) },
    select: { installmentId: true, amountPaid: true, moraWaivedAmount: true },
  });

  // amountPaid plus any mora forgiven together with the payment
  // (Payment.moraWaivedAmount, 2026-09-25) — both reduce what is still owed,
  // which is what every caller of this helper nets. Cash-collected figures
  // must read amountPaid directly, never this.
  for (const payment of payments) {
    map.set(
      payment.installmentId,
      (map.get(payment.installmentId) ?? 0) +
        payment.amountPaid +
        (payment.moraWaivedAmount ?? 0),
    );
  }

  return map;
}
