import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { CreateInterestConceptTypeDto } from './dto/createInterestConceptType.dto';
import { QueryInterestConceptTypesDto } from './dto/queryInterestConceptTypes.dto';
import { UpdateInterestConceptTypeDto } from './dto/updateInterestConceptType.dto';
import {
  ConceptCalculationType,
  ConceptCategory,
  InterestConceptType,
} from './entities/interestConceptType.entity';

@Injectable()
export class InterestConceptTypesService {
  constructor(
    @InjectRepository(InterestConceptType)
    private readonly repository: Repository<InterestConceptType>,
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
    this.assertUsuryFlagIsValid(
      dto.isUsuryRateConcept ?? false,
      dto.defaultCalculationType,
    );

    const conceptType = this.repository.create({
      name: dto.name,
      defaultCalculationType: dto.defaultCalculationType,
      defaultValue: dto.defaultValue ?? null,
      category: dto.category,
      fixedAmountDistribution: dto.fixedAmountDistribution ?? null,
      isActive: true,
      isUsuryRateConcept: dto.isUsuryRateConcept ?? false,
    });
    const saved = await this.repository.save(conceptType);

    if (saved.isUsuryRateConcept) {
      await this.unsetOtherUsuryConceptsInCategory(saved.id, saved.category);
    }

    return saved;
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
    if (dto.isUsuryRateConcept !== undefined) {
      conceptType.isUsuryRateConcept = dto.isUsuryRateConcept;
    }

    // Validated against the RESULTING state (post-merge), so a request
    // that flips isUsuryRateConcept to true and changes
    // defaultCalculationType away from percentage in the same call is
    // still rejected.
    this.assertUsuryFlagIsValid(
      conceptType.isUsuryRateConcept,
      conceptType.defaultCalculationType,
    );

    const saved = await this.repository.save(conceptType);

    if (saved.isUsuryRateConcept) {
      await this.unsetOtherUsuryConceptsInCategory(saved.id, saved.category);
    }

    return saved;
  }

  // At most one concept per category may be flagged — matches
  // MessageTemplatesService.activate()'s "activating one deactivates the
  // others of the same scope" pattern elsewhere in this codebase.
  private async unsetOtherUsuryConceptsInCategory(
    exceptId: string,
    category: ConceptCategory,
  ): Promise<void> {
    await this.repository
      .createQueryBuilder()
      .update(InterestConceptType)
      .set({ isUsuryRateConcept: false })
      .where('category = :category', { category })
      .andWhere('id != :exceptId', { exceptId })
      .execute();
  }

  private assertUsuryFlagIsValid(
    isUsuryRateConcept: boolean,
    calculationType: ConceptCalculationType,
  ): void {
    if (
      isUsuryRateConcept &&
      calculationType !== ConceptCalculationType.Percentage
    ) {
      throw new BadRequestException(
        'isUsuryRateConcept can only be set on a percentage-type concept.',
      );
    }
  }

  // The mandatory, non-removable concept for a category — the loan form
  // always includes it, LoansService requires its id in the corresponding
  // concepts/moratoryConcepts list. null when the admin hasn't designated
  // one yet for that category.
  findMandatoryUsuryConcept(
    category: ConceptCategory,
  ): Promise<InterestConceptType | null> {
    return this.repository.findOneBy({
      category,
      isUsuryRateConcept: true,
      isActive: true,
    });
  }

  // Removing a type from the picker for new loans, without touching
  // LoanInstallmentConcept rows already generated from it (those snapshot
  // their own name/value — see docs/phases/PHASE_14_INTEREST_CONCEPTS.md).
  async deactivate(id: string): Promise<InterestConceptType> {
    const conceptType = await this.findOneOrThrow(id);
    conceptType.isActive = false;
    return this.repository.save(conceptType);
  }
}
