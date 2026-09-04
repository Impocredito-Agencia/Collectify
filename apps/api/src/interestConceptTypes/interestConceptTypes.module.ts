import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { LoanInstallmentConcept } from '../loans/entities/loanInstallmentConcept.entity';

import { InterestConceptType } from './entities/interestConceptType.entity';
import { InterestConceptTypesController } from './interestConceptTypes.controller';
import { InterestConceptTypesService } from './interestConceptTypes.service';

@Module({
  // LoanInstallmentConcept registered here too — not to depend on
  // LoansModule (which already imports this module the other way), just to
  // check usage history before a hard delete. See
  // InterestConceptTypesService.remove().
  imports: [
    TypeOrmModule.forFeature([InterestConceptType, LoanInstallmentConcept]),
  ],
  controllers: [InterestConceptTypesController],
  providers: [InterestConceptTypesService],
  exports: [InterestConceptTypesService],
})
export class InterestConceptTypesModule {}
