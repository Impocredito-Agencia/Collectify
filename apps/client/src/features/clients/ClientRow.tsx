import { RowActionButton } from '@/components/ui/RowActionButton';
import { Td } from '@/components/ui/Table';
import { moraBadgeClasses } from '@/features/loans/loanStatusDisplay';
import { formatPhoneNumber } from '@/lib/format';

import type { ClientListItem } from '@/features/clients/clientsApi';

interface ClientRowProps {
  client: ClientListItem;
  // Row number for the "#" column (F-10). Purely a display sequence
  // computed from the current page/limit — not persisted or backed by any
  // field on the entity.
  rowNumber: number;
  canManageClient: boolean;
  onEdit: () => void;
  onDeactivate: () => void;
  onReactivate: () => void;
}

// Active clients can be viewed/edited; inactive (soft-deleted) ones can't:
// apps/api's ClientsService.findOne() excludes soft-deleted rows (no
// `withDeleted`), so GET/PATCH /clients/:id 404 for them — only the list
// endpoint shows them at all, via `isActive=false`. An inactive row's only
// action is "Reactivar" (PATCH /clients/:id/reactivate — admin or granted
// the clients module, per Phase 20's @RequireModule(AppModule.Clients);
// was admin only — see docs/phases/PHASE_10_CLIENT_CAPACITY.md and
// docs/phases/PHASE_20_MODULE_PERMISSIONS.md), which restores it to active.
export function ClientRow({
  client,
  rowNumber,
  canManageClient,
  onEdit,
  onDeactivate,
  onReactivate,
}: ClientRowProps) {
  const isActive = client.deletedAt === null;

  return (
    <tr className="divide-x divide-border border-t border-border">
      <Td muted>{rowNumber}</Td>
      <Td>
        {client.firstName} {client.lastName}
      </Td>
      <Td className="text-center">{client.documentNumber}</Td>
      <Td className="text-center">{formatPhoneNumber(client.phoneNumber)}</Td>
      <Td className="text-center">{client.activeLoanCount}</Td>
      <Td className="text-center">
        <span
          className={`rounded-[3px] border px-2 py-[3px] text-meta font-medium ${moraBadgeClasses(client.maxOverdueDays)}`}
        >
          {client.maxOverdueDays} días
        </span>
      </Td>
      <Td className="text-center">
        <span
          className={
            isActive
              ? 'rounded-[3px] border border-muted bg-border px-2 py-[3px] text-meta font-medium text-white'
              : 'rounded-[3px] border border-mid bg-border px-2 py-[3px] text-meta font-medium text-mid'
          }
        >
          {isActive ? 'Activo' : 'Inactivo'}
        </span>
      </Td>
      <Td className="text-center">
        {isActive ? (
          <div className="flex justify-center gap-2">
            <RowActionButton to={`/clientes/${client.id}`}>
              Ver detalle
            </RowActionButton>
            {canManageClient && (
              <RowActionButton onClick={onEdit}>Editar</RowActionButton>
            )}
            {canManageClient && (
              <RowActionButton onClick={onDeactivate} tone="subtle">
                Desactivar
              </RowActionButton>
            )}
          </div>
        ) : canManageClient ? (
          <RowActionButton onClick={onReactivate}>Reactivar</RowActionButton>
        ) : (
          <span className="text-meta text-mid">Sin acciones disponibles</span>
        )}
      </Td>
    </tr>
  );
}
