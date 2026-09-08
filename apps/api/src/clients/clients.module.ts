import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Installment } from '../loans/entities/installment.entity';
import { Loan } from '../loans/entities/loan.entity';
import { Payment } from '../loans/entities/payment.entity';

import { ClientsController } from './clients.controller';
import { ClientsService } from './clients.service';
import { Client } from './entities/client.entity';
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
      ClientReference,
      ClientMessageFrequency,
    ]),
  ],
  controllers: [ClientsController],
  providers: [ClientsService],
  exports: [ClientsService],
})
export class ClientsModule {}
