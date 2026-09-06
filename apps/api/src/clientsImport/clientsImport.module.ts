import { Module } from '@nestjs/common';

import { ClientsModule } from '../clients/clients.module';

import { ClientsImportController } from './clientsImport.controller';
import { ClientsImportService } from './clientsImport.service';

// Split 2026-09-06 from the old combined clients+loans importer — no
// longer depends on LoansModule or InterestConceptType at all, since this
// module never creates a loan. See apps/api/src/loanImport for that half.
@Module({
  imports: [ClientsModule],
  controllers: [ClientsImportController],
  providers: [ClientsImportService],
})
export class ClientsImportModule {}
