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
import { IsArray } from 'class-validator';

import { Audit } from '../auditLog/decorators/audit.decorator';
import { RequireModule } from '../auth/decorators/requireModule.decorator';
import { AppModule } from '../users/entities/userModulePermission.entity';

import { LoanImportResult, LoanImportService } from './loanImport.service';
import { RowError } from './loanImportParser';

import type { Response } from 'express';

const XLSX_MIME_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MAX_IMPORT_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const XLSX_RESPONSE_CONTENT_TYPE = XLSX_MIME_TYPE;

// Same bug fix as clientsImport.controller.ts's identical DTO
// (2026-09-06): `errors` had no class-validator decorator, so the global
// ValidationPipe's forbidNonWhitelisted rejected every real request with
// a 400 before it reached the service.
class ImportErrorsExportDto {
  @IsArray()
  errors!: RowError[];
}

// Added 2026-09-06, split off the old combined clients+loans importer —
// see apps/api/src/clientsImport for that half. This one assigns a loan
// to a client that already exists, matched by cédula.
@ApiTags('loans')
@ApiBearerAuth()
@Controller('loans')
export class LoanImportController {
  constructor(private readonly importService: LoanImportService) {}

  @Post('import-template')
  @RequireModule(AppModule.Loans)
  @ApiOperation({
    summary:
      'Download an empty .xlsx template for the loans import (admin or granted the loans module)',
    description:
      'Columns always match what POST /loans/import accepts — both are built from the same column ' +
      "definitions, so they cannot drift apart. Each row's cédula must match a client that already " +
      'exists (see POST /clients/import-with-loans) — this endpoint never creates a client.',
  })
  @ApiResponse({ status: 201, description: 'Returns the .xlsx template file.' })
  async downloadTemplate(@Res() res: Response): Promise<void> {
    const buffer = await this.importService.generateTemplate();
    res.set({
      'Content-Type': XLSX_RESPONSE_CONTENT_TYPE,
      'Content-Disposition': 'attachment; filename="plantilla-creditos.xlsx"',
    });
    res.send(buffer);
  }

  @Post('import')
  @RequireModule(AppModule.Loans)
  @Audit('loanImport.execute', 'loanImport')
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
      'Bulk-import loans from an .xlsx file, assigned to already-existing clients by cédula ' +
      '(admin or granted the loans module)',
    description:
      "One row = one credit. A row whose cédula doesn't match any existing client is skipped as a " +
      'row error — this endpoint never creates a client. Max file size 5MB.',
  })
  @ApiResponse({ status: 201, description: 'Returns the import summary.' })
  @ApiResponse({
    status: 400,
    description:
      'No file uploaded, wrong file type, unreadable file, or missing required column(s).',
  })
  async importLoans(
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<LoanImportResult> {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }
    if (file.mimetype !== XLSX_MIME_TYPE) {
      throw new BadRequestException('Only .xlsx files are supported');
    }
    return this.importService.importFromExcel(file.buffer);
  }

  @Post('import-errors-export')
  @RequireModule(AppModule.Loans)
  @ApiOperation({
    summary:
      'Regenerate a downloadable .xlsx of just the rows that failed a given import attempt (admin or granted the loans module)',
    description:
      'Stateless — pass back the exact `skipped` array from a prior POST /loans/import response. ' +
      'Pre-fills each failed row plus a "Motivo del error" column, using the same columns as the ' +
      'template, so the corrected file can be re-uploaded through the same endpoint.',
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
        'attachment; filename="errores-de-importacion-creditos.xlsx"',
    });
    res.send(buffer);
  }
}
