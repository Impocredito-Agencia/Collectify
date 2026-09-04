import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Client } from '../clients/entities/client.entity';
import { InterestConceptType } from '../interestConceptTypes/entities/interestConceptType.entity';
import { Installment } from '../loans/entities/installment.entity';
import { Loan } from '../loans/entities/loan.entity';
import { User } from '../users/entities/user.entity';

import { AuditLogController } from './auditLog.controller';
import { AuditLogInterceptor } from './auditLog.interceptor';
import { AuditLogService } from './auditLog.service';
import { AuditLog } from './entities/auditLog.entity';

@Module({
  // Client, Loan, User, InterestConceptType (2026-09-03), and Installment
  // (2026-09-04) are registered here (not by importing their own modules)
  // purely so AuditLogInterceptor can read a name/label for label-fallback
  // cases where the handler's own response has nothing to read from
  // (client.addReference/updateReference/removeReference, loan.delete,
  // user.delete, interestConceptType.delete, payment.register's missing
  // installment/loan context) — see that interceptor's constructor
  // comment. Plain repositories, not the modules, to avoid pulling in
  // their dependencies for a single read-only lookup each.
  imports: [
    TypeOrmModule.forFeature([
      AuditLog,
      Client,
      Loan,
      User,
      InterestConceptType,
      Installment,
    ]),
  ],
  controllers: [AuditLogController],
  providers: [
    AuditLogService,
    // Registered globally via the APP_INTERCEPTOR token (not
    // app.useGlobalInterceptors in main.ts, unlike ResponseInterceptor):
    // this interceptor needs constructor-injected dependencies
    // (AuditLogService, Reflector), and useGlobalInterceptors constructs
    // its argument manually with `new`, which can't resolve them.
    { provide: APP_INTERCEPTOR, useClass: AuditLogInterceptor },
  ],
  exports: [AuditLogService],
})
export class AuditLogModule {}
