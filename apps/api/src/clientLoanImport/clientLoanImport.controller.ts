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
  ClientLoanImportResult,
  ClientLoanImportService,
} from './clientLoanImport.service';
import { RowError } from './clientLoanImportParser';

import type { Response } from 'express';

const XLSX_MIME_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MAX_IMPORT_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const XLSX_RESPONSE_CONTENT_TYPE = XLSX_MIME_TYPE;

class ImportErrorsExportDto {
  errors!: RowError[];
}

@ApiTags('clients')
@ApiBearerAuth()
@Controller('clients')
export class ClientLoanImportController {
  constructor(private readonly importService: ClientLoanImportService) {}

  @Post('import-template')
  @RequireModule(AppModule.Clients)
  @ApiOperation({
    summary:
      'Download an empty .xlsx template for the combined clients+loans import (admin or granted the clients module)',
    description:
      'Columns always match what POST /clients/import-with-loans accepts — both are built from the ' +
      'same column definitions, so they cannot drift apart. One row = one credit: a client with ' +
      'several loans appears on several rows with the same cédula.',
  })
  @ApiResponse({ status: 201, description: 'Returns the .xlsx template file.' })
  async downloadTemplate(@Res() res: Response): Promise<void> {
    const buffer = await this.importService.generateTemplate();
    res.set({
      'Content-Type': XLSX_RESPONSE_CONTENT_TYPE,
      'Content-Disposition':
        'attachment; filename="plantilla-clientes-creditos.xlsx"',
    });
    res.send(buffer);
  }

  @Post('import-with-loans')
  @RequireModule(AppModule.Clients)
  @Audit('clientLoanImport.execute', 'clientLoanImport')
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
      'Bulk-import clients and their initial loan from an .xlsx file (admin or granted the clients module)',
    description:
      'One row = one credit — the same cédula can repeat across rows for a client with several ' +
      'loans. All-or-nothing per row: if the loan fails, the client from that same row is not left ' +
      'behind either. A row with a cédula that matches an existing client but different data in it ' +
      'is skipped as a conflict, never silently updated. Max file size 5MB.',
  })
  @ApiResponse({ status: 201, description: 'Returns the import summary.' })
  @ApiResponse({
    status: 400,
    description:
      'No file uploaded, wrong file type, unreadable file, or missing required column(s).',
  })
  async importClientsWithLoans(
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<ClientLoanImportResult> {
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
