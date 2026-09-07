import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { LoanInstallmentConcept } from '../loans/entities/loanInstallmentConcept.entity';

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
    delete: jest.Mock;
  };
  let loanInstallmentConceptsRepository: {
    count: jest.Mock;
  };

  const mockConceptType: InterestConceptType = {
    id: 'concept-type-1',
    name: 'Gastos de cobranza',
    defaultCalculationType: ConceptCalculationType.Percentage,
    defaultValue: 3,
    category: ConceptCategory.Corriente,
    fixedAmountDistribution: null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };

  beforeEach(async () => {
    repository = {
      find: jest.fn(),
      findOneBy: jest.fn(),
      create: jest.fn((dto: Partial<InterestConceptType>) => dto),
      save: jest.fn(),
      delete: jest.fn(),
    };
    loanInstallmentConceptsRepository = {
      count: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InterestConceptTypesService,
        {
          provide: getRepositoryToken(InterestConceptType),
          useValue: repository,
        },
        {
          provide: getRepositoryToken(LoanInstallmentConcept),
          useValue: loanInstallmentConceptsRepository,
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

    // Feature request, 2026-09-06 (human) — widened alongside
    // WidenConceptValuePrecision so a percentage cargo can actually be
    // stored to 4 decimals instead of silently rounding to 2. Still capped
    // at 2 for fixed_amount, since that's a plain currency figure.
    it('accepts a percentage default value with up to 4 decimal places', async () => {
      repository.save.mockImplementation(
        (entity: Partial<InterestConceptType>) =>
          Promise.resolve({ ...mockConceptType, ...entity }),
      );

      await service.create({
        name: 'Interés remuneratorio',
        defaultCalculationType: ConceptCalculationType.Percentage,
        defaultValue: 2.1234,
        category: ConceptCategory.Corriente,
      });

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ defaultValue: 2.1234 }),
      );
    });

    it('rejects a percentage default value with more than 4 decimal places', async () => {
      await expect(
        service.create({
          name: 'Interés remuneratorio',
          defaultCalculationType: ConceptCalculationType.Percentage,
          defaultValue: 2.12345,
          category: ConceptCategory.Corriente,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(repository.save).not.toHaveBeenCalled();
    });

    it('rejects a fixed_amount default value with more than 2 decimal places', async () => {
      await expect(
        service.create({
          name: 'Seguro',
          defaultCalculationType: ConceptCalculationType.FixedAmount,
          defaultValue: 15000.123,
          category: ConceptCategory.Corriente,
          fixedAmountDistribution:
            FixedAmountDistribution.SplitAcrossInstallments,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(repository.save).not.toHaveBeenCalled();
    });

    it('accepts a fixed_amount default value with exactly 2 decimal places', async () => {
      repository.save.mockImplementation(
        (entity: Partial<InterestConceptType>) =>
          Promise.resolve({ ...mockConceptType, ...entity }),
      );

      await service.create({
        name: 'Seguro',
        defaultCalculationType: ConceptCalculationType.FixedAmount,
        defaultValue: 15000.12,
        category: ConceptCategory.Corriente,
        fixedAmountDistribution:
          FixedAmountDistribution.SplitAcrossInstallments,
      });

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ defaultValue: 15000.12 }),
      );
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

    it('rejects updating defaultValue to a percentage with more than 4 decimal places', async () => {
      repository.findOneBy.mockResolvedValue({ ...mockConceptType });

      await expect(
        service.update('concept-type-1', { defaultValue: 5.12345 }),
      ).rejects.toThrow(BadRequestException);
      expect(repository.save).not.toHaveBeenCalled();
    });

    // Cross-field case: defaultValue itself isn't touched by this update,
    // but flipping the calculation type to fixed_amount makes the existing
    // 4-decimal percentage value invalid — must be validated against the
    // RESULTING combination, not just whatever this one request happens to
    // include.
    it('rejects flipping calculationType to fixed_amount when the existing stored value has more than 2 decimal places', async () => {
      repository.findOneBy.mockResolvedValue({
        ...mockConceptType,
        defaultCalculationType: ConceptCalculationType.Percentage,
        defaultValue: 2.1234,
      });

      await expect(
        service.update('concept-type-1', {
          defaultCalculationType: ConceptCalculationType.FixedAmount,
          fixedAmountDistribution:
            FixedAmountDistribution.SplitAcrossInstallments,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(repository.save).not.toHaveBeenCalled();
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

  // Human request, 2026-09-05 — the inverse of deactivate(), so a
  // deactivated type (including one already used on a loan, which can
  // never be deleted — see remove()'s own tests below) isn't stuck
  // inactive forever.
  describe('activate', () => {
    it('sets isActive to true', async () => {
      repository.findOneBy.mockResolvedValue({
        ...mockConceptType,
        isActive: false,
      });
      repository.save.mockImplementation((entity: InterestConceptType) =>
        Promise.resolve(entity),
      );

      const result = await service.activate('concept-type-1');

      expect(result.isActive).toBe(true);
    });

    it('throws NotFoundException when the type does not exist', async () => {
      repository.findOneBy.mockResolvedValue(null);

      await expect(service.activate('missing-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // Human request, 2026-09-03 — a real hard delete, for a type created by
  // mistake and never used, distinct from deactivate() above. Mirrors
  // UsersService.remove()'s tests.
  describe('remove', () => {
    it('throws NotFoundException when the type does not exist', async () => {
      repository.findOneBy.mockResolvedValue(null);

      await expect(service.remove('missing-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('rejects deleting a type that is still active', async () => {
      repository.findOneBy.mockResolvedValue({ ...mockConceptType });

      await expect(service.remove('concept-type-1')).rejects.toThrow(
        BadRequestException,
      );
      expect(repository.delete).not.toHaveBeenCalled();
    });

    it('rejects deleting a deactivated type that has already been used on a loan', async () => {
      repository.findOneBy.mockResolvedValue({
        ...mockConceptType,
        isActive: false,
      });
      loanInstallmentConceptsRepository.count.mockResolvedValue(1);

      await expect(service.remove('concept-type-1')).rejects.toThrow(
        BadRequestException,
      );
      expect(repository.delete).not.toHaveBeenCalled();
    });

    it('deletes a deactivated, never-used type', async () => {
      repository.findOneBy.mockResolvedValue({
        ...mockConceptType,
        isActive: false,
      });
      loanInstallmentConceptsRepository.count.mockResolvedValue(0);

      await service.remove('concept-type-1');

      expect(loanInstallmentConceptsRepository.count).toHaveBeenCalledWith({
        where: { interestConceptTypeId: 'concept-type-1' },
        withDeleted: true,
      });
      expect(repository.delete).toHaveBeenCalledWith({
        id: 'concept-type-1',
      });
    });
  });
});
