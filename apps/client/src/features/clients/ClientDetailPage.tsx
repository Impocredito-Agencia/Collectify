import { useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';

import { ImageLightbox } from '@/components/ui/ImageLightbox';
import { useAuth } from '@/features/auth/useAuth';
import { ClientForm } from '@/features/clients/ClientForm';
import {
  CLIENT_REFERENCE_TYPE_LABELS,
  DOCUMENT_TYPE_LABELS,
} from '@/features/clients/clientsApi';
import { DeactivateClientDialog } from '@/features/clients/DeactivateClientDialog';
import {
  useClearClientMessageFrequency,
  useClient,
  useDeleteClient,
  useSetClientMessageFrequency,
  useUpdateClient,
} from '@/features/clients/useClients';
import {
  estadoBadge,
  moraBadgeClasses,
} from '@/features/loans/loanStatusDisplay';
import { useLoans } from '@/features/loans/useLoans';
import { MessageLogStatus } from '@/features/messageLogs/messageLogsApi';
import { useMessageLogs } from '@/features/messageLogs/useMessageLogs';
import { messageTypeLabel } from '@/features/messageTemplates/messageTemplatesApi';
import {
  useSendReminder,
  useSendUpcomingDueReminder,
} from '@/features/whatsapp/useWhatsapp';
import { ApiError } from '@/lib/apiClient';
import {
  formatCurrency,
  formatDateOnly,
  formatPhoneNumber,
  isPdfUrl,
} from '@/lib/format';

import type { ReactNode } from 'react';
import type { ClientDetail } from '@/features/clients/clientsApi';

// Matches Figma frame 40:554 ("F-14 / Detalle cliente"). The loans section
// was left as a placeholder when Phase 4 shipped — the loans feature
// (loansApi, useLoans, LoansListPage/LoanDetailPage) was built everywhere
// else, but nobody came back to wire it up here. GET /loans already
// accepts a clientId filter, so this only needed frontend work, no backend
// change. Reuses LoanRow.tsx's exact column/badge treatment (loanStatusDisplay.ts),
// minus the "Cliente" column (redundant — we're already on their page) and
// minus the "#" row-number column.
export function ClientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [isEditing, setIsEditing] = useState(false);
  const [isDeactivating, setIsDeactivating] = useState(false);
  // Phase 21 — same lightbox pattern as LoanDetailPage.tsx (Phase 12),
  // extracted into the shared ImageLightbox component so both pages reuse
  // it instead of each keeping a local copy.
  const [enlargedImage, setEnlargedImage] = useState<{
    url: string;
    alt: string;
  } | null>(null);

  const { data: client, isLoading, isError } = useClient(id ?? '');
  const updateClient = useUpdateClient();
  const deleteClient = useDeleteClient();
  // limit: 100 (not the table's display size — see displayedLoans below) so
  // the stats grid's sums are computed from this client's actual loans, not
  // just the first page. Fine for this business's real scale; if a client
  // ever has more than 100 loans the sums would undercount, same caveat as
  // the "Ver todos" link below.
  const {
    data: loans,
    isLoading: loansLoading,
    isError: loansError,
  } = useLoans({ clientId: id, limit: 100 });
  // Two separate queries on purpose: `messages` (unfiltered) feeds the
  // "Mensajes enviados" KPI card below, which must reflect the true total
  // regardless of status. `failedMessages` feeds the history list itself —
  // per the client's colleague, this tab should only ever surface
  // failed/unsent messages (mirrors the same change made to
  // MessageLogsPage.tsx), not a full sent+failed history.
  const { data: messages } = useMessageLogs({ clientId: id, limit: 5 });
  const { data: failedMessages } = useMessageLogs({
    clientId: id,
    status: MessageLogStatus.Failed,
    limit: 5,
  });
  const sendReminder = useSendReminder();
  const sendUpcomingDueReminder = useSendUpcomingDueReminder();
  const [sendError, setSendError] = useState<string | null>(null);

  if (!id) {
    return <Navigate to="/clientes" replace />;
  }

  if (isLoading) {
    return <p className="text-small text-muted">Cargando…</p>;
  }

  if (isError || !client) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-small text-red-400">
          {
            'No se pudo cargar este cliente. Puede que no exista o esté desactivado (los clientes inactivos no tienen página de detalle — ver "Known design/backend gaps" en apps/client/docs/DESIGN_TOKENS.md).'
          }
        </p>
        <Link to="/clientes" className="text-small text-muted hover:text-white">
          ← Volver a Clientes
        </Link>
      </div>
    );
  }

  const initials =
    `${client.firstName[0] ?? ''}${client.lastName[0] ?? ''}`.toUpperCase();

  // Stats grid — computed client-side from data this page already fetches
  // (loans + messages), rather than waiting on a dedicated dashboard
  // aggregate endpoint (Phase 7). Only the top 10 loans are shown in the
  // table below; these sums use the full fetched set (see the limit: 100
  // comment above).
  const allLoans = loans?.items ?? [];
  const displayedLoans = allLoans.slice(0, 10);
  const totalLoans = loans?.meta.total ?? 0;
  const totalPrincipal = allLoans.reduce(
    (sum, loan) => sum + loan.principalAmount,
    0,
  );
  // overdueBalance (not outstandingBalance) — only the amount that's
  // actually overdue, not the loan's whole remaining balance. Caught by
  // the client: a loan with several pending installments and only one
  // overdue was showing the sum of all of them here.
  const totalOverdueBalance = allLoans.reduce(
    (sum, loan) => sum + loan.overdueBalance,
    0,
  );
  const totalMessages = messages?.meta.total ?? 0;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-1.5 text-label">
        <Link to="/clientes" className="text-muted hover:text-white">
          Clientes
        </Link>
        <span className="text-mid">/</span>
        <span className="font-medium text-white">
          {client.firstName} {client.lastName}
        </span>
      </div>

      <div className="flex items-center justify-between rounded border border-border bg-surface px-6 py-5">
        <div className="flex items-center gap-5">
          <div className="flex size-[52px] shrink-0 items-center justify-center rounded-full bg-border">
            <span className="text-[16px] font-medium text-muted">
              {initials}
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-[18px] font-light text-white">
              {client.firstName} {client.lastName}
            </p>
            <div className="flex items-center gap-3">
              <span className="text-small text-muted">
                {formatPhoneNumber(client.phoneNumber)}
              </span>
              <span className="text-meta text-mid">·</span>
              <span className="text-small text-muted">
                CC {client.documentNumber}
              </span>
              <span className="rounded-[3px] border border-muted bg-border px-2 py-[3px] text-meta font-medium text-white">
                Activo
              </span>
              {client.isMoraBlocked && (
                <span
                  title="Este cliente tiene una cuota con más de 30 días de mora y no puede recibir un nuevo préstamo."
                  className="rounded-[3px] border border-[#ef4444] bg-[#240a0a] px-2 py-[3px] text-meta font-medium text-[#ef4444]"
                >
                  Bloqueado por mora
                </span>
              )}
            </div>
          </div>
        </div>

        {isAdmin && (
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => setIsEditing(true)}
              className="rounded border border-border bg-input px-4 py-2.5 text-small text-muted hover:text-white"
            >
              Editar
            </button>
            <button
              type="button"
              onClick={() => setIsDeactivating(true)}
              className="rounded border border-border bg-input px-4 py-2.5 text-small text-muted hover:text-white"
            >
              Desactivar
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-5 gap-4">
        <StatCard label="Préstamos totales" value={String(totalLoans)} />
        <StatCard
          label="Monto prestado"
          value={formatCurrency(totalPrincipal)}
        />
        <StatCard label="En mora" value={formatCurrency(totalOverdueBalance)} />
        <StatCard label="Mensajes enviados" value={String(totalMessages)} />
        {/* Computed on read by the backend (ClientsService.getCreditUsage),
            not stored — see docs/phases/PHASE_10_CLIENT_CAPACITY.md. Shows
            "Sin límite" instead of a dollar figure when the client has no
            cupo configured (creditLimit null), matching how the backend
            represents "no cupo enforced". */}
        <StatCard
          label="Cupo disponible"
          value={
            client.creditLimit === null
              ? 'Sin límite'
              : formatCurrency(client.creditAvailable ?? 0)
          }
        />
      </div>

      {/* Phase 21 — extended profile (KYC), sectioned the same way as
          ClientForm.tsx. Each DetailField skips rendering when its value
          is empty, so a client with a mostly-blank profile (e.g. one
          created before this phase) doesn't show a wall of "—" lines. See
          docs/phasesClient/PHASE_21_CLIENT_PROFILE.md. */}
      <div className="flex flex-col gap-4">
        <DetailSection title="DATOS PERSONALES">
          {/* Repeats the cédula already shown in the header above — per
              client feedback, seeing it again here next to the rest of
              the identification fields (tipo, fechas, lugar) is more
              useful than making them scroll up to cross-reference it. */}
          <DetailField label="Cédula" value={client.documentNumber} />
          <DetailField
            label="Documento"
            value={
              client.documentType
                ? DOCUMENT_TYPE_LABELS[client.documentType]
                : null
            }
          />
          <DetailField
            label="Fecha de nacimiento"
            value={
              client.dateOfBirth ? formatDateOnly(client.dateOfBirth) : null
            }
          />
          <DetailField
            label="Fecha de expedición"
            value={
              client.documentIssueDate
                ? formatDateOnly(client.documentIssueDate)
                : null
            }
          />
          <DetailField
            label="Lugar de expedición"
            value={client.documentIssuePlace}
          />
          <DetailField label="Ocupación" value={client.occupation} />
          <DetailField label="Empresa" value={client.employerName} />
          <DetailField
            label="Ingreso mensual"
            value={
              client.monthlyIncome !== null
                ? formatCurrency(client.monthlyIncome)
                : null
            }
          />
        </DetailSection>

        <DetailSection title="CONTACTO">
          {/* Repeats the celular already shown in the header above — same
              reasoning as the Cédula repeat in DATOS PERSONALES: right
              next to "Celular alterno" is more useful than the header. */}
          <DetailField
            label="Celular"
            value={formatPhoneNumber(client.phoneNumber)}
          />
          <DetailField
            label="Celular alterno"
            value={
              client.alternatePhoneNumber
                ? formatPhoneNumber(client.alternatePhoneNumber)
                : null
            }
          />
          <DetailField label="Correo electrónico" value={client.email} />
        </DetailSection>

        <DetailSection title="DIRECCIONES">
          <DetailField
            label="Dirección de residencia"
            value={client.homeAddress}
          />
          <DetailField
            label="Dirección de trabajo"
            value={client.workAddress}
          />
          <DetailField label="Barrio" value={client.neighborhood} />
          <DetailField label="Ciudad" value={client.city} />
        </DetailSection>

        <div className="flex flex-col gap-2.5 rounded border border-border bg-surface px-6 py-5">
          <span className="text-section-label font-medium tracking-[0.36px] text-muted">
            REFERENCIAS
          </span>
          {client.references.length === 0 ? (
            <p className="text-small text-muted">
              Sin referencias registradas.
            </p>
          ) : (
            <div className="flex flex-col gap-2.5">
              {client.references.map((reference) => (
                <div
                  key={reference.id}
                  className="flex items-center justify-between rounded border border-border bg-input px-3.5 py-2.5"
                >
                  <div className="flex flex-col gap-0.5">
                    <span className="text-small font-medium text-white">
                      {reference.fullName}
                    </span>
                    <span className="text-meta text-muted">
                      {reference.relationship}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-meta text-muted">
                      {formatPhoneNumber(reference.phoneNumber)}
                    </span>
                    <span className="rounded-[3px] border border-border bg-background px-2 py-[3px] text-meta text-muted">
                      {CLIENT_REFERENCE_TYPE_LABELS[reference.type]}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2.5 rounded border border-border bg-surface px-6 py-5">
          <span className="text-section-label font-medium tracking-[0.36px] text-muted">
            DOCUMENTOS
          </span>
          {!client.idDocumentFrontUrl &&
          !client.idDocumentBackUrl &&
          !client.selfieImageUrl ? (
            <p className="text-small text-muted">Sin documentos cargados.</p>
          ) : (
            <div className="flex items-center gap-4">
              <DocumentThumbnail
                label="Documento — frente"
                url={client.idDocumentFrontUrl}
                alt={`Documento de identidad (frente) de ${client.firstName} ${client.lastName}`}
                onEnlarge={setEnlargedImage}
              />
              <DocumentThumbnail
                label="Documento — reverso"
                url={client.idDocumentBackUrl}
                alt={`Documento de identidad (reverso) de ${client.firstName} ${client.lastName}`}
                onEnlarge={setEnlargedImage}
              />
              <DocumentThumbnail
                label="Selfie"
                url={client.selfieImageUrl}
                alt={`Selfie de ${client.firstName} ${client.lastName}`}
                onEnlarge={setEnlargedImage}
              />
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2.5 rounded border border-border bg-surface px-6 py-5">
          <span className="text-section-label font-medium tracking-[0.36px] text-muted">
            AUTORIZACIÓN DE TRATAMIENTO DE DATOS
          </span>
          <div className="flex items-center gap-3">
            {client.dataProcessingConsent ? (
              <span className="rounded-[3px] border border-[#22c55e] bg-[#051e0e] px-2 py-[3px] text-meta font-medium text-[#22c55e]">
                Autorización firmada
              </span>
            ) : (
              <span className="rounded-[3px] border border-[#ef4444] bg-[#240a0a] px-2 py-[3px] text-meta font-medium text-[#ef4444]">
                Sin autorización registrada
              </span>
            )}
            {client.consentGivenAt && (
              <span className="text-meta text-muted">
                {new Date(client.consentGivenAt).toLocaleDateString('es-CO')}
              </span>
            )}
          </div>
          {client.consentDocumentUrl &&
            (isPdfUrl(client.consentDocumentUrl) ? (
              <a
                href={client.consentDocumentUrl}
                target="_blank"
                rel="noreferrer"
                className="self-start text-meta text-muted hover:text-white hover:underline"
              >
                Ver evidencia de autorización (PDF)
              </a>
            ) : (
              <button
                type="button"
                onClick={() =>
                  setEnlargedImage({
                    url: client.consentDocumentUrl!,
                    alt: `Evidencia de autorización de ${client.firstName} ${client.lastName}`,
                  })
                }
                className="self-start text-meta text-muted hover:text-white hover:underline"
              >
                Ver evidencia de autorización
              </button>
            ))}
        </div>

        <MessageFrequencySection client={client} isAdmin={isAdmin} />
      </div>

      <div className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between">
          <span className="text-section-label font-medium tracking-[0.36px] text-muted">
            PRÉSTAMOS
          </span>
          {loans && loans.meta.total > displayedLoans.length && (
            // Plain link, not pre-filtered — LoansListPage's search box
            // doesn't read from the URL, so a ?search= param here would do
            // nothing. Just tells the admin there's more and where to look.
            <Link
              to="/prestamos"
              className="text-meta text-muted hover:text-white"
            >
              Ver los {loans.meta.total} en Préstamos
            </Link>
          )}
        </div>

        <div className="overflow-hidden rounded bg-surface">
          {loansLoading && (
            <p className="p-4 text-small text-muted">Cargando préstamos…</p>
          )}
          {loansError && (
            <p className="p-4 text-small text-red-400" role="alert">
              No se pudieron cargar los préstamos de este cliente.
            </p>
          )}
          {!loansLoading && !loansError && displayedLoans.length === 0 && (
            <p className="p-4 text-small text-muted">
              Este cliente todavía no tiene préstamos registrados.
            </p>
          )}
          {!loansLoading && !loansError && displayedLoans.length > 0 && (
            <table className="w-full">
              <thead className="bg-input">
                <tr>
                  <Th className="w-12">#</Th>
                  <Th>ID</Th>
                  <Th>Monto (s/inc.)</Th>
                  <Th>Saldo (c/inc.)</Th>
                  <Th>Cuotas</Th>
                  <Th>Estado</Th>
                  <Th>Días mora</Th>
                  <Th>Próxima cuota</Th>
                  <Th>Acciones</Th>
                </tr>
              </thead>
              <tbody>
                {displayedLoans.map((loan, index) => {
                  const estado = estadoBadge(loan);
                  return (
                    <tr key={loan.id} className="border-t border-border">
                      <td className="h-11 px-3.5 text-small text-muted">
                        {index + 1}
                      </td>
                      <td className="h-11 px-3.5 text-small font-medium text-white">
                        {loan.promissoryNoteNumber}
                      </td>
                      <td className="h-11 px-3.5 text-small font-medium text-white">
                        {formatCurrency(loan.principalAmount)}
                      </td>
                      <td className="h-11 px-3.5 text-small font-medium text-white">
                        {formatCurrency(loan.outstandingBalance)}
                      </td>
                      <td className="h-11 px-3.5 text-small font-medium text-white">
                        {loan.installmentsPaid}/{loan.totalInstallments}
                      </td>
                      <td className="h-11 px-3.5">
                        <span
                          className={`rounded-[3px] border px-2 py-[3px] text-meta font-medium ${estado.classes}`}
                        >
                          {estado.label}
                        </span>
                      </td>
                      <td className="h-11 px-3.5">
                        <span
                          className={`rounded-[3px] border px-2 py-[3px] text-meta font-medium ${moraBadgeClasses(loan.overdueDays)}`}
                        >
                          {loan.overdueDays} días
                        </span>
                      </td>
                      <td className="h-11 px-3.5 text-small text-muted">
                        {loan.nextInstallmentDueDate
                          ? formatDateOnly(loan.nextInstallmentDueDate)
                          : '—'}
                      </td>
                      <td className="h-11 px-3.5">
                        <Link
                          to={`/prestamos/${loan.id}`}
                          className="rounded-[3px] border border-border bg-input px-1.75 py-1 text-meta text-muted hover:text-white"
                        >
                          Ver
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="flex items-center gap-4 text-label text-muted">
          <span>Días mora:</span>
          <Legend color="#22c55e" label="0 días" />
          <Legend color="#eab308" label="1–30" />
          <Legend color="#f97316" label="31–60" />
          <Legend color="#ef4444" label="+60" />
        </div>
      </div>

      {/* Fase 5 built this scoped to the overdue reminder only; Fase 9 added
          manual triggers for the other two on-demand-capable types (Aviso
          also has a cron, but its pause/resume lives on MessageLogsPage —
          "the page about automatic sends" — not per-client). The new-loan
          message has no manual trigger by design (sent automatically at
          loan creation, see LoanDetailPage.tsx), so it never appears here
          as a button, only in the history list below like any other type. */}
      <div className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between">
          <span className="text-section-label font-medium tracking-[0.36px] text-muted">
            HISTORIAL DE MENSAJES
          </span>
          {isAdmin && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={sendReminder.isPending}
                onClick={async () => {
                  setSendError(null);
                  try {
                    await sendReminder.mutateAsync(client.id);
                  } catch (err) {
                    setSendError(
                      err instanceof ApiError
                        ? err.message
                        : 'No se pudo enviar el recordatorio.',
                    );
                  }
                }}
                className="rounded-[3px] border border-border bg-input px-2.5 py-1 text-meta text-muted hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {sendReminder.isPending
                  ? 'Enviando…'
                  : 'Enviar recordatorio de mora'}
              </button>
              <button
                type="button"
                disabled={sendUpcomingDueReminder.isPending}
                onClick={async () => {
                  setSendError(null);
                  try {
                    await sendUpcomingDueReminder.mutateAsync(client.id);
                  } catch (err) {
                    setSendError(
                      err instanceof ApiError
                        ? err.message
                        : 'No se pudo enviar el aviso.',
                    );
                  }
                }}
                className="rounded-[3px] border border-border bg-input px-2.5 py-1 text-meta text-muted hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {sendUpcomingDueReminder.isPending
                  ? 'Enviando…'
                  : 'Enviar aviso'}
              </button>
            </div>
          )}
        </div>

        {sendError && (
          <p className="text-small text-red-400" role="alert">
            {sendError}
          </p>
        )}

        <div className="overflow-hidden rounded bg-surface">
          {failedMessages && failedMessages.items.length > 0 ? (
            <table className="w-full">
              <tbody>
                {failedMessages.items.map((message) => (
                  <tr key={message.id} className="border-t border-border">
                    <td className="h-11 px-3.5 text-small text-muted">
                      {new Date(message.sentAt).toLocaleDateString('es-CO')}
                    </td>
                    <td className="h-11 px-3.5 text-small text-muted">
                      {messageTypeLabel(message.type)}
                    </td>
                    <td className="h-11 px-3.5 text-right">
                      <span
                        className={`rounded-[3px] border px-2 py-[3px] text-meta font-medium ${
                          message.status === 'sent'
                            ? 'border-[#22c55e] bg-[#051e0e] text-[#22c55e]'
                            : 'border-[#ef4444] bg-[#240a0a] text-[#ef4444]'
                        }`}
                      >
                        {message.status === 'sent' ? 'Enviado' : 'Fallido'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="border border-border p-4 text-small text-muted">
              Este cliente no tiene mensajes fallidos pendientes de revisar.
            </p>
          )}
        </div>
      </div>

      {isEditing && (
        <ClientForm
          client={client}
          onClose={() => setIsEditing(false)}
          onSubmit={(input) =>
            updateClient.mutateAsync({ id: client.id, input })
          }
        />
      )}

      {isDeactivating && (
        <DeactivateClientDialog
          clientName={`${client.firstName} ${client.lastName}`}
          onClose={() => setIsDeactivating(false)}
          onConfirm={async () => {
            await deleteClient.mutateAsync(client.id);
            navigate('/clientes', { replace: true });
          }}
        />
      )}

      {enlargedImage && (
        <ImageLightbox
          imageUrl={enlargedImage.url}
          alt={enlargedImage.alt}
          onClose={() => setEnlargedImage(null)}
        />
      )}
    </div>
  );
}

// Matches the pasted screenshot: a row of 4 KPI cards between the client
// header and the loans table. Uses the same `kpi` (24px, light) type token
// documented for KPI cards in DESIGN_TOKENS.md.
function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-border bg-surface p-5">
      <p className="text-small text-muted">{label}</p>
      <p className="mt-1 text-kpi font-light text-white">{value}</p>
    </div>
  );
}

function Th({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <th
      className={`h-[38px] px-3.5 text-left text-label font-medium tracking-[0.36px] text-muted ${className}`}
    >
      {children}
    </th>
  );
}

// Same as LoansListPage.tsx's Legend — kept as a local copy rather than a
// shared import since both are small one-off presentational helpers, same
// pattern as the Th duplication above.
function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        className="size-1.5 rounded-full"
        style={{ backgroundColor: color }}
      />
      <span style={{ color }}>{label}</span>
    </span>
  );
}

// Phase 21 — one of the sectioned profile blocks below the stats grid,
// mirroring ClientForm.tsx's FormSection titles. Always renders (no
// "empty section" collapse) so the page's shape stays predictable even
// when every field inside is blank — the individual DetailFields below
// handle the empty-value case instead.
// Phase 27 — replaces the old overdue/upcoming_due "curated audience"
// editor (Phase 18, MessageTemplatesPage.tsx), which controlled whether a
// client was reminded at all. This instead throttles HOW OFTEN an already-
// qualifying client is reminded — it never changes eligibility. Visible to
// every role (so a cobrador can see a client is on the whitelist), but
// only an admin can set/clear it, matching the backend's @Roles(Admin) on
// PUT/DELETE /clients/:id/message-frequency. See
// docs/phases/PHASE_27_MESSAGE_FREQUENCY.md.
function MessageFrequencySection({
  client,
  isAdmin,
}: {
  client: ClientDetail;
  isAdmin: boolean;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [days, setDays] = useState(
    () => client.messageFrequency?.minimumDaysBetweenMessages ?? 7,
  );
  const [error, setError] = useState<string | null>(null);
  const setFrequency = useSetClientMessageFrequency();
  const clearFrequency = useClearClientMessageFrequency();

  const handleSave = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    try {
      await setFrequency.mutateAsync({
        clientId: client.id,
        minimumDaysBetweenMessages: days,
      });
      setIsEditing(false);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'No se pudo guardar la frecuencia.',
      );
    }
  };

  const handleClear = async () => {
    setError(null);
    try {
      await clearFrequency.mutateAsync(client.id);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'No se pudo quitar la frecuencia.',
      );
    }
  };

  return (
    <div className="flex flex-col gap-2.5 rounded border border-border bg-surface px-6 py-5">
      <span className="text-section-label font-medium tracking-[0.36px] text-muted">
        FRECUENCIA DE MENSAJES
      </span>
      <p className="text-meta text-muted">
        Solo ajusta cada cuántos días como mínimo recibe recordatorios de mora o
        aviso — no afecta si los recibe o no.
      </p>

      {isEditing ? (
        <form
          onSubmit={(event) => void handleSave(event)}
          className="flex flex-wrap items-center gap-2.5"
        >
          <span className="text-small text-white">Cada</span>
          <input
            type="number"
            min={1}
            value={days}
            onChange={(event) => setDays(Number(event.target.value))}
            className="h-9 w-20 rounded border border-border bg-input px-2 text-meta text-white focus:outline-none"
          />
          <span className="text-small text-white">días como mínimo</span>
          <button
            type="submit"
            disabled={setFrequency.isPending}
            className="rounded border border-border bg-input px-3 py-1.5 text-meta text-white hover:border-subtle disabled:opacity-50"
          >
            {setFrequency.isPending ? 'Guardando…' : 'Guardar'}
          </button>
          <button
            type="button"
            onClick={() => setIsEditing(false)}
            className="text-meta text-muted hover:text-white"
          >
            Cancelar
          </button>
        </form>
      ) : client.messageFrequency ? (
        <div className="flex items-center gap-3">
          <span className="rounded-[3px] border border-border bg-input px-2 py-[3px] text-meta font-medium text-white">
            Cada {client.messageFrequency.minimumDaysBetweenMessages} días
          </span>
          {isAdmin && (
            <>
              <button
                type="button"
                onClick={() => {
                  setDays(client.messageFrequency!.minimumDaysBetweenMessages);
                  setIsEditing(true);
                }}
                className="text-meta text-muted hover:text-white"
              >
                Editar
              </button>
              <button
                type="button"
                onClick={() => void handleClear()}
                disabled={clearFrequency.isPending}
                className="text-meta text-muted hover:text-red-400 disabled:opacity-50"
              >
                {clearFrequency.isPending ? 'Quitando…' : 'Quitar'}
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <span className="text-small text-muted">
            Sin frecuencia personalizada — recibe todos los envíos que
            califiquen.
          </span>
          {isAdmin && (
            <button
              type="button"
              onClick={() => setIsEditing(true)}
              className="text-meta text-muted hover:text-white"
            >
              Ajustar
            </button>
          )}
        </div>
      )}
      {error && <p className="text-meta text-red-400">{error}</p>}
    </div>
  );
}

function DetailSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2.5 rounded border border-border bg-surface px-6 py-5">
      <span className="text-section-label font-medium tracking-[0.36px] text-muted">
        {title}
      </span>
      <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-small">
        {children}
      </div>
    </div>
  );
}

// Same pattern as LoanDetailPage.tsx's DetailField (Phase 21 codeudor
// section) — skips rendering entirely when the value is empty, so an
// optional field left blank doesn't leave a dangling "Barrio: —" line.
function DetailField({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  if (!value) {
    return null;
  }
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-meta text-muted">{label}</span>
      <span className="text-white">{value}</span>
    </div>
  );
}

// One of the three ID/selfie photo slots in the "DOCUMENTOS" section.
// Renders nothing when the client has no file in that slot (skipped
// entirely, same as DetailField) — a PDF can't render as an <img>, so it
// falls back to a filename-less "Ver" link that opens the file in a new
// tab instead of the lightbox, same branching LoanDetailPage.tsx uses for
// the co-debtor's ID document.
function DocumentThumbnail({
  label,
  url,
  alt,
  onEnlarge,
}: {
  label: string;
  url: string | null;
  alt: string;
  onEnlarge: (image: { url: string; alt: string }) => void;
}) {
  if (!url) {
    return null;
  }
  return (
    <div className="flex flex-col items-center gap-1.5">
      {isPdfUrl(url) ? (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="flex h-[52px] w-[52px] items-center justify-center rounded border border-border bg-input text-meta text-muted hover:border-subtle hover:text-white"
        >
          PDF
        </a>
      ) : (
        <button
          type="button"
          onClick={() => onEnlarge({ url, alt })}
          className="block"
        >
          <img
            src={url}
            alt={alt}
            className="h-[52px] w-[52px] rounded border border-border object-cover hover:border-subtle"
          />
        </button>
      )}
      <span className="text-meta text-muted">{label}</span>
    </div>
  );
}
