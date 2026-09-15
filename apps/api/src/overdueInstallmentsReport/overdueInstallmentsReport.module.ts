import { Module } from '@nestjs/common';

import { DashboardModule } from '../dashboard/dashboard.module';

import { OverdueInstallmentsReportController } from './overdueInstallmentsReport.controller';
import { OverdueInstallmentsReportService } from './overdueInstallmentsReport.service';

// Its own module, same reason ClientsImportModule is split from
// ClientsModule: reuses another module's service (DashboardService here)
// without adding a new dependency onto DashboardModule itself.
@Module({
  imports: [DashboardModule],
  controllers: [OverdueInstallmentsReportController],
  providers: [OverdueInstallmentsReportService],
})
export class OverdueInstallmentsReportModule {}
