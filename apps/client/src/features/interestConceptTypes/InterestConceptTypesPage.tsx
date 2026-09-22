import { useState } from 'react';

import { Header } from '@/components/layout/Header';
import { Button } from '@/components/ui/Button';
import { FilterTab } from '@/components/ui/FilterTab';
import { RowActionButton } from '@/components/ui/RowActionButton';
import { DeactivateConceptTypeDialog } from '@/features/interestConceptTypes/DeactivateConceptTypeDialog';
import { DeleteConceptTypeDialog } from '@/features/interestConceptTypes/DeleteConceptTypeDialog';
import { InterestConceptTypeForm } from '@/features/interestConceptTypes/InterestConceptTypeForm';
import {
  ConceptCalculationType,
  ConceptCategory,
} from '@/features/interestConceptTypes/interestConceptTypesApi';
import {
  useActivateInterestConceptType,
  useCreateInterestConceptType,
  useDeactivateInterestConceptType,
  useDeleteInterestConceptType,
  useInterestConceptTypes,
  useUpdateInterestConceptType,
} from '@/features/interestConceptTypes/useInterestConceptTypes';

import type { InterestConceptType } from '@/features/interestConceptTypes/interestConceptTypesApi';

function formatDefaultValue(conceptType: InterestConceptType): string {
  if (conceptType.defaultValue == null) {
    return 'Sin valor por defecto';
  }
  return conceptType.defaultCalculationType ===
    ConceptCalculationType.Percentage
    ? `${conceptType.defaultValue}%`
    : `$${conceptType.defaultValue.toLocaleString('es-CO')}`;
}

// Admin screen for the catalog of additional-charge types introduced in
// Phase 14 — the admin can add new charge types whenever needed, not pick
// from a fixed list. Loans pick from this catalog at creation time
// (LoanForm.tsx). Deactivating a type only removes it from that picker —
// loans that already used it keep the name/value they were generated with
// (snapshot), unaffected. Human request, 2026-09-03 — a type can also be
// permanently deleted (see "Eliminar" on the Desactivados tab), but only
// once deactivated and only if it was never actually used on any loan; a
// type created by mistake and never used can be fully removed, one already
// used on a loan can only stay deactivated. See
// InterestConceptTypesService.remove().
export function InterestConceptTypesPage() {
  const [showInactive, setShowInactive] = useState(false);
  const {
    data: conceptTypes,
    isLoading,
    isError,
  } = useInterestConceptTypes({
    isActive: !showInactive,
  });

  const [formTarget, setFormTarget] = useState<
    InterestConceptType | 'new' | null
  >(null);
  // Style cleanup, 2026-09-03 — "Desactivar" used to call the mutation
  // directly with zero confirmation, unlike every other deactivate action
  // in the app. See DeactivateConceptTypeDialog.
  const [deactivatingConceptType, setDeactivatingConceptType] =
    useState<InterestConceptType | null>(null);
  // Only ever set from the Desactivados tab (see the "Eliminar" button
  // below) — the dialog itself surfaces the server's "already used on a
  // loan" rejection inline if it turns out this type isn't actually
  // deletable. See DeleteConceptTypeDialog.
  const [deletingConceptType, setDeletingConceptType] =
    useState<InterestConceptType | null>(null);

  const createConceptType = useCreateInterestConceptType();
  const updateConceptType = useUpdateInterestConceptType();
  const deactivateConceptType = useDeactivateInterestConceptType();
  const activateConceptType = useActivateInterestConceptType();
  const deleteConceptType = useDeleteInterestConceptType();

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <Header
          title="Tipos de cargo"
          subtitle="Catálogo de cargos corrientes y moratorios usado al crear préstamos"
        />
        <Button
          onClick={() => setFormTarget('new')}
          className="flex items-center gap-1.5"
        >
          {/* Matches the "+ Nuevo cliente"/"+ Nuevo préstamo" buttons —
              this one was missing the icon entirely. */}
          <svg
            className="size-3.5 shrink-0"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
          >
            <path
              d="M10 4v12M4 10h12"
              strokeWidth="1.75"
              strokeLinecap="round"
            />
          </svg>
          Nuevo cargo
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <FilterTab
          label="Activos"
          isActive={!showInactive}
          onClick={() => setShowInactive(false)}
        />
        <FilterTab
          label="Desactivados"
          isActive={showInactive}
          onClick={() => setShowInactive(true)}
        />
      </div>

      {isLoading && <p className="text-small text-muted">Cargando…</p>}
      {isError && (
        <p className="text-small text-danger" role="alert">
          No se pudieron cargar los cargos adicionales.
        </p>
      )}
      {!isLoading && !isError && conceptTypes?.length === 0 && (
        <p className="text-small text-muted">
          {showInactive
            ? 'No hay cargos adicionales desactivados.'
            : 'Todavía no hay cargos adicionales — crea el primero.'}
        </p>
      )}

      {/* Style cleanup, 2026-09-05 (human report — one full-width row per
          charge wasted almost all the horizontal space for a name, a
          badge, and two buttons). Grid of cards, 3 per row, grouped into a
          "Corrientes"/"Moratorios" section each — same two-section pattern
          DashboardPage already uses for Cartera/Mensajería. The per-card
          category badge is dropped since the section header now carries
          that same information; a card only ever appears in the section
          matching its own category, so nothing is lost. */}
      {!isLoading && !isError && conceptTypes && conceptTypes.length > 0 && (
        <div className="flex flex-col gap-5">
          <ConceptTypeSection
            title="Corrientes"
            conceptTypes={conceptTypes.filter(
              (c) => c.category === ConceptCategory.Corriente,
            )}
            showInactive={showInactive}
            onEdit={setFormTarget}
            onDeactivate={setDeactivatingConceptType}
            onActivate={(conceptType) =>
              activateConceptType.mutate(conceptType.id)
            }
            onDelete={setDeletingConceptType}
          />
          <ConceptTypeSection
            title="Moratorios"
            conceptTypes={conceptTypes.filter(
              (c) => c.category === ConceptCategory.Moratorio,
            )}
            showInactive={showInactive}
            onEdit={setFormTarget}
            onDeactivate={setDeactivatingConceptType}
            onActivate={(conceptType) =>
              activateConceptType.mutate(conceptType.id)
            }
            onDelete={setDeletingConceptType}
          />
        </div>
      )}

      {formTarget && (
        <InterestConceptTypeForm
          conceptType={formTarget === 'new' ? undefined : formTarget}
          onSubmit={(input) =>
            formTarget === 'new'
              ? createConceptType.mutateAsync(input)
              : updateConceptType.mutateAsync({ id: formTarget.id, input })
          }
          onClose={() => setFormTarget(null)}
        />
      )}

      {deactivatingConceptType && (
        <DeactivateConceptTypeDialog
          conceptTypeName={deactivatingConceptType.name}
          onClose={() => setDeactivatingConceptType(null)}
          onConfirm={() =>
            deactivateConceptType.mutateAsync(deactivatingConceptType.id)
          }
        />
      )}

      {deletingConceptType && (
        <DeleteConceptTypeDialog
          conceptTypeName={deletingConceptType.name}
          onClose={() => setDeletingConceptType(null)}
          onConfirm={() =>
            deleteConceptType.mutateAsync(deletingConceptType.id)
          }
        />
      )}
    </div>
  );
}

