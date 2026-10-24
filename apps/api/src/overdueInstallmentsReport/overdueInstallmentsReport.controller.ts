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
//
// Bug fix, 2026-09-15 (human report) — this used to be @Controller('clients')
// with @Get('overdue-installments-report'), i.e. GET /clients/overdue-
// installments-report. ClientsController already has GET /clients/:id, and
// Nest/Express match routes in registration order, not by specificity — so
// that one-segment literal path collided with :id (matched as though "id"
// were literally "overdue-installments-report", crashing ClientsService's
// UUID lookup). Nested under an extra "reports" segment instead of just
// reordering module imports to "win" the race — that would still be one
// merge away from silently breaking again the exact same way. Two segments
// after /clients/ can never match the single-segment :id pattern,
// regardless of which controller Nest registers first.
@ApiTags('clients')
@ApiBearerAuth()
@Controller('clients/reports')
export class OverdueInstallmentsReportController {
  constructor(
    private readonly reportService: OverdueInstallmentsReportService,
  ) {}

  @Get('overdue-installments')
  @RequireModule(AppModule.Clients)
  @ApiOperation({
    summary:
      'Download an .xlsx report of clients with overdue installments, one row per client (admin or granted the clients module)',
    description:
      'Each client gets one row: the installment that has been overdue the longest across all their ' +
      'pagarés (ties: lower pagaré number, then lower cuota number), plus how many of their pagarés ' +
      'have something overdue. Sorted by that pagaré (numeric-aware, matching the "Préstamos" list). ' +
      'The summary line still totals every overdue installment.',
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
