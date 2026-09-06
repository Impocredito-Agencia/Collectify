import {
  BadRequestException,
  Body,
  Controller,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { Audit } from '../auditLog/decorators/audit.decorator';
import { RequireModule } from '../auth/decorators/requireModule.decorator';
import { AppModule } from '../users/entities/userModulePermission.entity';

import {
  ClientsImportResult,
  ClientsImportService,
} from './clientsImport.service';
import { RowError } from './clientsImportParser';

import type { Response } from 'express';

const XLSX_MIME_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MAX_IMPORT_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const XLSX_RESPONSE_CONTENT_TYPE = XLSX_MIME_TYPE;

class ImportErrorsExportDto {
  errors!: RowError[];
}

// Split 2026-09-06 from the old combined clients+loans importer — this
// module only ever creates clients. Assigning a loan to one of them by
// cédula is POST /loans/import (see apps/api/src/loanImport). The route
// path below is kept literally as `import-with-loans` for now even
// though it no longer touches loans — the admin panel's Excel import
// dialog (apps/client) still calls this exact path, and that frontend
// wiring is a deliberately separate follow-up, not done in this pass.
// Rename the route together with that frontend update, not before.
@ApiTags('clients')
@ApiBearerAuth()
@Controller('clients')
export class ClientsImportController {
  constructor(private readonly importService: ClientsImportService) {}

  @Post('import-template')
  @RequireModule(AppModule.Clients)
  @ApiOperation({
    summary:
      'Download an empty .xlsx template for the clients import (admin or granted the clients module)',
    description:
      'Columns always match what POST /clients/import-with-loans accepts — both are built from the ' +
      'same column definitions, so they cannot drift apart. Clients only — no loan data. See ' +
      'POST /loans/import to assign a loan to an existing client by cédula.',
  })
  @ApiResponse({ status: 201, description: 'Returns the .xlsx template file.' })
  async downloadTemplate(@Res() res: Response): Promise<void> {
    const buffer = await this.importService.generateTemplate();
    res.set({
      'Content-Type': XLSX_RESPONSE_CONTENT_TYPE,
      'Content-Disposition': 'attachment; filename="plantilla-clientes.xlsx"',
    });
    res.send(buffer);
  }

  @Post('import-with-loans')
  @RequireModule(AppModule.Clients)
  @Audit('clientsImport.execute', 'clientsImport')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_IMPORT_FILE_SIZE_BYTES },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOperation({
    summary:
      'Bulk-import clients from an .xlsx file (admin or granted the clients module)',
    description:
      'Clients only — no loan is created. A row whose cédula matches an existing client with no ' +
      'conflicting data is a no-op (counted in `alreadyExisted`, not an error); one with ' +
      'conflicting data is skipped as a row error, never silently updated. Max file size 5MB. To ' +
      'give one of these clients a loan afterward, use POST /loans/import with their cédula.',
  })
  @ApiResponse({ status: 201, description: 'Returns the import summary.' })
  @ApiResponse({
    status: 400,
    description:
      'No file uploaded, wrong file type, unreadable file, or missing required column(s).',
  })
  async importClients(
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<ClientsImportResult> {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }
    if (file.mimetype !== XLSX_MIME_TYPE) {
      throw new BadRequestException('Only .xlsx files are supported');
    }
    return this.importService.importFromExcel(file.buffer);
  }

  @Post('import-errors-export')
  @RequireModule(AppModule.Clients)
  @ApiOperation({
    summary:
      'Regenerate a downloadable .xlsx of just the rows that failed a given import attempt (admin or granted the clients module)',
    description:
      'Stateless — pass back the exact `skipped` array from a prior POST /clients/import-with-loans ' +
      'response. Pre-fills each failed row plus a "Motivo del error" column, using the same columns ' +
      'as the template, so the corrected file can be re-uploaded through the same endpoint.',
  })
  @ApiResponse({ status: 201, description: 'Returns the .xlsx file.' })
  async exportErrors(
    @Body() dto: ImportErrorsExportDto,
    @Res() res: Response,
  ): Promise<void> {
    const buffer = await this.importService.generateErrorsExport(
      dto.errors ?? [],
    );
    res.set({
      'Content-Type': XLSX_RESPONSE_CONTENT_TYPE,
      'Content-Disposition':
        'attachment; filename="errores-de-importacion.xlsx"',
    });
    res.send(buffer);
  }
}
