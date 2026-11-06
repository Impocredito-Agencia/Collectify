import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';

import { ClientCreditBalanceService } from '../../clients/clientCreditBalance.service';
import { formatPromissoryNoteLabel } from '../../common/promissoryNoteLabel';
import { Installment } from '../entities/installment.entity';
import { Loan, LoanStatus } from '../entities/loan.entity';
import { LoanInstallmentConcept } from '../entities/loanInstallmentConcept.entity';
import { Payment } from '../entities/payment.entity';
import { enrichInstallment } from '../installments/enrichInstallment';
import { sumPaymentsByInstallmentId } from '../installments/paymentTotals';

import { DeleteLoanDto } from './dto/deleteLoan.dto';
import { buildLoanDeletionSnapshot } from './loanDeletionSnapshot';
import { matchesPromissoryNoteNumber } from './promissoryNoteNumberMatch';

// What GET /loans/:id/deletion-preview returns — everything the panel's
// step 1 shows before the admin types the number to confirm.
export interface LoanDeletionPreview {
  loanId: string;
  // The CURRENT number — the one the admin must type (see
  // matchesPromissoryNoteNumber). Read fresh every time, so a renumber done
  // since the page loaded is already reflected.
  promissoryNoteNumber: string;
  clientId: string;
  clientFullName: string;
  // The earlier loans of its refinance chain, deleted together with it.
  chainLoans: { id: string; promissoryNoteNumber: string }[];
  installmentCount: number;
  // Non-voided payments only — the ones this deletion voids.
  paymentCount: number;
  paymentsTotal: number;
  // Saldo a favor given back to the client (payments funded by credit).
  creditToRestore: number;
  // Saldo a favor taken back (payments that left an excess).
  creditToReverse: number;
  // Why it can't be deleted right now, in Spanish, ready to show. Empty
  // means it can.
  blockers: string[];
}

// Everything a deletion touches, gathered once and shared by preview() and
// delete() so the two can never disagree.
interface DeletionScope {
  loan: Loan;
  chain: Loan[];
  installments: Installment[];
  payments: Payment[];
  creditToRestore: number;
  creditToReverse: number;
  blockers: string[];
}

const LOAN_STATUS_LABELS: Record<LoanStatus, string> = {
  [LoanStatus.Active]: 'activo',
  [LoanStatus.Paid]: 'pagado',
  [LoanStatus.Refinanced]: 'refinanciado',
};

// Phase 35 — irreversible loan deletion with an audit trail. See
// docs/phases/PHASE_35_LOAN_DELETION.md for every rule implemented here;
// kept out of LoansService (already the largest file in the api) since it's
// one self-contained flow.
@Injectable()
export class LoanDeletionService {
  constructor(
    @InjectRepository(Payment)
    private readonly paymentsRepository: Repository<Payment>,
    private readonly clientCreditBalanceService: ClientCreditBalanceService,
    private readonly dataSource: DataSource,
  ) {}

  async preview(id: string): Promise<LoanDeletionPreview> {
    const scope = await this.collectScope(id, this.dataSource.manager);
    const loan = scope.loan;
    return {
      loanId: loan.id,
      promissoryNoteNumber: loan.promissoryNoteNumber,
      clientId: loan.clientId,
      clientFullName: loan.client
        ? `${loan.client.firstName} ${loan.client.lastName}`
        : '',
      chainLoans: scope.chain.slice(1).map((chainLoan) => ({
        id: chainLoan.id,
        promissoryNoteNumber: chainLoan.promissoryNoteNumber,
      })),
      installmentCount: scope.installments.length,
      paymentCount: scope.payments.length,
      paymentsTotal: scope.payments.reduce(
        (sum, payment) => sum + payment.amountPaid,
        0,
      ),
      creditToRestore: scope.creditToRestore,
      creditToReverse: scope.creditToReverse,
      blockers: scope.blockers,
    };
  }

