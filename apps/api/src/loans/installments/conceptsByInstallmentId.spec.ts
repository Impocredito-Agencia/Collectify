import { Repository } from 'typeorm';

import { LoanInstallmentConcept } from '../entities/loanInstallmentConcept.entity';
import {
  ConceptCalculationType,
  ConceptCategory,
} from '../../interestConceptTypes/entities/interestConceptType.entity';

import { findConceptsByInstallmentId } from './conceptsByInstallmentId';

function buildConcept(
  overrides: Partial<LoanInstallmentConcept>,
): LoanInstallmentConcept {
  return {
    id: 'concept-id',
    installmentId: 'inst-1',
    installment: undefined as never,
    interestConceptTypeId: null,
    interestConceptType: null,
    nameSnapshot: 'Intereses moratorios',
    calculationType: ConceptCalculationType.Percentage,
    category: ConceptCategory.Moratorio,
    value: 2.1,
    computedAmount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
}

describe('findConceptsByInstallmentId', () => {
  let loanInstallmentConceptsRepository: { find: jest.Mock };

  beforeEach(() => {
    loanInstallmentConceptsRepository = { find: jest.fn() };
  });

  it('returns an empty map without querying when given no ids', async () => {
    const result = await findConceptsByInstallmentId(
      loanInstallmentConceptsRepository as unknown as Repository<LoanInstallmentConcept>,
      [],
    );

    expect(result.size).toBe(0);
    expect(loanInstallmentConceptsRepository.find).not.toHaveBeenCalled();
  });

  it('groups multiple concepts against the same installment', async () => {
    loanInstallmentConceptsRepository.find.mockResolvedValue([
      buildConcept({ id: 'c1', installmentId: 'inst-1' }),
      buildConcept({ id: 'c2', installmentId: 'inst-1' }),
    ]);

    const result = await findConceptsByInstallmentId(
      loanInstallmentConceptsRepository as unknown as Repository<LoanInstallmentConcept>,
      ['inst-1'],
    );

    expect(result.get('inst-1')).toHaveLength(2);
  });

  it('keeps concepts separate per installment', async () => {
    loanInstallmentConceptsRepository.find.mockResolvedValue([
      buildConcept({ id: 'c1', installmentId: 'inst-1' }),
      buildConcept({ id: 'c2', installmentId: 'inst-2' }),
    ]);

    const result = await findConceptsByInstallmentId(
      loanInstallmentConceptsRepository as unknown as Repository<LoanInstallmentConcept>,
      ['inst-1', 'inst-2'],
    );

    expect(result.get('inst-1')).toHaveLength(1);
    expect(result.get('inst-2')).toHaveLength(1);
  });

  it('omits an installment id with no concepts from the map entirely', async () => {
    loanInstallmentConceptsRepository.find.mockResolvedValue([]);

    const result = await findConceptsByInstallmentId(
      loanInstallmentConceptsRepository as unknown as Repository<LoanInstallmentConcept>,
      ['inst-1'],
    );

    expect(result.has('inst-1')).toBe(false);
  });
});