// A category with zero charges renders nothing rather than an empty
// header — relevant in practice since Moratorios starts out empty on a
// fresh catalog until the admin creates one.
function ConceptTypeSection({
  title,
  conceptTypes,
  showInactive,
  onEdit,
  onDeactivate,
  onActivate,
  onDelete,
}: {
  title: string;
  conceptTypes: InterestConceptType[];
  showInactive: boolean;
  onEdit: (conceptType: InterestConceptType) => void;
  onDeactivate: (conceptType: InterestConceptType) => void;
  onActivate: (conceptType: InterestConceptType) => void;
  onDelete: (conceptType: InterestConceptType) => void;
}) {
  if (conceptTypes.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-col gap-2.5">
      <span className="text-section-label font-normal tracking-normal text-subtle">
        {title}
      </span>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {conceptTypes.map((conceptType) => (
          <div
            key={conceptType.id}
            className="flex flex-col gap-2 rounded-lg bg-surface p-4"
          >
            <div className="flex flex-col gap-0.5">
              <span className="text-card-title font-medium text-white">
                {conceptType.name}
              </span>
              <span className="text-meta text-muted">
                {conceptType.defaultCalculationType ===
                ConceptCalculationType.Percentage
                  ? 'Porcentaje'
                  : 'Monto fijo'}{' '}
                · {formatDefaultValue(conceptType)}
              </span>
            </div>
            {!showInactive && (
              // Style cleanup, 2026-09-03 (human report — "Editar" was
              // easy to miss entirely) — matches every other list's
              // pill-style action buttons (Clientes, Usuarios, Préstamos)
              // instead of the plain, borderless text this page used to
              // have. See RowActionButton.
              <div className="mt-1 flex items-center gap-2">
                <RowActionButton onClick={() => onEdit(conceptType)}>
                  Editar
                </RowActionButton>
                <RowActionButton
                  onClick={() => onDeactivate(conceptType)}
                  tone="subtle"
                >
                  Desactivar
                </RowActionButton>
              </div>
            )}
            {/* Only on the Desactivados tab — mirrors UserRow.tsx's
                "Eliminar" gating (only shown for an already-inactive
                account). The server enforces "never used on a loan";
                this button doesn't try to know that upfront.
                "Reactivar" fires directly with no confirmation dialog —
                same as ClientRow.tsx's client reactivation — since it's
                always safe/reversible (see the service's own comment): a
                type already used on past loans keeps those loans'
                snapshotted values untouched either way. */}
            {showInactive && (
              <div className="mt-1 flex items-center gap-2">
                <RowActionButton onClick={() => onActivate(conceptType)}>
                  Reactivar
                </RowActionButton>
                <RowActionButton
                  onClick={() => onDelete(conceptType)}
                  tone="subtle"
                >
                  Eliminar
                </RowActionButton>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
