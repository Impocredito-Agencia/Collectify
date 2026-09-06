import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ClientsModule } from '../clients/clients.module';
import { InterestConceptType } from '../interestConceptTypes/entities/interestConceptType.entity';
import { LoansModule } from '../loans/loans.module';

import { LoanImportController } from './loanImport.controller';
import { LoanImportService } from './loanImport.service';

// Added 2026-09-06, split off the old combined clients+loans importer
// (see apps/api/src/clientsImport). Depends on both ClientsModule (to
// look a client up by cédula) and LoansModule (to create the loan) —
// same one-directional relationship the old combined module had, so it
// sits "above" both without creating a cycle.
@Module({
  imports: [
    TypeOrmModule.forFeature([InterestConceptType]),
    ClientsModule,
    LoansModule,
  ],
  controllers: [LoanImportController],
  providers: [LoanImportService],
})
export class LoanImportModule {}
