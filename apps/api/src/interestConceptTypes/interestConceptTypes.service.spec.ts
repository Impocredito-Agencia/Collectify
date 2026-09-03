import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import {
  ConceptCalculationType,
  ConceptCategory,
  FixedAmountDistribution,
  InterestConceptType,
} from './entities/interestConceptType.entity';
import { InterestConceptTypesService } from './interestConceptTypes.service';

describe('InterestConceptTypesService', () => {
  let service: InterestConceptTypesService;
  let repository: {
    find: jest.Mock;
    findOneBy: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let updateQueryBuilder: {
    update: jest.Mock;
    set: jest.Mock;
    where: jest.Mock;
    andWhere: jest.Mock;
    execute: jest.Mock;
  };

  const mockConceptType: InterestConceptType = {
    id: 'concept-type-1',
    name: 'Gastos de cobranza',
    defaultCalculationType: ConceptCalculationType.Percentage,
    defaultValue: 3,
    category: ConceptCategory.Corriente,
    fixedAmountDistribution: null,
    isActive: true,
    isUsuryRateConcept: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };

  beforeEach(async () => {
    updateQueryBuilder = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue(undefined),
    };
    repository = {
      find: jest.fn(),
      findOneBy: jest.fn(),
      create: jest.fn((dto: Partial<InterestConceptType>) => dto),
      save: jest.fn(),
      createQueryBuilder: jest.fn().mockReturnValue(updateQueryBuilder),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InterestConceptTypesService,
        {
          provide: getRepositoryToken(InterestConceptType),
          useValue: repository,
        },
      ],
    }).compile();

    service = module.get<InterestConceptTypesService>(
      InterestConceptTypesService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('findAll', () => {
    it('returns only active types by default', async () => {
      repository.find.mockResolvedValue([mockConceptType]);

      const result = await service.findAll({});

      expect(result).toEqual([mockConceptType]);
      expect(repository.find).toHaveBeenCalledWith({
        where: { isActive: true },
        order: { name: 'ASC' },
      });
    });

    it('returns deactivated types when isActive=false is requested', async () => {
      repository.find.mockResolvedValue([]);

      await service.findAll({ isActive: false });

      expect(repository.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { isActive: false } }),
      );
    });
  });

  describe('create', () => {
    it('creates a concept type with isActive true and a null default value when omitted', async () => {
      repository.save.mockImplementation(
        (entity: Partial<InterestConceptType>) =>
          Promise.resolve({ ...mockConceptType, ...entity }),
      );

      await service.create({
        name: 'Seguro',
        defaultCalculationType: ConceptCalculationType.FixedAmount,
        category: ConceptCategory.Corriente,
        fixedAmountDistribution:
          FixedAmountDistribution.SplitAcrossInstallments,
      });

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Seguro',
          defaultCalculationType: ConceptCalculationType.FixedAmount,
          defaultValue: null,
          isActive: true,
        }),
      );
    });

    it('persists the provided default value', async () => {
      repository.save.mockImplementation(
        (entity: Partial<InterestConceptType>) =>
          Promise.resolve({ ...mockConceptType, ...entity }),
      );

      await service.create({
        name: 'Interés remuneratorio',
        defaultCalculationType: ConceptCalculationType.Percentage,
        defaultValue: 2,
        category: ConceptCategory.Corriente,
      });

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ defaultValue: 2 }),
      );
    });

    // Bug fix, 2026-09-03 — the mandatory, non-removable usury-rate
    // concept per category. See the isUsuryRateConcept doc comment on
    // InterestConceptType.
    it('rejects isUsuryRateConcept on a non-percentage concept', async () => {
      await expect(
        service.create({
          name: 'Gastos fijos',
          defaultCalculationType: ConceptCalculationType.FixedAmount,
          category: ConceptCategory.Corriente,
          fixedAmountDistribution:
            FixedAmountDistribution.SplitAcrossInstallments,
          isUsuryRateConcept: true,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(repository.save).not.toHaveBeenCalled();
    });

    it('unsets isUsuryRateConcept on other concepts in the same category', async () => {
      repository.save.mockImplementation(
        (entity: Partial<InterestConceptType>) =>
          Promise.resolve({ ...mockConceptType, ...entity, id: 'new-id' }),
      );

      await service.create({
        name: 'Interés remuneratorio',
        defaultCalculationType: ConceptCalculationType.Percentage,
        category: ConceptCategory.Corriente,
        isUsuryRateConcept: true,
      });

      expect(repository.createQueryBuilder).toHaveBeenCalled();
      expect(updateQueryBuilder.set).toHaveBeenCalledWith({
        isUsuryRateConcept: false,
      });
      expect(updateQueryBuilder.where).toHaveBeenCalledWith(
        'category = :category',
        { category: ConceptCategory.Corriente },
      );
      expect(updateQueryBuilder.andWhere).toHaveBeenCalledWith(
        'id != :exceptId',
        { exceptId: 'new-id' },
      );
    });

    it('does not touch other concepts when isUsuryRateConcept is false', async () => {
      repository.save.mockImplementation(
        (entity: Partial<InterestConceptType>) =>
          Promise.resolve({ ...mockConceptType, ...entity }),
      );

      await service.create({
        name: 'Gastos de cobranza',
        defaultCalculationType: ConceptCalculationType.Percentage,
        category: ConceptCategory.Corriente,
      });

      expect(repository.createQueryBuilder).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('applies only the provided fields', async () => {
      repository.findOneBy.mockResolvedValue({ ...mockConceptType });
      repository.save.mockImplementation((entity: InterestConceptType) =>
        Promise.resolve(entity),
      );

      const result = await service.update('concept-type-1', {
        defaultValue: 5,
      });

      expect(result.defaultValue).toBe(5);
      expect(result.name).toBe(mockConceptType.name);
    });

    it('throws NotFoundException when the type does not exist', async () => {
      repository.findOneBy.mockResolvedValue(null);

      await expect(
        service.update('missing-id', { defaultValue: 5 }),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects flipping isUsuryRateConcept to true on a fixed_amount concept', async () => {
      repository.findOneBy.mockResolvedValue({
        ...mockConceptType,
        defaultCalculationType: ConceptCalculationType.FixedAmount,
      });

      await expect(
        service.update('concept-type-1', { isUsuryRateConcept: true }),
      ).rejects.toThrow(BadRequestException);
      expect(repository.save).not.toHaveBeenCalled();
    });

    it('rejects switching to fixed_amount while isUsuryRateConcept stays true', async () => {
      repository.findOneBy.mockResolvedValue({
        ...mockConceptType,
        isUsuryRateConcept: true,
      });

      await expect(
        service.update('concept-type-1', {
          defaultCalculationType: ConceptCalculationType.FixedAmount,
          fixedAmountDistribution:
            FixedAmountDistribution.SplitAcrossInstallments,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('unsets isUsuryRateConcept on other concepts when set true via update', async () => {
      repository.findOneBy.mockResolvedValue({ ...mockConceptType });
      repository.save.mockImplementation((entity: InterestConceptType) =>
        Promise.resolve(entity),
      );

      await service.update('concept-type-1', { isUsuryRateConcept: true });

      expect(updateQueryBuilder.andWhere).toHaveBeenCalledWith(
        'id != :exceptId',
        { exceptId: 'concept-type-1' },
      );
    });
  });

  describe('findMandatoryUsuryConcept', () => {
    it('returns the active, flagged concept for a category', async () => {
      repository.findOneBy.mockResolvedValue({
        ...mockConceptType,
        isUsuryRateConcept: true,
      });

      const result = await service.findMandatoryUsuryConcept(
        ConceptCategory.Corriente,
      );

      expect(repository.findOneBy).toHaveBeenCalledWith({
        category: ConceptCategory.Corriente,
        isUsuryRateConcept: true,
        isActive: true,
      });
      expect(result?.id).toBe(mockConceptType.id);
    });

    it('returns null when no concept is flagged for that category', async () => {
      repository.findOneBy.mockResolvedValue(null);

      const result = await service.findMandatoryUsuryConcept(
        ConceptCategory.Moratorio,
      );

      expect(result).toBeNull();
    });
  });

  describe('deactivate', () => {
    it('sets isActive to false', async () => {
      repository.findOneBy.mockResolvedValue({ ...mockConceptType });
      repository.save.mockImplementation((entity: InterestConceptType) =>
        Promise.resolve(entity),
      );

      const result = await service.deactivate('concept-type-1');

      expect(result.isActive).toBe(false);
    });

    it('throws NotFoundException when the type does not exist', async () => {
      repository.findOneBy.mockResolvedValue(null);

      await expect(service.deactivate('missing-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
