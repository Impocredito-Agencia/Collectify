import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Installment } from '../loans/entities/installment.entity';
import { Loan } from '../loans/entities/loan.entity';
import { LoanInstallmentConcept } from '../loans/entities/loanInstallmentConcept.entity';
import { Payment } from '../loans/entities/payment.entity';
import { MessageLog } from '../whatsapp/entities/messageLog.entity';

import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Loan,
      Installment,
      Payment,
      // Bug fix, 2026-09-08 — gatherOverdueInstallments now needs this to
      // compute each overdue installment's real accrued mora, see that
      // method's own comment.
      LoanInstallmentConcept,
      MessageLog,
    ]),
  ],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
