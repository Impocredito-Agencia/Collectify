import { Controller, Get, Res } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { RequireModule } from '../auth/decorators/requireModule.decorator';
import { AppModule } from '../users/entities/userModulePermission.entity';

import { OverdueInstallmentsReportService } from './overdueInstallmentsReport.service';
import { overdueInstallmentsReportFilename } from './overdueInstallmentsReportWorkbook';

import type { Response } from 'express';

const XLSX_MIME_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// Human request, 2026-09-15 — the client used to build this by hand from
// their own paper records. Gated the same way clientsImport's downloads
// are (admin or granted the clients module), since the button lives on
// the Clientes page, not Dashboard (which has no module gate at all — see
// AppModule's own comment on why).
@ApiTags('clients')
@ApiBearerAuth()
@Controller('clients')
export class OverdueInstallmentsReportController {
  constructor(
    private readonly reportService: OverdueInstallmentsReportService,
  ) {}

  @Get('overdue-installments-report')
  @RequireModule(AppModule.Clients)
  @ApiOperation({
    summary:
      'Download an .xlsx report of every overdue installment, one row each (admin or granted the clients module)',
    description:
      'Sorted by pagaré (numeric-aware, matching the "Préstamos" list), then by cuota number — the ' +
      'same order the client used when they tracked this by hand. Never aggregated by client.',
  })
  @ApiResponse({ status: 200, description: 'Returns the .xlsx report.' })
  async download(@Res() res: Response): Promise<void> {
    const buffer = await this.reportService.generate();
    res.set({
      'Content-Type': XLSX_MIME_TYPE,
      'Content-Disposition': `attachment; filename="${overdueInstallmentsReportFilename()}"`,
    });
    res.send(buffer);
  }
}
