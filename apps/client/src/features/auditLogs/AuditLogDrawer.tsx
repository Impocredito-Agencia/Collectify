import { CloseButton } from '@/components/ui/CloseButton';
import {
  formatAuditAction,
  formatAuditEntityType,
} from '@/features/auditLogs/auditLogLabels';
import { useEscapeKey } from '@/lib/useEscapeKey';

import type { AuditLog } from '@/features/auditLogs/auditLogsApi';

interface AuditLogDrawerProps {
  entry: AuditLog;
  onClose: () => void;
}

// Mirrors MessageLogDrawer.tsx's layout. Unlike that drawer (which shows a
// rendered WhatsApp message), an audit log entry's "full content" is its
// metadata payload — shape varies per action (see
// AuditLogInterceptor.buildMetadata) — so it's shown as formatted JSON
// rather than a bespoke field-by-field breakdown per action type.
export function AuditLogDrawer({ entry, onClose }: AuditLogDrawerProps) {
  useEscapeKey(onClose);

  const actorLabel = entry.actorUser
    ? `${entry.actorUser.fullName} (${entry.actorUser.email})`
    : 'Sin actor (acción automática)';

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-sm">
      <div className="flex h-full w-full max-w-[420px] flex-col overflow-y-auto border-l border-border bg-surface px-7 py-6">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-card-title font-medium text-white">
              Detalle de auditoría
            </h2>
            <p className="mt-0.5 text-label text-muted">
              {new Date(entry.createdAt).toLocaleString('es-CO', {
                dateStyle: 'long',
                timeStyle: 'short',
              })}
            </p>
          </div>
          <CloseButton onClick={onClose} />
        </div>

        <div className="mt-5 flex flex-col gap-4">
          <DetailField label="Actor" value={actorLabel} />
          {/* Friendly label plus the raw @Audit() code in parentheses —
              this drawer is exactly where the precise technical action
              matters (e.g. while testing), so unlike the table it keeps
              both instead of only the friendly text. See
              auditLogLabels.ts. */}
          <DetailField
            label="Acción"
            value={
              formatAuditAction(entry.action) !== entry.action
                ? `${formatAuditAction(entry.action)} (${entry.action})`
                : entry.action
            }
          />
          {/* entityLabel is the actual "which one?" answer (see
              AuditLog.entityLabel); entityType + the full id stays
              underneath for the cases where no label could be resolved,
              or when the raw id itself is what's needed (e.g. to paste
              into a support query). */}
          <DetailField
            label="Entidad"
            value={
              entry.entityLabel
                ? entry.entityLabel
                : formatAuditEntityType(entry.entityType)
            }
          />
          {entry.entityId && (
            <DetailField
              label="ID del registro"
              value={`${formatAuditEntityType(entry.entityType)} · ${entry.entityId}`}
            />
          )}
        </div>

        <div className="mt-5 border-t border-border" />

        <div className="mt-5 flex flex-col gap-1.5">
          <span className="text-[10px] font-normal tracking-normal text-muted">
            DATOS DE LA SOLICITUD
          </span>
          <div className="rounded bg-input p-3">
            {entry.metadata ? (
              <pre className="overflow-x-auto whitespace-pre-wrap break-words text-meta text-muted">
                {JSON.stringify(entry.metadata, null, 2)}
              </pre>
            ) : (
              <p className="text-small text-muted">
                Esta acción no registró datos adicionales.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-normal tracking-normal text-muted">
        {label.toUpperCase()}
      </span>
      <span className="text-small text-white">{value}</span>
    </div>
  );
}
