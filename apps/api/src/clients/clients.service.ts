import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, ILike, In, IsNull, Not, Repository } from 'typeorm';

import { PaginatedResult } from '../common/interfaces/paginatedResult.interface';
import {
  Installment,
  InstallmentStatus,
} from '../loans/entities/installment.entity';
import { Loan, LoanStatus } from '../loans/entities/loan.entity';
import { LoanInstallmentConcept } from '../loans/entities/loanInstallmentConcept.entity';
import { Payment } from '../loans/entities/payment.entity';
import { findConceptsByInstallmentId } from '../loans/installments/conceptsByInstallmentId';
import { enrichInstallment } from '../loans/installments/enrichInstallment';
import { sumPaymentsByInstallmentId } from '../loans/installments/paymentTotals';

import { CreateClientDto } from './dto/createClient.dto';
import { CreateClientReferenceDto } from './dto/createClientReference.dto';
import { QueryClientsDto } from './dto/queryClients.dto';
import { SetClientMessageFrequencyDto } from './dto/setClientMessageFrequency.dto';
import { UpdateClientDto } from './dto/updateClient.dto';
import { UpdateClientReferenceDto } from './dto/updateClientReference.dto';
import { Client } from './entities/client.entity';
import { ClientMessageFrequency } from './entities/clientMessageFrequency.entity';
import { ClientReference } from './entities/clientReference.entity';

const DEFAULT_PAGE = 1;
// Bumped from 20 (2026-09-03) — with the client's real client count around
// 400, 20/page meant ~20 pages, and ClientsListPage.tsx's pager originally
// rendered one button per page with no truncation, so 20 buttons in a row
// was already unwieldy before the count grows further. 50 brings that down
// to ~8 pages, paired with the windowed Pager component (see
// apps/client/src/components/ui/Pager.tsx).
//
// Style cleanup 2026-09-05 brought Dashboard/Loans/MessageLogs/AuditLog up
// to this same 50/page default and pager, since they show the same kind of
// large, ever-growing list. Left at their old DEFAULT_PAGE_SIZE = 20:
// Installments (findAll is unused by any paginated UI — LoanDetailPage
// gets its installments from the loan detail response, not this endpoint)
// and WhatsappWebhook (its admin list on WhatsappInboundMessagesPage has no
// pager UI at all yet — a separate, bigger gap: see that page's own
// "requires server-side pagination per conversation" comment).
const DEFAULT_PAGE_SIZE = 50;
const POSTGRES_UNIQUE_VIOLATION = '23505';

// Distinguishes the two paths that build a Client from a CreateClientDto:
// the interactive ClientForm (consent + document type required — see
// ClientsService.create) and bulk import via ClientLoanImportService
// (neither enforced — see docs/phases/PHASE_21_CLIENT_PROFILE.md decision 6).
// requireDocumentType follows the client's own request that a new client
// always have a document type on file — same reasoning and same
// Excel-import exemption as requireConsent, so it's kept as an
// independent flag rather than folded into requireConsent.
interface CreateClientOptions {
  requireConsent?: boolean;
  requireDocumentType?: boolean;
}

// "Cupo usado" = capital + interés acumulado across the client's active
// loans' still-pending installments — the same totalDue-based math as
// LoansService.summarize()'s outstandingBalance, just aggregated across
// every active loan instead of one. Confirmed with the human for Phase 10
// (see docs/DATABASE.md "Changed after Phase 10").
export interface ClientDetail extends Client {
  creditUsed: number;
  creditAvailable: number | null;
  isMoraBlocked: boolean;
  references: ClientReference[];
  messageFrequency: ClientMessageFrequency | null;
}

// "Préstamos activos" + "En mora" columns on ClientsListPage.tsx (client
// request, 2026-09-05) — the table had a lot of unused horizontal space,
// and these are the two things an admin/cobrador actually wants to know
// at a glance without opening each client's own detail page.
// maxOverdueDays is 0 for a client with no overdue installments (not
// necessarily "no active loans" — a client can have active loans with
// every installment still current). Same "any overdueDays > 0 across the
// client's active loans" definition as ClientDetailPage's own "En mora"
// stat card (totalOverdueBalance), not the stricter >30-day threshold
// used for isMoraBlocked/hasMoraBlock — that one specifically gates new
// loan creation, this one is just informational.
export interface ClientListItem extends Client {
  activeLoanCount: number;
  maxOverdueDays: number;
}

