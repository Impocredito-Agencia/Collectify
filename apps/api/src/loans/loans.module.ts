import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ClientsModule } from '../clients/clients.module';
import { InterestConceptTypesModule } from '../interestConceptTypes/interestConceptTypes.module';
import { UsuryRatesModule } from '../usuryRates/usuryRates.module';
import { WhatsappInboundMessage } from '../whatsapp/entities/whatsappInboundMessage.entity';
import { WhatsappModule } from '../whatsapp/whatsapp.module';

import { DeletedLoansService } from './deletion/deletedLoans.service';
import { LoanDeletionService } from './deletion/loanDeletion.service';
import { Installment } from './entities/installment.entity';
import { Loan } from './entities/loan.entity';
import { LoanInstallmentConcept } from './entities/loanInstallmentConcept.entity';
import { Payment } from './entities/payment.entity';
import { PaymentImage } from './entities/paymentImage.entity';
import { InstallmentsController } from './installments/installments.controller';
import { InstallmentsService } from './installments/installments.service';
import { LoansController } from './loans.controller';
import { LoansService } from './loans.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Loan,
      Installment,
      Payment,
      PaymentImage,
      LoanInstallmentConcept,
      // InstallmentsService.linkSourceWhatsappMessageSafely — the
      // "Registrar pago con este comprobante" flow. Cross-domain entity
      // access via forFeature, same pattern DashboardModule already uses
      // for Loan/Installment/Payment/MessageLog.
      WhatsappInboundMessage,
    ]),
    WhatsappModule,
    InterestConceptTypesModule,
    UsuryRatesModule,
    ClientsModule,
  ],
  controllers: [LoansController, InstallmentsController],
  providers: [
    LoansService,
    InstallmentsService,
    LoanDeletionService,
    DeletedLoansService,
  ],
  exports: [LoansService, InstallmentsService],
})
export class LoansModule {}
