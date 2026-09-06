import { Injectable } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { Client } from '../clients/entities/client.entity';
import { CreateClientDto } from '../clients/dto/createClient.dto';
import { ClientsService } from '../clients/clients.service';

import {
  ParsedClientRow,
  parseClientsWorkbook,
  RowError,
} from './clientsImportParser';
import {
  buildImportErrorsWorkbook,
  buildImportTemplateWorkbook,
} from './clientsImportTemplate';

export interface ClientsImportResult {
  totalRows: number;
  created: number;
  // A row whose cédula already matches an existing client with no
  // conflicting data — nothing to do, not an error. Split out from
  // `created` so the summary doesn't overstate how many new clients
  // actually landed.
  alreadyExisted: number;
  skipped: RowError[];
}

// Fields compared when a row's cédula matches an existing client —
// same convention this module inherited from the combined clients+loans
// importer (confirmed with the client, 2026-08-19): a mismatch is a row
// error to review, never a silent update and never silently ignored.
// Only fields the row actually provides are compared — leaving an
// optional column blank is normal, not a conflict.
const CLIENT_MATCH_FIELDS: (keyof CreateClientDto)[] = [
  'firstName',
  'lastName',
  'phoneNumber',
  'email',
  'homeAddress',
  'workAddress',
  'city',
  'neighborhood',
  'occupation',
  'employerName',
];

@Injectable()
export class ClientsImportService {
  constructor(private readonly clientsService: ClientsService) {}

  generateTemplate(): Promise<Buffer> {
    return buildImportTemplateWorkbook();
  }

  generateErrorsExport(errors: RowError[]): Promise<Buffer> {
    return buildImportErrorsWorkbook(errors);
  }

  // Split 2026-09-06 from the old combined clients+loans importer — this
  // only creates clients. A loan for one of them is a separate upload
  // (see apps/api/src/loanImport), matched by cédula. One bad row doesn't
  // sink the rest: parser-level and row-level failures alike land in
  // `skipped`, never abort the loop.
  async importFromExcel(buffer: Buffer): Promise<ClientsImportResult> {
    const parsed = await parseClientsWorkbook(buffer).catch((error) => {
      throw error instanceof Error
        ? error
        : new Error('Could not parse the uploaded file');
    });

    const skipped: RowError[] = [...parsed.errors];
    let created = 0;
    let alreadyExisted = 0;

    // Tracks cédulas created earlier in *this* upload, so a later row
    // repeating the same cédula is checked for conflicts against exactly
    // what this file itself put on record, not a stale DB read.
    const importedClientsByDocumentNumber = new Map<string, Client>();

    for (const row of parsed.rows) {
      const outcome = await this.processRow(
        row,
        importedClientsByDocumentNumber,
      );
      if (outcome === 'created') {
        created += 1;
      } else if (outcome === 'already-existed') {
        alreadyExisted += 1;
      } else {
        skipped.push(outcome);
      }
    }

    return {
      totalRows: parsed.rows.length + parsed.errors.length,
      created,
      alreadyExisted,
      skipped,
    };
  }

  private async processRow(
    row: ParsedClientRow,
    importedClientsByDocumentNumber: Map<string, Client>,
  ): Promise<'created' | 'already-existed' | RowError> {
    const fail = (reason: string): RowError => ({
      row: row.row,
      reason,
      rawValues: row.rawValues,
    });

    const documentNumber = String(row.client.documentNumber ?? '');
    const existingClient =
      importedClientsByDocumentNumber.get(documentNumber) ??
      (await this.clientsService.findByDocumentNumber(documentNumber));

    if (existingClient) {
      const conflict = this.findMatchConflict(existingClient, row.client);
      if (conflict) {
        return fail(
          `La cédula ${documentNumber} ya existe con datos distintos a los de esta fila (${conflict}) — revisa y corrige antes de volver a subir.`,
        );
      }
      return 'already-existed';
    }

    const clientDto = plainToInstance(CreateClientDto, row.client);
    const clientErrors = await validate(clientDto);
    if (clientErrors.length > 0) {
      return fail(
        clientErrors
          .flatMap((e) => Object.values(e.constraints ?? {}))
          .join('; '),
      );
    }

    let newClient: Client;
    try {
      newClient = await this.clientsService.create(clientDto, {
        requireConsent: false,
        requireDocumentType: false,
      });
    } catch (error) {
      return fail(
        error instanceof Error ? error.message : 'No se pudo crear el cliente',
      );
    }
    importedClientsByDocumentNumber.set(documentNumber, newClient);
    return 'created';
  }

  private findMatchConflict(
    existing: Client,
    rowClient: Record<string, string | number>,
  ): string | null {
    for (const field of CLIENT_MATCH_FIELDS) {
      const rowValue = rowClient[field];
      if (rowValue === undefined || rowValue === '') continue;

      const existingValue = existing[field as keyof Client];
      const normalizedRow = String(rowValue).trim().toLowerCase();
      const normalizedExisting = String(existingValue ?? '')
        .trim()
        .toLowerCase();
      if (normalizedRow !== normalizedExisting) {
        return `${field}: "${String(existingValue ?? '')}" vs "${String(rowValue)}"`;
      }
    }
    return null;
  }
}
