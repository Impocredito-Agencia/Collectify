import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Repository } from 'typeorm';

import { Client } from '../clients/entities/client.entity';
import { CreateClientDto } from '../clients/dto/createClient.dto';
import { ClientsService } from '../clients/clients.service';
import { InterestConceptType } from '../interestConceptTypes/entities/interestConceptType.entity';
import { LoanConceptAssignmentDto } from '../loans/dto/loanConceptAssignment.dto';
import { CreateLoanDto } from '../loans/dto/createLoan.dto';
import { LoansService } from '../loans/loans.service';

import {
  ParsedClientLoanRow,
  parseClientLoanWorkbook,
  RowError,
} from './clientLoanImportParser';
import {
  buildImportErrorsWorkbook,
  buildImportTemplateWorkbook,
} from './clientLoanImportTemplate';

export interface ClientLoanImportResult {
  totalRows: number;
  created: number;
  skipped: RowError[];
}

// Fields compared when a row's cédula matches an existing (or
// already-imported-this-batch) client — confirmed with the client
// (2026-08-19): a mismatch is a row error to review, never a silent
// update and never silently ignored. Only fields the row actually
// provides are compared — leaving an optional column blank on a repeat
// row is normal (the same client's second loan doesn't need to retype
// their whole profile), not a conflict.
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
export class ClientLoanImportService {
  constructor(
    private readonly clientsService: ClientsService,
    private readonly loansService: LoansService,
    @InjectRepository(Client)
    private readonly clientsRepository: Repository<Client>,
    @InjectRepository(InterestConceptType)
    private readonly interestConceptTypesRepository: Repository<InterestConceptType>,
  ) {}

  generateTemplate(): Promise<Buffer> {
    return buildImportTemplateWorkbook();
  }

  generateErrorsExport(errors: RowError[]): Promise<Buffer> {
    return buildImportErrorsWorkbook(errors);
  }

  // One row = one credit (confirmed with the client, 2026-08-19) — the
  // same cédula can repeat across rows for a client with several loans,
  // matched against what's already in the system or already created
  // earlier in this same file. All-or-nothing per row: if the credit
  // fails for any reason, the client from that same row is not left
  // behind either (see the compensating delete below) — a row is either
  // fully applied or fully skipped, never half.
  async importFromExcel(buffer: Buffer): Promise<ClientLoanImportResult> {
    const parsed = await parseClientLoanWorkbook(buffer).catch((error) => {
      throw error instanceof Error
        ? error
        : new Error('Could not parse the uploaded file');
    });

    const skipped: RowError[] = [...parsed.errors];
    let created = 0;

    // Tracks cédulas created earlier in *this* upload so a later row for
    // the same client finds it without a DB round-trip, and so its
    // match-field comparison uses exactly what this file itself put on
    // record (not a stale read).
    const importedClientsByDocumentNumber = new Map<string, Client>();

    for (const row of parsed.rows) {
      const rowError = await this.processRow(
        row,
        importedClientsByDocumentNumber,
      );
      if (rowError) {
        skipped.push(rowError);
      } else {
        created += 1;
      }
    }

    return {
      totalRows: parsed.rows.length + parsed.errors.length,
      created,
      skipped,
    };
  }

  private async processRow(
    row: ParsedClientLoanRow,
    importedClientsByDocumentNumber: Map<string, Client>,
  ): Promise<RowError | null> {
    const fail = (reason: string): RowError => ({
      row: row.row,
      reason,
      rawValues: row.rawValues,
    });

    // 1. Resolve "cargo adicional" concepts against the catalog before
    // touching the database — catches a misspelled concept name cheaply,
    // without creating anything that would need to be undone.
    const concepts: LoanConceptAssignmentDto[] = [];
    for (const parsedConcept of row.concepts) {
      const conceptType = await this.findActiveConceptTypeByName(
        parsedConcept.name,
      );
      if (!conceptType) {
        return fail(
          `El cargo adicional "${parsedConcept.name}" no existe en el catálogo o está inactivo — créalo primero en Conceptos de interés.`,
        );
      }
      concepts.push(
        plainToInstance(LoanConceptAssignmentDto, {
          conceptTypeId: conceptType.id,
          calculationType: parsedConcept.calculationType,
          value: parsedConcept.value,
        }),
      );
    }

    // 2. Find-or-validate the client for this row.
    const documentNumber = String(row.client.documentNumber ?? '');
    const existingClient =
      importedClientsByDocumentNumber.get(documentNumber) ??
      (await this.clientsService.findByDocumentNumber(documentNumber));

    let clientId: string;
    let createdNewClientId: string | null = null;

    if (existingClient) {
      const conflict = this.findMatchConflict(existingClient, row.client);
      if (conflict) {
        return fail(
          `La cédula ${documentNumber} ya existe con datos distintos a los de esta fila (${conflict}) — revisa y corrige antes de volver a subir.`,
        );
      }
      clientId = existingClient.id;
    } else {
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
          error instanceof Error
            ? error.message
            : 'No se pudo crear el cliente',
        );
      }
      clientId = newClient.id;
      createdNewClientId = newClient.id;
      importedClientsByDocumentNumber.set(documentNumber, newClient);
    }

    // 3. Build and validate the loan.
    const loanDto = plainToInstance(CreateLoanDto, {
      ...row.loan,
      clientId,
      concepts,
    });
    const loanErrors = await validate(loanDto);
    if (loanErrors.length > 0) {
      await this.rollbackNewClientIfAny(createdNewClientId);
      return fail(
        loanErrors
          .flatMap((e) => Object.values(e.constraints ?? {}))
          .join('; '),
      );
    }

    // 4. Create the loan, reusing LoansService.create() exactly as the
    // manual "Crear préstamo" flow does — same amortization engine, same
    // promissory-note-uniqueness, usury-warning, and mora/cupo checks.
    // "Modo histórico" (skipCreditCheck: true, confirmed with the client
    // 2026-08-19) was removed 2026-09-03 — client feedback: never used in
    // practice, just clutter in the upload dialog. Every import now goes
    // through the same guard as creating a loan by hand.
    try {
      await this.loansService.create(loanDto);
    } catch (error) {
      await this.rollbackNewClientIfAny(createdNewClientId);
      return fail(
        error instanceof Error ? error.message : 'No se pudo crear el crédito',
      );
    }

    return null;
  }

  // Compensating action, not a cross-service DB transaction (ClientsService
  // and LoansService each manage their own persistence) — deletes a
  // client this same row created a moment ago, only when the loan that
  // was supposed to go with it didn't make it. A client reused from an
  // earlier row or from before this import ever ran is never touched
  // here. Hard delete (not soft) since the row created it seconds ago and
  // nothing else could possibly reference it yet.
  private async rollbackNewClientIfAny(clientId: string | null): Promise<void> {
    if (!clientId) return;
    await this.clientsRepository.delete({ id: clientId });
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

  private async findActiveConceptTypeByName(
    name: string,
  ): Promise<InterestConceptType | null> {
    const normalizedTarget = name.trim().toLowerCase();
    const active = await this.interestConceptTypesRepository.find({
      where: { isActive: true },
    });
    return (
      active.find((c) => c.name.trim().toLowerCase() === normalizedTarget) ??
      null
    );
  }
}
