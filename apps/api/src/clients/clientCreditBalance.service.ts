import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';

import { Installment } from '../loans/entities/installment.entity';
import { Loan } from '../loans/entities/loan.entity';

import { Client } from './entities/client.entity';
import {
  ClientCreditLedgerEntry,
  ClientCreditLedgerEntryType,
} from './entities/clientCreditLedgerEntry.entity';

// The direction each movement moves the balance: Created and Restored give
// the client credit, everything else takes it away.
function signedAmount(entry: ClientCreditLedgerEntry): number {
  return entry.type === ClientCreditLedgerEntryType.Created ||
    entry.type === ClientCreditLedgerEntryType.Restored
    ? entry.amount
    : -entry.amount;
}

// One use of a client's saldo a favor — see findCreditDrawsOutside.
export interface CreditDraw {
  type: 'applied' | 'refunded';
  amount: number;
  // The payment the credit paid for; null for a cash refund.
  resultingPaymentId: string | null;
  createdAt: Date;
}

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
    private readonly dataSource: DataSource,
  ) {}

  // `manager` lets a caller that is already inside a transaction (voiding a
  // payment) read and write the ledger as part of it.
  private ledger(manager?: EntityManager): Repository<ClientCreditLedgerEntry> {
    return manager
      ? manager.getRepository(ClientCreditLedgerEntry)
      : this.ledgerRepository;
  }

  // Serializes concurrent refunds/reversals for one client, so two of them
  // can't both pass the "is there enough balance?" check and overspend it.
  // withDeleted: a deactivated client's credit is still theirs to be
  // refunded.
  private async lockClient(
    clientId: string,
    manager: EntityManager,
  ): Promise<void> {
    const client = await manager.getRepository(Client).findOne({
      where: { id: clientId },
      withDeleted: true,
      lock: { mode: 'pessimistic_write' },
    });
    if (!client) {
      throw new NotFoundException(`Client with id ${clientId} not found`);
    }
  }

  // Created/Restored entries add to the balance, Applied/Refunded/Reversed
  // subtract — see the entity's own comment for why this is summed live
  // rather than stored as a single mutable running total.
  async getBalance(clientId: string, manager?: EntityManager): Promise<number> {
    const entries = await this.ledger(manager).find({ where: { clientId } });
    return entries.reduce((balance, entry) => balance + signedAmount(entry), 0);
  }

  // Human request, 2026-09-26 — "devolver al cliente": records that cash from
  // the client's saldo a favor was handed back to them. Can never exceed the
  // balance. The only way to take a credit off the books other than spending
  // it — deliberately not a "discard", since that money is the client's.
  async refund(
    clientId: string,
    amount: number,
    reason?: string,
  ): Promise<{ balance: number }> {
    if (!(amount > 0)) {
      throw new BadRequestException('El monto a devolver debe ser mayor a 0.');
    }
    return this.dataSource.transaction(async (manager) => {
      await this.lockClient(clientId, manager);
      const balance = await this.getBalance(clientId, manager);
      if (amount > balance) {
        throw new BadRequestException(
          `El saldo a favor disponible ($${balance}) es menor al monto a devolver ($${amount}).`,
        );
      }
      const ledger = this.ledger(manager);
      await ledger.save(
        ledger.create({
          clientId,
          type: ClientCreditLedgerEntryType.Refunded,
          amount,
          note: reason?.trim() || null,
        }),
      );
      return { balance: balance - amount };
    });
  }

  // Human request, 2026-09-26 — called from InstallmentsService.voidPayment,
  // inside its transaction. Voiding a payment that GENERATED credit (an
  // excess the client handed over) annuls the whole receipt, so that credit
  // is taken back too. Refused, rolling the void back, when the client no
  // longer has that much available — part of it was already applied to other
  // cuotas (or refunded), and taking it back would leave the balance
  // negative: the admin must undo those first.
  async reverseCreditGeneratedBy(
    paymentId: string,
    manager: EntityManager,
  ): Promise<void> {
    const ledger = this.ledger(manager);
    const entries = await ledger.find({
      where: { sourcePaymentId: paymentId },
    });
    const generated = entries
      .filter((entry) => entry.type === ClientCreditLedgerEntryType.Created)
      .reduce((sum, entry) => sum + entry.amount, 0);
    const alreadyReversed = entries
      .filter((entry) => entry.type === ClientCreditLedgerEntryType.Reversed)
      .reduce((sum, entry) => sum + entry.amount, 0);
    const toReverse = generated - alreadyReversed;
    if (!(toReverse > 0)) {
      return;
    }

    const clientId = entries[0].clientId;
    await this.lockClient(clientId, manager);
    const balance = await this.getBalance(clientId, manager);
    if (balance < toReverse) {
      throw new BadRequestException(
        `Este pago generó $${toReverse} de saldo a favor, pero al cliente solo le quedan $${balance} disponibles: el resto ya se aplicó a otras cuotas o se le devolvió. Anula primero esos pagos aplicados (o revisa la devolución) y vuelve a intentarlo.`,
      );
    }
    await ledger.save(
      ledger.create({
        clientId,
        type: ClientCreditLedgerEntryType.Reversed,
        amount: toReverse,
        sourcePaymentId: paymentId,
        note: 'Se anuló el pago que generó este saldo a favor.',
      }),
    );
  }

  // Human request, 2026-09-26 — the mirror image, also called from
  // voidPayment: voiding a payment that was FUNDED by credit
  // (applyCreditToInstallment) gives the credit it spent back to the client,
  // since no cash ever backed that payment.
  async restoreCreditSpentBy(
    paymentId: string,
    manager: EntityManager,
  ): Promise<void> {
    const ledger = this.ledger(manager);
    const entries = await ledger.find({
      where: { resultingPaymentId: paymentId },
    });
    const spent = entries
      .filter((entry) => entry.type === ClientCreditLedgerEntryType.Applied)
      .reduce((sum, entry) => sum + entry.amount, 0);
    const alreadyRestored = entries
      .filter((entry) => entry.type === ClientCreditLedgerEntryType.Restored)
      .reduce((sum, entry) => sum + entry.amount, 0);
    const toRestore = spent - alreadyRestored;
    if (!(toRestore > 0)) {
      return;
    }
    await ledger.save(
      ledger.create({
        clientId: entries[0].clientId,
        type: ClientCreditLedgerEntryType.Restored,
        amount: toRestore,
        resultingPaymentId: paymentId,
        note: 'Se anuló el pago cubierto con este saldo a favor.',
      }),
    );
  }

  // Per payment: how much saldo a favor it generated that is still standing,
  // and how much it spent — what the void dialog needs to warn about before
  // the admin confirms. Net of any reversal/restoration already recorded.
  async summarizeCreditByPaymentId(
    paymentIds: string[],
  ): Promise<Map<string, { generated: number; spent: number }>> {
    const summary = new Map<string, { generated: number; spent: number }>();
    if (paymentIds.length === 0) {
      return summary;
    }
    const entries = await this.ledgerRepository.find({
      where: [
        { sourcePaymentId: In(paymentIds) },
        { resultingPaymentId: In(paymentIds) },
      ],
    });
    const slot = (paymentId: string) => {
      let value = summary.get(paymentId);
      if (!value) {
        value = { generated: 0, spent: 0 };
        summary.set(paymentId, value);
      }
      return value;
    };
    for (const entry of entries) {
      if (entry.sourcePaymentId) {
        if (entry.type === ClientCreditLedgerEntryType.Created) {
          slot(entry.sourcePaymentId).generated += entry.amount;
        } else if (entry.type === ClientCreditLedgerEntryType.Reversed) {
          slot(entry.sourcePaymentId).generated -= entry.amount;
        }
      }
      if (entry.resultingPaymentId) {
        if (entry.type === ClientCreditLedgerEntryType.Applied) {
          slot(entry.resultingPaymentId).spent += entry.amount;
        } else if (entry.type === ClientCreditLedgerEntryType.Restored) {
          slot(entry.resultingPaymentId).spent -= entry.amount;
        }
      }
    }
    return summary;
  }

  // Phase 35 — everything else that drew on a client's saldo a favor
  // besides `paymentIds`: still-standing applications to OTHER payments
  // (net of any restoration) and cash refunds. Read-only. When deleting a
  // pagaré would take back credit the client no longer has, these are the
  // places the admin has to look — see LoanDeletionService's blocker.
  async findCreditDrawsOutside(
    clientId: string,
    paymentIds: string[],
  ): Promise<CreditDraw[]> {
    const excluded = new Set(paymentIds);
    const entries = await this.ledgerRepository.find({
      where: { clientId },
      order: { createdAt: 'ASC' },
    });

    const appliedByPaymentId = new Map<
      string,
      { amount: number; createdAt: Date }
    >();
    const draws: CreditDraw[] = [];
    for (const entry of entries) {
      if (entry.type === ClientCreditLedgerEntryType.Refunded) {
        draws.push({
          type: 'refunded',
          amount: entry.amount,
          resultingPaymentId: null,
          createdAt: entry.createdAt,
        });
        continue;
      }
      const paymentId = entry.resultingPaymentId;
      if (!paymentId || excluded.has(paymentId)) {
        continue;
      }
      const current = appliedByPaymentId.get(paymentId) ?? {
        amount: 0,
        createdAt: entry.createdAt,
      };
      if (entry.type === ClientCreditLedgerEntryType.Applied) {
        current.amount += entry.amount;
      } else if (entry.type === ClientCreditLedgerEntryType.Restored) {
        current.amount -= entry.amount;
      }
      appliedByPaymentId.set(paymentId, current);
    }
    for (const [paymentId, { amount, createdAt }] of appliedByPaymentId) {
      if (amount > 0) {
        draws.push({
          type: 'applied',
          amount,
          resultingPaymentId: paymentId,
          createdAt,
        });
      }
    }
    return draws.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
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
