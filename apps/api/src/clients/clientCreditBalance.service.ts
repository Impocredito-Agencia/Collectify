import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Installment } from '../loans/entities/installment.entity';
import { Loan } from '../loans/entities/loan.entity';

import {
  ClientCreditLedgerEntry,
  ClientCreditLedgerEntryType,
} from './entities/clientCreditLedgerEntry.entity';

// Human report, 2026-09-14 — see ClientCreditLedgerEntry's own comment.
// Pure ledger bookkeeping: this service never creates a Payment itself
// (that stays InstallmentsService's job, via registerPayment) — it only
// tracks credit created/applied and validates an apply request before
// InstallmentsService acts on it. Kept in `clients/`, not `loans/`, since
// a client's credit balance is deliberately usable against ANY of their
// loans, not scoped to one — LoansModule already imports ClientsModule
// (one-directional), so InstallmentsService can inject this directly with
// no circular dependency.
@Injectable()
export class ClientCreditBalanceService {
  constructor(
    @InjectRepository(ClientCreditLedgerEntry)
    private readonly ledgerRepository: Repository<ClientCreditLedgerEntry>,
    @InjectRepository(Installment)
    private readonly installmentsRepository: Repository<Installment>,
    @InjectRepository(Loan)
    private readonly loansRepository: Repository<Loan>,
  ) {}

  // Created entries add to the balance, Applied entries subtract — see the
  // entity's own comment for why this is summed live rather than stored as
  // a single mutable running total.
  async getBalance(clientId: string): Promise<number> {
    const entries = await this.ledgerRepository.find({ where: { clientId } });
    return entries.reduce(
      (balance, entry) =>
        entry.type === ClientCreditLedgerEntryType.Created
          ? balance + entry.amount
          : balance - entry.amount,
      0,
    );
  }

  // Called from InstallmentsService.registerPayment whenever a payment
  // (cash or itself funded by an earlier credit application — see that
  // method's own comment on why the latter is correct, not recursive
  // nonsense) exceeds what its installment actually owed.
  async recordExcess(
    clientId: string,
    sourcePaymentId: string,
    amount: number,
  ): Promise<void> {
    await this.ledgerRepository.save(
      this.ledgerRepository.create({
        clientId,
        type: ClientCreditLedgerEntryType.Created,
        amount,
        sourcePaymentId,
      }),
    );
  }

  // Called from InstallmentsService.applyCreditToInstallment right after
  // the resulting Payment is created — see that method's own comment.
  async recordApplication(
    clientId: string,
    resultingPaymentId: string,
    amount: number,
  ): Promise<void> {
    await this.ledgerRepository.save(
      this.ledgerRepository.create({
        clientId,
        type: ClientCreditLedgerEntryType.Applied,
        amount,
        resultingPaymentId,
      }),
    );
  }

  // Validated BEFORE InstallmentsService.registerPayment ever runs, so a
  // request that fails these checks never creates a Payment row at all.
  // Deliberately does NOT check the installment's own remaining balance —
  // registerPayment's existing ceiling already caps that correctly (and,
  // if the applied amount turns out to exceed what the cuota needed, its
  // own excess-handling recycles the leftover right back into a fresh
  // credit — see that method's own comment), so duplicating it here would
  // just be two places that could disagree.
  async assertCanApply(
    clientId: string,
    installmentId: string,
    amount: number,
  ): Promise<void> {
    if (!(amount > 0)) {
      throw new BadRequestException('El monto a aplicar debe ser mayor a 0.');
    }

    const installment = await this.installmentsRepository.findOneBy({
      id: installmentId,
    });
    if (!installment) {
      throw new NotFoundException(
        `Installment with id ${installmentId} not found`,
      );
    }

    const loan = await this.loansRepository.findOneBy({
      id: installment.loanId,
    });
    if (!loan || loan.clientId !== clientId) {
      throw new BadRequestException('Esta cuota no pertenece a este cliente.');
    }

    const balance = await this.getBalance(clientId);
    if (amount > balance) {
      throw new BadRequestException(
        `El saldo a favor disponible ($${balance}) es menor al monto solicitado ($${amount}).`,
      );
    }
  }
}
