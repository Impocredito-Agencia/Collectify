import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { countDecimalPlaces } from '../common/numberPrecision';
import { LoanInstallmentConcept } from '../loans/entities/loanInstallmentConcept.entity';

import { CreateInterestConceptTypeDto } from './dto/createInterestConceptType.dto';
import { QueryInterestConceptTypesDto } from './dto/queryInterestConceptTypes.dto';
import { UpdateInterestConceptTypeDto } from './dto/updateInterestConceptType.dto';
import {
  ConceptCalculationType,
  InterestConceptType,
} from './entities/interestConceptType.entity';

@Injectable()
export class InterestConceptTypesService {
  constructor(
    @InjectRepository(InterestConceptType)
    private readonly repository: Repository<InterestConceptType>,
    @InjectRepository(LoanInstallmentConcept)
    private readonly loanInstallmentConceptsRepository: Repository<LoanInstallmentConcept>,
  ) {}

  findAll(query: QueryInterestConceptTypesDto): Promise<InterestConceptType[]> {
    const isActive = query.isActive ?? true;

    return this.repository.find({
      where: { isActive },
      order: { name: 'ASC' },
    });
  }

  async findOneOrThrow(id: string): Promise<InterestConceptType> {
    const conceptType = await this.repository.findOneBy({ id });
    if (!conceptType) {
      throw new NotFoundException(
        `Interest concept type with id ${id} not found`,
      );
    }
    return conceptType;
  }

  // Feature request, 2026-09-06 (human) — needs both defaultValue and
  // defaultCalculationType together, which is why it's a service-layer
  // check rather than a DTO decorator — see countDecimalPlaces's own
  // comment for the full reasoning (same precedent as
  // LoansService.assertCoDebtorIsValid/assertDownPaymentIsValid).
  private assertValuePrecision(
    value: number | null | undefined,
    calculationType: ConceptCalculationType,
  ): void {
    if (value == null) return;
    const maxDecimalPlaces =
      calculationType === ConceptCalculationType.Percentage ? 4 : 2;
    if (countDecimalPlaces(value) > maxDecimalPlaces) {
      throw new BadRequestException(
        calculationType === ConceptCalculationType.Percentage
          ? `El valor porcentual admite hasta ${maxDecimalPlaces} decimales.`
          : `Un monto fijo admite hasta ${maxDecimalPlaces} decimales.`,
      );
    }
  }

  async create(
    dto: CreateInterestConceptTypeDto,
  ): Promise<InterestConceptType> {
    this.assertValuePrecision(dto.defaultValue, dto.defaultCalculationType);
    const conceptType = this.repository.create({
      name: dto.name,
      defaultCalculationType: dto.defaultCalculationType,
      defaultValue: dto.defaultValue ?? null,
      category: dto.category,
      fixedAmountDistribution: dto.fixedAmountDistribution ?? null,
      isActive: true,
    });
    return this.repository.save(conceptType);
  }

  async update(
    id: string,
    dto: UpdateInterestConceptTypeDto,
  ): Promise<InterestConceptType> {
    const conceptType = await this.findOneOrThrow(id);

    // Resolved against whichever combination will actually be in effect
    // once this update applies — either field can be omitted (a partial
    // update leaves it unchanged), so validating dto.defaultValue against
    // dto.defaultCalculationType alone would miss e.g. flipping
    // calculationType to fixed_amount while leaving an existing
    // 4-decimal percentage value in place untouched.
    const resultingCalculationType =
      dto.defaultCalculationType ?? conceptType.defaultCalculationType;
    const resultingValue =
      dto.defaultValue !== undefined
        ? dto.defaultValue
        : conceptType.defaultValue;
    this.assertValuePrecision(resultingValue, resultingCalculationType);

    if (dto.name !== undefined) conceptType.name = dto.name;
    if (dto.defaultCalculationType !== undefined) {
      conceptType.defaultCalculationType = dto.defaultCalculationType;
    }
    if (dto.defaultValue !== undefined) {
      conceptType.defaultValue = dto.defaultValue;
    }
    if (dto.category !== undefined) {
      conceptType.category = dto.category;
    }
    if (dto.fixedAmountDistribution !== undefined) {
      conceptType.fixedAmountDistribution = dto.fixedAmountDistribution;
    }

    return this.repository.save(conceptType);
  }

  // Removing a type from the picker for new loans, without touching
  // LoanInstallmentConcept rows already generated from it (those snapshot
  // their own name/value — see docs/phases/PHASE_14_INTEREST_CONCEPTS.md).
  async deactivate(id: string): Promise<InterestConceptType> {
    const conceptType = await this.findOneOrThrow(id);
    conceptType.isActive = false;
    return this.repository.save(conceptType);
  }

  // Human request, 2026-09-05 — the inverse of deactivate() above. Safe to
  // reverse at any time, including for a type that has already been used
  // on one or more loans: those LoanInstallmentConcept rows snapshot their
  // own name/value at assignment time (see deactivate()'s comment), so
  // reactivating the catalog entry doesn't touch anything retroactively —
  // it only makes the type selectable again for new loans. Symmetric with
  // ClientsService's client reactivation (Phase 10) rather than a new
  // pattern.
  async activate(id: string): Promise<InterestConceptType> {
    const conceptType = await this.findOneOrThrow(id);
    conceptType.isActive = true;
    return this.repository.save(conceptType);
  }

  // Human request, 2026-09-03 — a genuine hard delete, for a type that was
  // created wrong (typo, wrong category) and never actually used, as
  // opposed to deactivate() above, which only hides it from the picker.
  // Mirrors UsersService.remove()'s two-step pattern: must already be
  // deactivated, and — the extra check that has no equivalent on
  // Users — must never have been used on any loan.
  // LoanInstallmentConcept.interestConceptTypeId has onDelete: 'SET NULL'
  // (see that entity's comment), so this is safe even for a used type —
  // the rows keep their own nameSnapshot/calculationType/value regardless
  // — but blocking it anyway preserves the reporting link
  // ("total gastos de cobranza cobrados este mes") and keeps this
  // consistent with the reasoning for not letting deactivate() alone be
  // reversible into a delete. withDeleted: true because
  // LoanInstallmentConcept has its own soft-delete column — a
  // soft-deleted row still means this type was used at some point.
  async remove(id: string): Promise<void> {
    const conceptType = await this.findOneOrThrow(id);
    if (conceptType.isActive) {
      throw new BadRequestException(
        'The concept type must be deactivated before it can be deleted.',
      );
    }

    const usageCount = await this.loanInstallmentConceptsRepository.count({
      where: { interestConceptTypeId: id },
      withDeleted: true,
    });
    if (usageCount > 0) {
      throw new BadRequestException(
        'This concept type has already been used on one or more loans and cannot be deleted — it can only stay deactivated.',
      );
    }

    await this.repository.delete({ id });
  }
}
