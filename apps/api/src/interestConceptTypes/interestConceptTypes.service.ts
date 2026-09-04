import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { LoanInstallmentConcept } from '../loans/entities/loanInstallmentConcept.entity';

import { CreateInterestConceptTypeDto } from './dto/createInterestConceptType.dto';
import { QueryInterestConceptTypesDto } from './dto/queryInterestConceptTypes.dto';
import { UpdateInterestConceptTypeDto } from './dto/updateInterestConceptType.dto';
import { InterestConceptType } from './entities/interestConceptType.entity';

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

  async create(
    dto: CreateInterestConceptTypeDto,
  ): Promise<InterestConceptType> {
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
