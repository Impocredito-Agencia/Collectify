import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThanOrEqual, Repository } from 'typeorm';

import {
  Installment,
  InstallmentStatus,
} from '../loans/entities/installment.entity';
import { LoanStatus } from '../loans/entities/loan.entity';
import { LoanInstallmentConcept } from '../loans/entities/loanInstallmentConcept.entity';
import { Payment } from '../loans/entities/payment.entity';
import { bogotaEndOfDayUtc, todayDateString } from '../loans/dueDateSchedule';
import { findConceptsByInstallmentId } from '../loans/installments/conceptsByInstallmentId';
import { enrichInstallment } from '../loans/installments/enrichInstallment';
import { calculateDaysUntilDue } from '../loans/installments/installmentCalculations';

export interface ClientBreakdownInstallment {
  installmentId: string;
  loanId: string;
  promissoryNoteNumber: string;
  installmentNumber: number;
  dueDate: string;
  // The cuota's own value, before recargos and abonos.
  amount: number;
  // Mora accrued up to the requested day.
  interest: number;
  // Abonos (and mora forgiven) dated on or before the requested day.
  paidByDate: number;
  // What was still owed on this cuota that day.
  totalDue: number;
  overdueDays: number;
  daysUntilDue: number;
}

export interface ClientBreakdown {
  date: string;
  installments: ClientBreakdownInstallment[];
  // Sum of totalDue over the cuotas already overdue or due that very day —
  // the same "valor a pagar hoy" rule the client-facing desglose uses (see
  // calculateAccountSummaryTotal).
  totalPayableOnDate: number;
}

// Human report, 2026-10-09 — "los clientes mandan comprobantes viejos …
// quieren ver ese día cómo estaban desglosadas las cuotas con valores
// exactos". Mora grows every day, so by the time a week-old comprobante
// reaches the inbox, today's figures no longer match what the client
// actually owed (and paid) on the day of the transfer.
//
// Read-only: values the client's installments as they stood at the end of
// a past Bogotá calendar day. Scope is deliberately the cuotas that are
// STILL pending today — the ones a late comprobante can still be applied
// to — valued with that day's overdue days/recargos and only the abonos
// dated on or before it. A cuota already paid in full today isn't listed,
// and neither is one from a pagaré disbursed after that day.
@Injectable()
export class ClientBreakdownService {
  constructor(
    @InjectRepository(Installment)
    private readonly installmentsRepository: Repository<Installment>,
    @InjectRepository(Payment)
    private readonly paymentsRepository: Repository<Payment>,
    @InjectRepository(LoanInstallmentConcept)
    private readonly loanInstallmentConceptsRepository: Repository<LoanInstallmentConcept>,
  ) {}

  async getBreakdownAsOf(
    clientId: string,
    date: string,
    today: string = todayDateString(),
  ): Promise<ClientBreakdown> {
    // Plain string comparison is safe: both are zero-padded YYYY-MM-DD.
    if (date > today) {
      throw new BadRequestException(
        'La fecha del desglose no puede ser posterior a hoy.',
      );
    }

    const pendingInstallments = await this.installmentsRepository.find({
      where: {
        status: InstallmentStatus.Pending,
        loan: { clientId, status: LoanStatus.Active },
      },
      relations: { loan: true },
      order: { dueDate: 'ASC', installmentNumber: 'ASC' },
    });
    const installments = pendingInstallments.filter(
      (installment) => installment.loan.disbursedAt <= date,
    );
    const installmentIds = installments.map((installment) => installment.id);

    const paidByDateByInstallmentId = await this.sumPaymentsUpTo(
      installmentIds,
      date,
    );
    const conceptsByInstallmentId = await findConceptsByInstallmentId(
      this.loanInstallmentConceptsRepository,
      installmentIds,
    );

    // Any instant inside that Bogotá day yields the same whole-day math —
    // see calculateOverdueDays.
    const asOf = bogotaEndOfDayUtc(date);
    const breakdownInstallments = installments.map((installment) => {
      const paidByDate = paidByDateByInstallmentId.get(installment.id) ?? 0;
      const enriched = enrichInstallment(
        installment,
        conceptsByInstallmentId.get(installment.id) ?? [],
        paidByDate,
        asOf,
      );
      return {
        installmentId: installment.id,
        loanId: installment.loanId,
        promissoryNoteNumber: installment.loan.promissoryNoteNumber,
        installmentNumber: installment.installmentNumber,
        dueDate: installment.dueDate,
        amount: installment.amount,
        interest: enriched.interest,
        paidByDate,
        totalDue: enriched.totalDue,
        overdueDays: enriched.overdueDays,
        daysUntilDue: calculateDaysUntilDue(
          new Date(installment.dueDate),
          asOf,
        ),
      };
    });

    return {
      date,
      installments: breakdownInstallments,
      totalPayableOnDate: breakdownInstallments
        .filter((item) => item.overdueDays > 0 || item.daysUntilDue === 0)
        .reduce((sum, item) => sum + item.totalDue, 0),
    };
  }

  // Same sum as sumPaymentsByInstallmentId (amountPaid + moraWaivedAmount),
  // restricted to payments dated on or before the requested day.
  private async sumPaymentsUpTo(
    installmentIds: string[],
    date: string,
  ): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    if (installmentIds.length === 0) {
      return map;
    }

    const payments = await this.paymentsRepository.find({
      where: {
        installmentId: In(installmentIds),
        paidAt: LessThanOrEqual(date),
      },
      select: { installmentId: true, amountPaid: true, moraWaivedAmount: true },
    });
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
}
