import { CloseButton } from '@/components/ui/CloseButton';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { MessageBreakdown } from '@/features/messageLogs/MessageBreakdown';
import { useMessageLogItems } from '@/features/messageLogs/useMessageLogs';
import { formatCurrency, formatPhoneNumber } from '@/lib/format';
import { useEscapeKey } from '@/lib/useEscapeKey';

import type { MessageLog } from '@/features/messageLogs/messageLogsApi';

interface MessageLogDrawerProps {
  log: MessageLog;
  onClose: () => void;
}

// Matches Figma F-24 "Mensaje completo — Drawer lateral", with a few
// sections dropped or changed from what the mockup shows — none of this
// data is stored, confirmed against the MessageLog/MessageLogItem
// entities:
//   - "Estado: Leído — Entregado y leído el..." → just "Enviado"/"Fallido".
//     No delivery/read receipt tracking exists (no WhatsApp webhook
//     integration) — the backend only knows whether the initial send
//     succeeded or failed, synchronously, at send time.
//   - "Enviado por: CronJob automático — 09:14" → dropped. Not recorded
//     whether a send was triggered by the weekly cron or a manual button.
//   - "Plantilla usada" + "Ver plantilla" → dropped. MessageLog stores the
//     fully-rendered text (correct — templates can change later, the log
//     is a historical snapshot), but has no foreign key back to which
//     template produced it.
//   - "Préstamo relacionado: #P-001 — 98 días en mora" (singular) →
//     replaced with a real list. One overdue reminder can cover several
//     installments across several loans (it's consolidated per client,
//     not per loan) — backed by a new endpoint, GET
//     /message-logs/:id/items, added this phase for exactly this section.
// See apps/client/docs/DESIGN_TOKENS.md "Known design/backend gaps".
export function MessageLogDrawer({ log, onClose }: MessageLogDrawerProps) {
  const { data: items, isLoading } = useMessageLogItems(log.id);
  const clientFullName = `${log.client.firstName} ${log.client.lastName}`;

  useEscapeKey(onClose);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-sm">
      <div className="flex h-full w-full max-w-[420px] flex-col overflow-y-auto border-l border-border bg-surface px-7 py-6">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-card-title font-medium text-white">
              Mensaje completo
            </h2>
            <p className="mt-0.5 text-label text-muted">
              {clientFullName} ·{' '}
              {new Date(log.sentAt).toLocaleDateString('es-CO')}
            </p>
          </div>
          <CloseButton onClick={onClose} />
        </div>

        <div className="mt-5 flex flex-col gap-4">
          <DetailField label="Destinatario" value={clientFullName} />
          <DetailField
            label="Celular"
            value={formatPhoneNumber(log.phoneNumber)}
          />
          <DetailField
            label="Fecha y hora"
            value={new Date(log.sentAt).toLocaleString('es-CO', {
              dateStyle: 'long',
              timeStyle: 'short',
            })}
          />
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-normal tracking-normal text-muted">
              ESTADO
            </span>
            <StatusBadge
              tone={log.status === 'sent' ? 'success' : 'danger'}
              className="w-fit"
            >
              {log.status === 'sent' ? 'Enviado' : 'Fallido'}
            </StatusBadge>
          </div>
        </div>

        <div className="mt-5 border-t border-border" />

        <div className="mt-5 flex flex-col gap-1.5">
          <span className="text-[10px] font-normal tracking-normal text-muted">
            MENSAJE COMPLETO
          </span>
          <div className="rounded bg-whatsapp-bg p-3">
            <p className="text-meta text-muted">WhatsApp · Collectify</p>
            <p className="mt-1 whitespace-pre-wrap text-small text-white">
              {log.messageContent}
            </p>
          </div>
          {log.breakdownContent && (
            <MessageBreakdown breakdownContent={log.breakdownContent} />
          )}
        </div>

        <div className="mt-5 border-t border-border" />

        <div className="mt-5 flex flex-col gap-2">
          <span className="text-[10px] font-normal tracking-normal text-muted">
            CUOTAS INCLUIDAS EN ESTE MENSAJE
          </span>
          {isLoading && <p className="text-small text-muted">Cargando…</p>}
          {!isLoading && items?.length === 0 && (
            <p className="text-small text-muted">
              No hay cuotas asociadas a este mensaje.
            </p>
          )}
          {items?.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between rounded border border-border bg-input px-3 py-2"
            >
              <span className="text-small text-white">
                Cuota {item.installment.installmentNumber} — pagaré #
                {item.installment.loan.promissoryNoteNumber}
              </span>
              <span className="text-meta text-muted">
                {item.overdueDaysSnapshot} días ·{' '}
                {formatCurrency(item.interestSnapshot)} interés
              </span>
            </div>
          ))}
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