interface EnrichedInstallment {
  status: InstallmentStatus;
  overdueDays: number;
  totalDue: number;
}

@Injectable()
export class ClientsService {
  constructor(
    @InjectRepository(Client)
    private readonly clientsRepository: Repository<Client>,
    @InjectRepository(Loan)
    private readonly loansRepository: Repository<Loan>,
    @InjectRepository(Installment)
    private readonly installmentsRepository: Repository<Installment>,
    // Bug fix, 2026-09-07 — see enrichActiveInstallments's own comment.
    @InjectRepository(Payment)
    private readonly paymentsRepository: Repository<Payment>,
    // Bug fix, 2026-09-08 — see enrichActiveInstallments's own comment.
    @InjectRepository(LoanInstallmentConcept)
    private readonly loanInstallmentConceptsRepository: Repository<LoanInstallmentConcept>,
    @InjectRepository(ClientReference)
    private readonly clientReferencesRepository: Repository<ClientReference>,
    @InjectRepository(ClientMessageFrequency)
    private readonly clientMessageFrequenciesRepository: Repository<ClientMessageFrequency>,
  ) {}

  // requireConsent/requireDocumentType both default to true (the
  // interactive ClientsController.create path) — ClientLoanImportService
  // is the one caller that explicitly opts out of both, since bulk-onboarded
  // clients never had a chance to sign anything or hand over an ID
  // through this software, and both get filled in later from their
  // profile. See docs/phases/PHASE_21_CLIENT_PROFILE.md decision 6, and
  // the legal summary shared with the business owner for why this can't
  // simply be a DTO-level validator (it would then also reject every
  // imported row).
  async create(
    dto: CreateClientDto,
    options: CreateClientOptions = {
      requireConsent: true,
      requireDocumentType: true,
    },
  ): Promise<Client> {
    if (options.requireConsent && dto.dataProcessingConsent !== true) {
      throw new BadRequestException(
        'El cliente debe autorizar el tratamiento de datos personales antes de guardarlo.',
      );
    }
    if (options.requireDocumentType && !dto.documentType) {
      throw new BadRequestException('El tipo de documento es obligatorio.');
    }
    // Phase 26 — unlike consent/documentType above, this rule is NOT
    // exempted for bulk import (confirmed with the human, 2026-08-30): a
    // client record without any address at all is a data-quality problem
    // regardless of how it was created. documentNumber's own "required"
    // rule already lives on CreateClientDto itself (@IsNotEmpty), enforced
    // identically for both paths — this is the same idea for "at least one
    // of home/work address", just expressed here since a cross-field
    // either/or can't be a single-property class-validator decorator.
    if (!dto.homeAddress?.trim() && !dto.workAddress?.trim()) {
      throw new BadRequestException(
        'Debe registrar al menos una dirección (de residencia o de trabajo).',
      );
    }
    await this.assertDocumentNumberIsUnique(dto.documentNumber);

    const client = this.clientsRepository.create({
      ...dto,
      // Server-set, not client-supplied — trustworthy evidence of *when*
      // consent was recorded needs to come from the server clock, not a
      // timestamp the caller could send arbitrarily.
      consentGivenAt: dto.dataProcessingConsent ? new Date() : null,
    });
    try {
      return await this.clientsRepository.save(client);
    } catch (error) {
      throw this.mapUniqueViolation(error);
    }
  }

