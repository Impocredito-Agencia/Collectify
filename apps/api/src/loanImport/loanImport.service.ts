import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Repository } from 'typeorm';

import { ClientsService } from '../clients/clients.service';
import { InterestConceptType } from '../interestConceptTypes/entities/interestConceptType.entity';
import { LoanConceptAssignmentDto } from '../loans/dto/loanConceptAssignment.dto';
import { CreateLoanDto } from '../loans/dto/createLoan.dto';
import { LoansService } from '../loans/loans.service';

import {
  ParsedLoanRow,
  parseLoansWorkbook,
  RowError,
} from './loanImportParser';
import {
  buildImportErrorsWorkbook,
  buildImportTemplateWorkbook,
} from './loanImportTemplate';

export interface LoanImportResult {
  totalRows: number;
  created: number;
  skipped: RowError[];
}

// Added 2026-09-06, split off the old combined clients+loans importer
// (see apps/api/src/clientsImport) — that one created a client and its
// loan together; this one only creates loans, for clients that already
// exist. Each row is matched to its client by cédula, never by name (two
// clients can share a name; a cédula is unique — see Client entity).
@Injectable()
export class LoanImportService {
  constructor(
    private readonly clientsService: ClientsService,
    private readonly loansService: LoansService,
    @InjectRepository(InterestConceptType)
    private readonly interestConceptTypesRepository: Repository<InterestConceptType>,
  ) {}

  generateTemplate(): Promise<Buffer> {
    return buildImportTemplateWorkbook();
  }

  generateErrorsExport(errors: RowError[]): Promise<Buffer> {
    return buildImportErrorsWorkbook(errors);
  }

  // One row = one credit. No rollback/compensating-delete logic is
  // needed here (unlike the combined importer this was split from) —
  // this never creates a client, only looks one up, so a failed loan
  // never leaves a half-created client behind.
  async importFromExcel(buffer: Buffer): Promise<LoanImportResult> {
    const parsed = await parseLoansWorkbook(buffer).catch((error) => {
      throw error instanceof Error
        ? error
        : new Error('Could not parse the uploaded file');
    });

    const skipped: RowError[] = [...parsed.errors];
    let created = 0;

    for (const row of parsed.rows) {
      const rowError = await this.processRow(row);
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

  private async processRow(row: ParsedLoanRow): Promise<RowError | null> {
    const fail = (reason: string): RowError => ({
      row: row.row,
      reason,
      rawValues: row.rawValues,
    });

    const client = await this.clientsService.findByDocumentNumber(
      row.documentNumber,
    );
    if (!client) {
      return fail(
        `No existe un cliente con la cédula ${row.documentNumber} — impórtalo primero en la plantilla de clientes.`,
      );
    }

    // Resolve "cargo adicional" concepts against the catalog before
    // touching the database — catches a misspelled concept name cheaply.
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

    const loanDto = plainToInstance(CreateLoanDto, {
      ...row.loan,
      clientId: client.id,
      concepts,
    });
    const loanErrors = await validate(loanDto);
    if (loanErrors.length > 0) {
      return fail(
        loanErrors
          .flatMap((e) => Object.values(e.constraints ?? {}))
          .join('; '),
      );
    }

    // Reuses LoansService.create() exactly as the manual "Crear préstamo"
    // flow does — same amortization engine, same promissory-note-
    // uniqueness, usury-warning, and mora/cupo checks.
    try {
      await this.loansService.create(loanDto);
    } catch (error) {
      return fail(
        error instanceof Error ? error.message : 'No se pudo crear el crédito',
      );
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
