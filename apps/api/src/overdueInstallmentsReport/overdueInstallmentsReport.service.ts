import { Injectable } from '@nestjs/common';

import { DashboardService } from '../dashboard/dashboard.service';

import { buildOverdueInstallmentsReportWorkbook } from './overdueInstallmentsReportWorkbook';

@Injectable()
export class OverdueInstallmentsReportService {
  constructor(private readonly dashboardService: DashboardService) {}

  async generate(): Promise<Buffer> {
    const rows = await this.dashboardService.getOverdueInstallmentDetails();
    return buildOverdueInstallmentsReportWorkbook(rows);
  }
}