  // Alphabetical by name instead of most-recently-created, per the
  // client's request. firstName/lastName are free text (nothing stops
  // someone from entering "Juan Carlos" as a first name and "Pérez
  // Gómez" as a last name) — that's not actually a problem for text
  // ordering the way it was for promissoryNoteNumber's numbers: strings
  // of different lengths compare correctly character by character
  // regardless of how many "names" are packed into the field (e.g.
  // "Juan" sorts before "Juan Carlos", same as "casa" before "casas").
  //
  // Sorted in application code (fetching every matching row, unpaginated,
  // then slicing the page) rather than at the database level: the sort
  // key here is computed (case- and accent-folded), and Postgres — with no
  // locale-aware/ICU collation configured on this database (confirmed
  // empirically: the client tested "José" vs "Jose" and "Ñoño" vs
  // "Nn"/"Oo") — compares text by raw UTF-8 byte value, so every accented
  // name would otherwise sort after all plain ASCII ones. Folding each
  // accented character to its plain equivalent (only for sort purposes —
  // the stored/displayed name is untouched) reproduces the same ordering
  // without a database-side function. At this business's scale (a single
  // lending company's client list, not a multi-tenant SaaS), fetching the
  // filtered set before paginating is not a performance concern.
  async findAll(
    query: QueryClientsDto,
  ): Promise<PaginatedResult<ClientListItem>> {
    const page = query.page ?? DEFAULT_PAGE;
    const limit = query.limit ?? DEFAULT_PAGE_SIZE;

    const matches = await this.clientsRepository.find({
      where: this.buildFindAllWhere(query),
      // 'all' and false both need soft-deleted rows visible — 'all' shows
      // everything, false is filtered down to only soft-deleted rows below.
      withDeleted: query.isActive === 'all' || query.isActive === false,
    });
    const items = matches.sort(compareClientsByName);

    const total = items.length;
    const start = (page - 1) * limit;
    const pageItems = items.slice(start, start + limit);

    return {
      items: await this.enrichClientListItems(pageItems),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  // Batched across just this page's clients (at most `limit`, not every
  // match findAll() sorted through) — two queries total regardless of how
  // many clients are on the page, instead of an N+1 loop calling something
  // like enrichActiveInstallments per client. Only reads enrichInstallment's
  // `overdueDays` — a pure date calculation, unaffected by moratory
  // concepts/rate — so, unlike enrichActiveInstallments below, this never
  // needed a per-loan interest rate or concepts fetch to begin with.
  private async enrichClientListItems(
    clients: Client[],
  ): Promise<ClientListItem[]> {
    if (clients.length === 0) {
      return [];
    }

    const clientIds = clients.map((client) => client.id);
    const loans = await this.loansRepository.find({
      where: { clientId: In(clientIds), status: LoanStatus.Active },
    });

    const activeLoanCountByClientId = new Map<string, number>();
    const clientIdByLoanId = new Map<string, string>();
    for (const loan of loans) {
      activeLoanCountByClientId.set(
        loan.clientId,
        (activeLoanCountByClientId.get(loan.clientId) ?? 0) + 1,
      );
      clientIdByLoanId.set(loan.id, loan.clientId);
    }

    const maxOverdueDaysByClientId = new Map<string, number>();
    if (loans.length > 0) {
      const installments = await this.installmentsRepository.find({
        where: { loanId: In(loans.map((loan) => loan.id)) },
      });
      for (const installment of installments) {
        const { overdueDays } = enrichInstallment(installment);
        if (overdueDays <= 0) {
          continue;
        }
        const clientId = clientIdByLoanId.get(installment.loanId);
        if (!clientId) {
          continue;
        }
        maxOverdueDaysByClientId.set(
          clientId,
          Math.max(maxOverdueDaysByClientId.get(clientId) ?? 0, overdueDays),
        );
      }
    }

    return clients.map((client) => ({
      ...client,
      activeLoanCount: activeLoanCountByClientId.get(client.id) ?? 0,
      maxOverdueDays: maxOverdueDaysByClientId.get(client.id) ?? 0,
    }));
  }

  // 'all' means no filter at all (both active and soft-deleted). Any
  // other value — including omitted, defaulting to true — filters as
  // before; see queryClients.dto.ts's Transform for how 'all' gets here.
  private buildFindAllWhere(
    query: QueryClientsDto,
  ): FindOptionsWhere<Client> | FindOptionsWhere<Client>[] {
    const base: FindOptionsWhere<Client> = {};
    if (query.isActive === false) {
      base.deletedAt = Not(IsNull());
    }

    if (!query.search) {
      return base;
    }

    const search = ILike(`%${query.search}%`);
    return [
      { ...base, firstName: search },
      { ...base, lastName: search },
      { ...base, documentNumber: search },
      { ...base, phoneNumber: search },
    ];
  }

  async findOne(id: string): Promise<Client> {
    const client = await this.clientsRepository.findOneBy({ id });
    if (!client) {
      throw new NotFoundException(`Client with id ${id} not found`);
    }
    return client;
  }

  // Used by GET /clients/:id. Kept separate from findOne() (used internally
  // by update()/softDelete()) because the extra fields here are computed,
  // not columns — spreading them onto an entity that later gets passed to
  // repository.save() would be asking for trouble.
  async findOneDetail(id: string): Promise<ClientDetail> {
    const client = await this.findOne(id);
    const enriched = await this.enrichActiveInstallments(id);
    const references = await this.clientReferencesRepository.find({
      where: { clientId: id },
      order: { createdAt: 'ASC' },
    });
    const messageFrequency = await this.getMessageFrequency(id);

    const creditUsed = sumTotalDue(enriched);
    const creditAvailable =
      client.creditLimit !== null ? client.creditLimit - creditUsed : null;
    const isMoraBlocked = enriched.some(
      (installment) => installment.overdueDays > 30,
    );

    return {
      ...client,
      creditUsed,
      creditAvailable,
      isMoraBlocked,
      references,
      messageFrequency,
    };
  }

  // { creditLimit, creditUsed, creditAvailable } on its own, for callers
  // (e.g. LoansService.create()'s cupo guard) that don't need the rest of
  // the client record.
  async getCreditUsage(clientId: string): Promise<{
    creditLimit: number | null;
    creditUsed: number;
    creditAvailable: number | null;
  }> {
    const client = await this.findOne(clientId);
    const enriched = await this.enrichActiveInstallments(clientId);
    const creditUsed = sumTotalDue(enriched);
    const creditAvailable =
      client.creditLimit !== null ? client.creditLimit - creditUsed : null;

    return { creditLimit: client.creditLimit, creditUsed, creditAvailable };
  }

  // Per-installment, not client-aggregate (confirmed with the human for
  // Phase 10): true as soon as any single pending installment on any of the
  // client's active loans is more than 30 days overdue.
  async hasMoraBlock(clientId: string): Promise<boolean> {
    const enriched = await this.enrichActiveInstallments(clientId);
    return enriched.some((installment) => installment.overdueDays > 30);
  }

  // Shared by findOneDetail/getCreditUsage/hasMoraBlock: every installment
  // (any status) across the client's *active* loans, enriched the same way
  // as LoansService.summarize(). Refinanced-away and paid-off loans are
  // LoanStatus.Refinanced/Paid, not Active, so they're excluded here without
  // needing a separate rule — their balance no longer counts toward cupo or
  // mora, which is what refinancing/paying off a loan is supposed to mean.
  //
  // Bug fix, 2026-09-07 — totalPaid added (see enrichInstallment.ts's own
  // comment): without it, creditUsed/creditAvailable never reflected a
  // partial payment already made on a still-Pending installment, so a
  // client's cupo stayed as "used" as if that money had never come in.
  //
  // Bug fix, 2026-09-08 — concepts was hardcoded to `[]` below, which
  // silently reported ZERO accrued mora, inflating creditAvailable for
  // any client with an overdue installment on a loan with real moratory
  // concepts assigned. Now fetches each installment's real
  // LoanInstallmentConcept rows, same as loans.service.ts/
  // installments.service.ts already do. See docs/DATABASE.md's note of
  // this date.
  private async enrichActiveInstallments(
    clientId: string,
  ): Promise<EnrichedInstallment[]> {
    const loans = await this.loansRepository.find({
      where: { clientId, status: LoanStatus.Active },
    });
    if (loans.length === 0) {
      return [];
    }

    const installments = await this.installmentsRepository.find({
      where: { loanId: In(loans.map((loan) => loan.id)) },
    });
    const totalPaidByInstallmentId = await sumPaymentsByInstallmentId(
      this.paymentsRepository,
      installments.map((installment) => installment.id),
    );
    const conceptsByInstallmentId = await findConceptsByInstallmentId(
      this.loanInstallmentConceptsRepository,
      installments.map((installment) => installment.id),
    );

    return installments.map((installment) =>
      enrichInstallment(
        installment,
        conceptsByInstallmentId.get(installment.id) ?? [],
        totalPaidByInstallmentId.get(installment.id) ?? 0,
      ),
    );
  }

  async update(id: string, dto: UpdateClientDto): Promise<Client> {
    const client = await this.findOne(id);

    if (dto.documentNumber && dto.documentNumber !== client.documentNumber) {
      await this.assertDocumentNumberIsUnique(dto.documentNumber);
    }

    // Same "server clock, not caller-supplied" reasoning as create(): only
    // stamp consentGivenAt when consent is actually transitioning to true,
    // don't overwrite an existing timestamp on an unrelated update.
    const consentNewlyGiven =
      dto.dataProcessingConsent === true && !client.dataProcessingConsent;

    Object.assign(client, dto);
    if (consentNewlyGiven) {
      client.consentGivenAt = new Date();
    }

    try {
      return await this.clientsRepository.save(client);
    } catch (error) {
      throw this.mapUniqueViolation(error);
    }
  }

  async softDelete(id: string): Promise<void> {
    await this.findOne(id);

    const loanCount = await this.loansRepository.count({
      where: { clientId: id },
    });
    if (loanCount > 0) {
      throw new ConflictException(
        'No se puede eliminar un cliente que tiene préstamos asociados.',
      );
    }

    await this.clientsRepository.softDelete({ id });
  }

  // Mirrors UsersService.reactivate() (see users.service.ts), adapted to
  // Client's actual TypeORM soft-delete (deletedAt) instead of Users'
  // isActive flag — restore() on the soft-deleted row. Reactivating an
  // already-active client is a clear error rather than a silent no-op,
  // same choice as UsersService.deactivate() erroring on self-deactivation:
  // an admin hitting this on an active client is more likely a mistake
  // worth surfacing than an action to silently swallow.
  async reactivate(id: string): Promise<Client> {
    const client = await this.clientsRepository.findOne({
      where: { id },
      withDeleted: true,
    });
    if (!client) {
      throw new NotFoundException(`Client with id ${id} not found`);
    }
    if (client.deletedAt === null) {
      throw new BadRequestException('This client is already active');
    }

    await this.clientsRepository.restore({ id });
    return this.findOne(id);
  }

  // --- Client references (Phase 21) — a dynamic add/remove list, not a
  // fixed set of fields; see docs/phases/PHASE_21_CLIENT_PROFILE.md. No
  // min/max enforced here, matching the confirmed "let them add as many as
  // they want" decision. ---

  async addReference(
    clientId: string,
    dto: CreateClientReferenceDto,
  ): Promise<ClientReference> {
    await this.findOne(clientId);
    const reference = this.clientReferencesRepository.create({
      ...dto,
      clientId,
    });
    return this.clientReferencesRepository.save(reference);
  }

  async updateReference(
    clientId: string,
    referenceId: string,
    dto: UpdateClientReferenceDto,
  ): Promise<ClientReference> {
    const reference = await this.findReferenceOrThrow(clientId, referenceId);
    Object.assign(reference, dto);
    return this.clientReferencesRepository.save(reference);
  }

  async removeReference(clientId: string, referenceId: string): Promise<void> {
    const reference = await this.findReferenceOrThrow(clientId, referenceId);
    await this.clientReferencesRepository.remove(reference);
  }

  private async findReferenceOrThrow(
    clientId: string,
    referenceId: string,
  ): Promise<ClientReference> {
    const reference = await this.clientReferencesRepository.findOneBy({
      id: referenceId,
      clientId,
    });
    if (!reference) {
      throw new NotFoundException(
        `Reference with id ${referenceId} not found for client ${clientId}`,
      );
    }
    return reference;
  }

  // --- Client message frequency whitelist (Phase 27) — throttles HOW
  // OFTEN overdue/upcoming_due reminders reach this client, never WHETHER
  // they're eligible; see MessageFrequencyThrottleService in the whatsapp
  // module for the read side. One row per client (unique clientId), found-
  // or-created rather than MessageAudience's "always use the most recent
  // of many" pattern — this relationship is genuinely 1:1, so there's no
  // ambiguity to resolve at read time. See
  // docs/phases/PHASE_27_MESSAGE_FREQUENCY.md. ---

  async getMessageFrequency(
    clientId: string,
  ): Promise<ClientMessageFrequency | null> {
    return this.clientMessageFrequenciesRepository.findOneBy({ clientId });
  }

  async setMessageFrequency(
    clientId: string,
    dto: SetClientMessageFrequencyDto,
  ): Promise<ClientMessageFrequency> {
    await this.findOne(clientId);

    const existing = await this.clientMessageFrequenciesRepository.findOneBy({
      clientId,
    });
    const entry =
      existing ?? this.clientMessageFrequenciesRepository.create({ clientId });
    entry.minimumDaysBetweenMessages = dto.minimumDaysBetweenMessages;

    return this.clientMessageFrequenciesRepository.save(entry);
  }

  async clearMessageFrequency(clientId: string): Promise<void> {
    await this.findOne(clientId);
    await this.clientMessageFrequenciesRepository.delete({ clientId });
  }

  // Used by ClientLoanImportService to implement "one row = one credit":
  // a repeated cédula across import rows must find the already-existing
  // (or already-imported-this-batch) client instead of colliding with
  // assertDocumentNumberIsUnique. withDeleted so a soft-deleted client's
  // number still counts as taken, matching assertDocumentNumberIsUnique's
  // own check below.
  async findByDocumentNumber(documentNumber: string): Promise<Client | null> {
    return this.clientsRepository.findOne({
      where: { documentNumber },
      withDeleted: true,
    });
  }

  // Phase 26 — used by LoansService to resolve a loan's coDebtorClientId
  // into a summary for GET /loans/:id. withDeleted (and returning null
  // instead of throwing, unlike findOne()) so a loan whose co-debtor was
  // later deactivated still renders — the co-debtor being soft-deleted is
  // no reason for the loan's own detail view to break.
  async findByIdIncludingDeleted(id: string): Promise<Client | null> {
    return this.clientsRepository.findOne({
      where: { id },
      withDeleted: true,
    });
  }

  private async assertDocumentNumberIsUnique(
    documentNumber: string,
  ): Promise<void> {
    const existing = await this.clientsRepository.findOne({
      where: { documentNumber },
      withDeleted: true,
    });
    if (existing) {
      throw new ConflictException(
        `A client with document number ${documentNumber} already exists`,
      );
    }
  }

  private mapUniqueViolation(error: unknown): unknown {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === POSTGRES_UNIQUE_VIOLATION
    ) {
      return new ConflictException(
        'A client with this document number already exists',
      );
    }
    return error;
  }
}

// Sum of totalDue (amount + accrued interest) across only the still-pending
// installments — same "capital + interés acumulado" definition confirmed
// for cupo usado, mirroring LoansService.summarize()'s outstandingBalance.
function sumTotalDue(installments: EnrichedInstallment[]): number {
  return installments
    .filter((installment) => installment.status === InstallmentStatus.Pending)
    .reduce((sum, installment) => sum + installment.totalDue, 0);
}

// Mirrors TRANSLATE(LOWER(x), 'áéíóúñü', 'aeiounu') from the previous
// SQL-level sort. Doesn't reproduce the traditional Spanish-dictionary rule
// of treating "ñ" as its own letter between "n" and "o" — it folds to "n" —
// but that's a minor imprecision next to the alternative of ñ-named clients
// always sorting dead last (see findAll's comment for why that matters here).
const ACCENT_FOLD: Record<string, string> = {
  á: 'a',
  é: 'e',
  í: 'i',
  ó: 'o',
  ú: 'u',
  ñ: 'n',
  ü: 'u',
};

function foldForSort(value: string): string {
  return value.toLowerCase().replace(/[áéíóúñü]/g, (char) => ACCENT_FOLD[char]);
}

// Plain `<`/`>` on the folded strings, not localeCompare(): the previous
// SQL sort compared raw byte value, which for the ASCII range left after
// folding is equivalent to comparing UTF-16 code units directly —
// localeCompare's locale-aware rules could reorder differently.
function compareClientsByName(a: Client, b: Client): number {
  const firstNameCompare = compareFolded(a.firstName, b.firstName);
  if (firstNameCompare !== 0) {
    return firstNameCompare;
  }
  return compareFolded(a.lastName, b.lastName);
}

function compareFolded(a: string, b: string): number {
  const foldedA = foldForSort(a);
  const foldedB = foldForSort(b);
  if (foldedA < foldedB) {
    return -1;
  }
  if (foldedA > foldedB) {
    return 1;
  }
  return 0;
}