  // One transaction: a failure anywhere (most likely the saldo a favor
  // check, re-run here against the state at this exact moment) leaves the
  // loan, its payments and the client's credit completely untouched.
  async delete(
    id: string,
    dto: DeleteLoanDto,
    actorUserId: string,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager: EntityManager) => {
      // Locks the row so two admins can't delete (or a payment flow can't
      // race) the same loan at once.
      const locked = await manager.getRepository(Loan).findOne({
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!locked) {
        throw new NotFoundException(`Loan with id ${id} not found`);
      }
      if (
        !matchesPromissoryNoteNumber(
          dto.confirmPromissoryNoteNumber,
          locked.promissoryNoteNumber,
        )
      ) {
        throw new BadRequestException(
          `El número escrito no coincide con el número actual de este pagaré (${formatPromissoryNoteLabel(locked.promissoryNoteNumber)}). Si lo cambiaron hace poco, cierra y vuelve a intentarlo.`,
        );
      }

      const scope = await this.collectScope(id, manager);
      if (scope.blockers.length > 0) {
        throw new ConflictException(scope.blockers.join(' '));
      }

      const deletedAt = new Date();
      await this.storeDeletionRecord(scope, dto.reason, actorUserId, manager);
      await this.voidPayments(scope.payments, dto.reason, deletedAt, manager);

      const loanIds = scope.chain.map((chainLoan) => chainLoan.id);
      await manager
        .getRepository(Installment)
        .softDelete({ loanId: In(loanIds) });
      await manager.getRepository(Loan).softDelete({ id: In(loanIds) });
    });
  }

  private async collectScope(
    id: string,
    manager: EntityManager,
  ): Promise<DeletionScope> {
    const loansRepository = manager.getRepository(Loan);
    const loan = await loansRepository.findOne({
      where: { id },
      relations: { client: true },
    });
    if (!loan) {
      throw new NotFoundException(`Loan with id ${id} not found`);
    }

    const blockers: string[] = [];
    if (loan.status !== LoanStatus.Active) {
      blockers.push(await this.describeInactiveLoan(loan, loansRepository));
    }

    const chain = await this.findChain(loan, loansRepository);
    const installments = await manager.getRepository(Installment).find({
      where: { loanId: In(chain.map((chainLoan) => chainLoan.id)) },
      order: { installmentNumber: 'ASC' },
    });
    const payments =
      installments.length === 0
        ? []
        : await manager.getRepository(Payment).find({
            where: {
              installmentId: In(
                installments.map((installment) => installment.id),
              ),
            },
            order: { paidAt: 'ASC' },
          });

    const creditByPaymentId =
      await this.clientCreditBalanceService.summarizeCreditByPaymentId(
        payments.map((payment) => payment.id),
      );
    let creditToRestore = 0;
    let creditToReverse = 0;
    for (const { spent, generated } of creditByPaymentId.values()) {
      creditToRestore += Math.max(0, spent);
      creditToReverse += Math.max(0, generated);
    }

    if (creditToReverse > 0) {
      const balance = await this.clientCreditBalanceService.getBalance(
        loan.clientId,
        manager,
      );
      // voidPayments() restores before it reverses, so credit this same
      // deletion gives back counts toward what it then takes back.
      if (balance + creditToRestore < creditToReverse) {
        blockers.push(
          await this.describeSpentCredit(
            loan.clientId,
            payments.map((payment) => payment.id),
            creditToReverse,
            balance + creditToRestore,
          ),
        );
      }
    }

    return {
      loan,
      chain,
      installments,
      payments,
      creditToRestore,
      creditToReverse,
      blockers,
    };
  }

  // The loan plus every earlier loan it was refinanced from, newest first.
  // Never revives any of them — see the phase doc's point 4.
  private async findChain(
    loan: Loan,
    loansRepository: Repository<Loan>,
  ): Promise<Loan[]> {
    const chain = [loan];
    let previousId = loan.refinancedFromLoanId;
    while (
      previousId &&
      !chain.some((chainLoan) => chainLoan.id === previousId)
    ) {
      const previous = await loansRepository.findOneBy({ id: previousId });
      if (!previous) {
        break;
      }
      chain.push(previous);
      previousId = previous.refinancedFromLoanId;
    }
    return chain;
  }

  private async describeInactiveLoan(
    loan: Loan,
    loansRepository: Repository<Loan>,
  ): Promise<string> {
    if (loan.status === LoanStatus.Refinanced) {
      // Walk forward to the loan that replaced it, so the message names the
      // pagaré the admin should delete instead.
      let current = loan;
      for (let hops = 0; hops < 50; hops += 1) {
        const next = await loansRepository.findOneBy({
          refinancedFromLoanId: current.id,
        });
        if (!next) {
          break;
        }
        current = next;
      }
      return current.id === loan.id
        ? 'Un pagaré refinanciado no se puede eliminar por separado.'
        : `Un pagaré refinanciado no se puede eliminar por separado: se elimina junto con el pagaré que lo reemplazó (${formatPromissoryNoteLabel(current.promissoryNoteNumber)}).`;
    }
    return `Solo se puede eliminar un pagaré activo. Este pagaré está ${LOAN_STATUS_LABELS[loan.status]}.`;
  }

  private async describeSpentCredit(
    clientId: string,
    paymentIds: string[],
    creditToReverse: number,
    available: number,
  ): Promise<string> {
    const draws = await this.clientCreditBalanceService.findCreditDrawsOutside(
      clientId,
      paymentIds,
    );
    const appliedPaymentIds = draws
      .map((draw) => draw.resultingPaymentId)
      .filter((paymentId): paymentId is string => paymentId !== null);
    const appliedPayments =
      appliedPaymentIds.length === 0
        ? []
        : await this.paymentsRepository.find({
            where: { id: In(appliedPaymentIds) },
            relations: { installment: { loan: true } },
          });
    const paymentById = new Map(
      appliedPayments.map((payment) => [payment.id, payment]),
    );

    const uses = draws.map((draw) => {
      const amount = formatCop(draw.amount);
      if (draw.type === 'refunded') {
        return `devolución en efectivo del ${formatDay(draw.createdAt)} (${amount})`;
      }
      const payment = paymentById.get(draw.resultingPaymentId ?? '');
      return payment
        ? `cuota ${payment.installment.installmentNumber} del pagaré ${formatPromissoryNoteLabel(payment.installment.loan.promissoryNoteNumber)} (${amount})`
        : `un pago de ${amount}`;
    });

    return (
      `Los pagos de este pagaré dejaron ${formatCop(creditToReverse)} de saldo a favor, pero al cliente solo le quedan ${formatCop(available)}: el resto ya se usó` +
      (uses.length > 0 ? ` en: ${uses.join('; ')}.` : '.') +
      ' Anula primero esos pagos (o revisa la devolución) y vuelve a intentarlo.'
    );
  }

  // Freezes each loan's cuotas as they look right now (mora included) and
  // records who deleted it and why — before anything is voided, so the
  // snapshot still reflects what had been paid.
  private async storeDeletionRecord(
    scope: DeletionScope,
    reason: string,
    actorUserId: string,
    manager: EntityManager,
  ): Promise<void> {
    const conceptsByInstallmentId = new Map<string, LoanInstallmentConcept[]>();
    if (scope.installments.length > 0) {
      const concepts = await manager
        .getRepository(LoanInstallmentConcept)
        .find({
          where: {
            installmentId: In(
              scope.installments.map((installment) => installment.id),
            ),
          },
        });
      for (const concept of concepts) {
        conceptsByInstallmentId.set(concept.installmentId, [
          ...(conceptsByInstallmentId.get(concept.installmentId) ?? []),
          concept,
        ]);
      }
    }
    const totalPaidByInstallmentId = await sumPaymentsByInstallmentId(
      manager.getRepository(Payment),
      scope.installments.map((installment) => installment.id),
    );

    const takenAt = new Date();
    for (const chainLoan of scope.chain) {
      const enriched = scope.installments
        .filter((installment) => installment.loanId === chainLoan.id)
        .map((installment) =>
          enrichInstallment(
            installment,
            conceptsByInstallmentId.get(installment.id) ?? [],
            totalPaidByInstallmentId.get(installment.id) ?? 0,
            takenAt,
          ),
        );
      await manager.getRepository(Loan).update(
        { id: chainLoan.id },
        {
          deletedByUserId: actorUserId,
          deletionReason: reason,
          deletionSnapshot: buildLoanDeletionSnapshot(
            enriched,
            totalPaidByInstallmentId,
            takenAt,
          ),
        },
      );
    }
  }

  // Same bookkeeping as InstallmentsService.voidPayment, minus reopening
  // the installment (it's being deleted). Every payment is marked voided
  // first, then every credit spent is restored, then every credit
  // generated is reversed — restoring first so a credit generated and
  // spent within this same pagaré nets out instead of being refused.
  private async voidPayments(
    payments: Payment[],
    reason: string,
    deletedAt: Date,
    manager: EntityManager,
  ): Promise<void> {
    if (payments.length === 0) {
      return;
    }
    await manager
      .getRepository(Payment)
      .update(
        { id: In(payments.map((payment) => payment.id)) },
        { deletedAt, voidReason: `Pagaré eliminado: ${reason}` },
      );
    for (const payment of payments) {
      await this.clientCreditBalanceService.restoreCreditSpentBy(
        payment.id,
        manager,
      );
    }
    for (const payment of payments) {
      await this.clientCreditBalanceService.reverseCreditGeneratedBy(
        payment.id,
        manager,
      );
    }
  }
}

function formatCop(amount: number): string {
  return `$${Math.round(amount).toLocaleString('es-CO')}`;
}

// "05/11/2026" — Bogotá's calendar day, not the server's.
function formatDay(instant: Date): string {
  return instant.toLocaleDateString('es-CO', {
    timeZone: 'America/Bogota',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}
