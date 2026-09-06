import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditLogModule } from './auditLog/auditLog.module';
import { AuthModule } from './auth/auth.module';
import { ClientsImportModule } from './clientsImport/clientsImport.module';
import { ClientsModule } from './clients/clients.module';
import configuration, { Configuration } from './config/configuration';
import { envValidationSchema } from './config/env.validation';
import { DashboardModule } from './dashboard/dashboard.module';
import { buildDataSourceOptions } from './database/typeOrmConfig';
import { HealthModule } from './health/health.module';
import { InterestConceptTypesModule } from './interestConceptTypes/interestConceptTypes.module';
import { LoanImportModule } from './loanImport/loanImport.module';
import { LoansModule } from './loans/loans.module';
import { UsersModule } from './users/users.module';
import { UsuryRatesModule } from './usuryRates/usuryRates.module';
import { WhatsappModule } from './whatsapp/whatsapp.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema: envValidationSchema,
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService<Configuration, true>) =>
        buildDataSourceOptions(configService.get('database', { infer: true })),
    }),
    ScheduleModule.forRoot(),
    HealthModule,
    UsersModule,
    AuthModule,
    AuditLogModule,
    ClientsModule,
    LoansModule,
    ClientsImportModule,
    LoanImportModule,
    InterestConceptTypesModule,
    UsuryRatesModule,
    WhatsappModule,
    DashboardModule,
  ],
})
export class AppModule {}
