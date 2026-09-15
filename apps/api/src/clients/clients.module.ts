import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Installment } from '../loans/entities/installment.entity';
import { Loan } from '../loans/entities/loan.entity';
import { LoanInstallmentConcept } from '../loans/entities/loanInstallmentConcept.entity';
import { Payment } from '../loans/entities/payment.entity';

import { ClientCreditBalanceService } from './clientCreditBalance.service';
import { ClientsController } from './clients.controller';
import { ClientsService } from './clients.service';
import { Client } from './entities/client.entity';
import { ClientCreditLedgerEntry } from './entities/clientCreditLedgerEntry.entity';
import { ClientMessageFrequency } from './entities/clientMessageFrequency.entity';
import { ClientReference } from './entities/clientReference.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Client,
      Loan,
      Installment,
      // Bug fix, 2026-09-07 — ClientsService.enrichActiveInstallments now
      // needs this to compute each installment's actual remaining balance
      // (creditUsed/creditAvailable/isMoraBlocked), see that method's own
      // comment.
      Payment,
      // Bug fix, 2026-09-08 — enrichActiveInstallments was passing `[]`
      // instead of an installment's real moratory concepts, silently
      // reporting $0 mora (and therefore an inflated creditAvailable) for
      // every loan created since the Phase 23 redesign. See that method's
      // own comment and docs/DATABASE.md's note of this date.
      LoanInstallmentConcept,
      ClientReference,
      ClientMessageFrequency,
      // Human report, 2026-09-14 — ClientCreditBalanceService's own ledger.
      ClientCreditLedgerEntry,
    ]),
  ],
  controllers: [ClientsController],
  providers: [ClientsService, ClientCreditBalanceService],
  // ClientCreditBalanceService exported so InstallmentsService (LoansModule,
  // which already imports ClientsModule) can inject it directly — see that
  // service's own comment on why this stays one-directional.
  exports: [ClientsService, ClientCreditBalanceService],
})
export class ClientsModule {}
