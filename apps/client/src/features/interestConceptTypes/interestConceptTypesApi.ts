import { apiClient } from '@/lib/apiClient';

// Matches apps/api/src/interestConceptTypes/entities/interestConceptType.entity.ts exactly.
export enum ConceptCalculationType {
  Percentage = 'percentage',
  FixedAmount = 'fixed_amount',
}

// Phase 23 — which side of the concept engine a type belongs to. Corriente
// concepts price a loan's ordinary cost at generation time (unchanged since
// Phase 14); moratorio concepts only apply once an installment is overdue,
// computed live instead of stored. See
// docs/phases/PHASE_23_DYNAMIC_CHARGES.md.
export enum ConceptCategory {
  Corriente = 'corriente',
  Moratorio = 'moratorio',
}

// Only meaningful when defaultCalculationType is FixedAmount and category is
// Corriente — a moratorio fixed_amount concept is always charged once, flat,
// the moment an installment goes overdue, so it has no distribution to pick.
//
// RepeatedEachInstallment replaced FirstInstallmentOnly, 2026-09-03 — see
// the entity's own comment in the API for the full explanation.
export enum FixedAmountDistribution {
  SplitAcrossInstallments = 'split_across_installments',
  RepeatedEachInstallment = 'repeated_each_installment',
}

// Admin-managed catalog of interest/fee concepts (e.g. "Interés
// remuneratorio", "Gastos de cobranza") — confirmed with the client this
// must stay open-ended, not a fixed list. See
// docs/phases/PHASE_14_INTEREST_CONCEPTS.md.
export interface InterestConceptType {
  id: string;
  name: string;
  defaultCalculationType: ConceptCalculationType;
  defaultValue: number | null;
  category: ConceptCategory;
  fixedAmountDistribution: FixedAmountDistribution | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface InterestConceptTypesQueryParams {
  // true (default) for active types, false for deactivated ones — same
  // convention as ClientsQueryParams/QueryUsersDto.
  isActive?: boolean;
}

export interface CreateInterestConceptTypeInput {
  name: string;
  defaultCalculationType: ConceptCalculationType;
  category: ConceptCategory;
  // Required (enforced server-side, "no silent default") when
  // defaultCalculationType is FixedAmount and category is Corriente.
  fixedAmountDistribution?: FixedAmountDistribution;
  defaultValue?: number;
}

export type UpdateInterestConceptTypeInput =
  Partial<CreateInterestConceptTypeInput>;

export const interestConceptTypesApi = {
  // Reading the catalog is open to any authenticated user as of Phase 23
  // (needed by the loan-creation concept picker); only create/update/
  // deactivate below stay restricted to admins or those granted the
  // interest_concept_types module. See
  // docs/phases/PHASE_23_DYNAMIC_CHARGES.md "Permissions".
  getAll: async (
    params: InterestConceptTypesQueryParams = {},
  ): Promise<InterestConceptType[]> => {
    const { data } = await apiClient.get<InterestConceptType[]>(
      '/interest-concept-types',
      { isActive: params.isActive },
    );
    return data;
  },

  create: async (
    input: CreateInterestConceptTypeInput,
  ): Promise<InterestConceptType> => {
    const { data } = await apiClient.post<InterestConceptType>(
      '/interest-concept-types',
      input,
    );
    return data;
  },

  update: async (
    id: string,
    input: UpdateInterestConceptTypeInput,
  ): Promise<InterestConceptType> => {
    const { data } = await apiClient.patch<InterestConceptType>(
      `/interest-concept-types/${id}`,
      input,
    );
    return data;
  },

  // Removes it from the picker for new loans — existing loans that already
  // used it keep their snapshotted values, unaffected.
  deactivate: async (id: string): Promise<InterestConceptType> => {
    const { data } = await apiClient.patch<InterestConceptType>(
      `/interest-concept-types/${id}/deactivate`,
    );
    return data;
  },

  // Inverse of deactivate() — safe at any time, including for a type
  // already used on past loans (those keep their own snapshotted
  // name/value regardless, see deactivate()'s comment). Only re-adds it to
  // the picker for new loans.
  activate: async (id: string): Promise<InterestConceptType> => {
    const { data } = await apiClient.patch<InterestConceptType>(
      `/interest-concept-types/${id}/activate`,
    );
    return data;
  },

  // Permanent, irreversible deletion — for a type created by mistake and
  // never used. Only allowed for an already-deactivated, never-used type
  // (enforced server-side, see InterestConceptTypesService.remove).
  remove: async (id: string): Promise<void> => {
    await apiClient.delete(`/interest-concept-types/${id}`);
  },
};
