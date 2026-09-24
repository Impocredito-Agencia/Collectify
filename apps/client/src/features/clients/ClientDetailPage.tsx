import { useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';

import { ImageLightbox } from '@/components/ui/ImageLightbox';
import { Legend } from '@/components/ui/Legend';
import { Button } from '@/components/ui/Button';
import { StatCard } from '@/components/ui/StatCard';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { RowActionButton } from '@/components/ui/RowActionButton';
import { Td, Th } from '@/components/ui/Table';
import { useAuth } from '@/features/auth/useAuth';
import { ClientAccountStatusPanel } from '@/features/clients/ClientAccountStatusPanel';
import { ClientCreditBanner } from '@/features/clients/ClientCreditBanner';
import { ClientForm } from '@/features/clients/ClientForm';
import {
  CLIENT_REFERENCE_TYPE_LABELS,
  DOCUMENT_TYPE_LABELS,
  GENDER_LABELS,
} from '@/features/clients/clientsApi';
import { DeactivateClientDialog } from '@/features/clients/DeactivateClientDialog';
import {
  useClearClientMessageFrequency,
  useClient,
  useDeleteClient,
  useSetClientMessageFrequency,
  useSetClientMutedPhoneNumbers,
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
import { useDeliveryHealth } from '@/features/whatsappInboundMessages/useWhatsappInboundMessages';
import { ApiError } from '@/lib/apiClient';
import {
  calculateAge,
  formatCurrency,
  formatDateOnly,
  formatPhoneNumber,
  isPdfUrl,
} from '@/lib/format';

import type { ReactNode } from 'react';
import type {
  ClientDetail,
  ClientMessageRecipient,
} from '@/features/clients/clientsApi';

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
  // Phase 20 — was a single isAdmin, split in two since Editar/Desactivar/
  // frecuencia-de-mensajes (ClientsController) and Enviar recordatorio/aviso
  // (WhatsappController) migrated to two different modules — see
  // docs/phases/PHASE_20_MODULE_PERMISSIONS.md.
  const canManageClient = Boolean(
    user && (user.role === 'admin' || user.modules.includes('clients')),
  );
  const canSendMessage = Boolean(
    user && (user.role === 'admin' || user.modules.includes('messages')),
  );

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
  // Human report, 2026-09-16 — "¿cómo sabemos si un cliente nos bloqueó?".
  // enabled: false via useDeliveryHealth(null) until `id` resolves (this
  // hook runs before the `!id` redirect below, same as every other query
  // on this page).
  const { data: deliveryHealth } = useDeliveryHealth(id ?? null);
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
        <p className="text-small text-danger">
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

      <div className="flex items-center justify-between rounded-lg border border-border bg-surface px-6 py-5">
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
                // Human decision, 2026-09-09 — mora no longer blocks new
                // loans (see LoansService.assertClientCanTakeNewLoan),
                // just warns; isMoraBlocked itself is unchanged (still
                // "has a cuota over 30 days overdue"), only what it does
                // about it changed. Wording matches LoanForm.tsx's own
                // ClientCapacityNotice, the other place this same flag
                // surfaces.
                <StatusBadge
                  tone="danger"
                  title="Este cliente tiene una cuota con más de 30 días de mora — ya no bloquea préstamos nuevos, solo es una alerta."
                >
                  Mora superior a 30 días
                </StatusBadge>
              )}
              {deliveryHealth?.possiblyBlocked && (
                <StatusBadge
                  tone="danger"
                  title={
                    deliveryHealth.lastErrorTitle
                      ? `${deliveryHealth.lastErrorTitle}${
                          deliveryHealth.lastErrorCode
                            ? ` (${deliveryHealth.lastErrorCode})`
                            : ''
                        }`
                      : 'Varios envíos recientes de WhatsApp no se entregaron.'
                  }
                >
                  Posible bloqueo en WhatsApp
                </StatusBadge>
              )}
            </div>
          </div>
        </div>

        {canManageClient && (
          <div className="flex items-center gap-2.5">
            <Button variant="secondary" onClick={() => setIsEditing(true)}>
              Editar
            </Button>
            <Button variant="secondary" onClick={() => setIsDeactivating(true)}>
              Desactivar
            </Button>
          </div>
        )}
      </div>

      <ClientAccountStatusPanel clientId={client.id} />

      <ClientCreditBanner clientId={client.id} />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard label="Préstamos totales" value={String(totalLoans)} />
        <StatCard
          label="Capital prestado"
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

      {/* Program-first ordering (client request, 2026-09-04): the loans
          table, message history, and messaging config are what an
          admin/cobrador actually opens this page to check day-to-day —
          they now come before the KYC/personal-info block instead of
          after it, which used to bury them below a screen and a half of
          rarely-changing profile data. */}
      <div className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between">
          <span className="text-section-label font-normal tracking-normal text-subtle">
            Préstamos
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

        <div className="overflow-x-auto rounded-lg bg-surface">
          {loansLoading && (
            <p className="p-4 text-small text-muted">Cargando préstamos…</p>
          )}
          {loansError && (
            <p className="p-4 text-small text-danger" role="alert">
              No se pudieron cargar los préstamos de este cliente.
            </p>
          )}
          {!loansLoading && !loansError && displayedLoans.length === 0 && (
            <p className="p-4 text-small text-muted">
              Este cliente todavía no tiene préstamos registrados.
            </p>
          )}
          {!loansLoading && !loansError && displayedLoans.length > 0 && (
            <table className="w-full min-w-[880px]">
              <thead className="bg-input">
                <tr>
                  <Th className="w-12">#</Th>
                  <Th>ID</Th>
                  <Th>Capital inicial</Th>
                  <Th className="whitespace-nowrap">
                    Saldo total (capital + incremento)
                  </Th>
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
                      <Td muted>{index + 1}</Td>
                      <Td>{loan.promissoryNoteNumber}</Td>
                      <Td>{formatCurrency(loan.principalAmount)}</Td>
                      <Td>{formatCurrency(loan.outstandingBalance)}</Td>
                      <Td>
                        {loan.installmentsPaid}/{loan.totalInstallments}
                      </Td>
                      <Td>
                        <span
                          className={`rounded-[3px] border px-2 py-[3px] text-meta font-medium ${estado.classes}`}
                        >
                          {estado.label}
                        </span>
                      </Td>
                      <Td>
                        <span
                          className={`rounded-[3px] border px-2 py-[3px] text-meta font-medium ${moraBadgeClasses(loan.overdueDays)}`}
                        >
                          {loan.overdueDays} días
                        </span>
                      </Td>
                      <Td muted>
                        {loan.nextInstallmentDueDate
                          ? formatDateOnly(loan.nextInstallmentDueDate)
                          : '—'}
                      </Td>
                      <Td>
                        <RowActionButton to={`/prestamos/${loan.id}`}>
                          Ver
                        </RowActionButton>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="flex items-center gap-4 text-label text-muted">
          <span>Días mora:</span>
          <Legend tone="success" label="0 días" />
          <Legend tone="warning" label="1–30" />
          <Legend tone="mora-mid" label="31–60" />
          <Legend tone="danger" label="+60" />
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
          <span className="text-section-label font-normal tracking-normal text-subtle">
            Historial de mensajes
          </span>
          {canSendMessage && (
            <div className="flex items-center gap-2">
              <RowActionButton
                disabled={sendReminder.isPending}
                onClick={async () => {
                  setSendError(null);
                  try {
                    const logs = await sendReminder.mutateAsync(client.id);
                    if (logs.length === 0) {
                      setSendError(ALL_RECIPIENTS_MUTED_MESSAGE);
                    }
                  } catch (err) {
                    setSendError(
                      err instanceof ApiError
                        ? err.message
                        : 'No se pudo enviar el recordatorio.',
                    );
                  }
                }}
              >
                {sendReminder.isPending
                  ? 'Enviando…'
                  : 'Enviar recordatorio de mora'}
              </RowActionButton>
              <RowActionButton
                disabled={sendUpcomingDueReminder.isPending}
                onClick={async () => {
                  setSendError(null);
                  try {
                    const logs = await sendUpcomingDueReminder.mutateAsync(
                      client.id,
                    );
                    if (logs.length === 0) {
                      setSendError(ALL_RECIPIENTS_MUTED_MESSAGE);
                    }
                  } catch (err) {
                    setSendError(
                      err instanceof ApiError
                        ? err.message
                        : 'No se pudo enviar el aviso.',
                    );
                  }
                }}
              >
                {sendUpcomingDueReminder.isPending
                  ? 'Enviando…'
                  : 'Enviar aviso'}
              </RowActionButton>
            </div>
          )}
        </div>

        {sendError && (
          <p className="text-small text-danger" role="alert">
            {sendError}
          </p>
        )}

        <div className="overflow-hidden rounded-lg bg-surface">
          {failedMessages && failedMessages.items.length > 0 ? (
            <table className="w-full">
              <tbody>
                {failedMessages.items.map((message) => (
                  <tr key={message.id} className="border-t border-border">
                    <Td muted>{messageTypeLabel(message.type)}</Td>
                    <Td className="text-right">
                      <StatusBadge
                        tone={message.status === 'sent' ? 'success' : 'danger'}
                      >
                        {message.status === 'sent' ? 'Enviado' : 'Fallido'}
                      </StatusBadge>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="p-4 text-small text-muted">
              Este cliente no tiene mensajes fallidos pendientes de revisar.
            </p>
          )}
        </div>
      </div>

      <MessageFrequencySection client={client} canManage={canManageClient} />

      {/* Phase 21 — extended profile (KYC), sectioned the same way as
          ClientForm.tsx. Each DetailField skips rendering when its value
          is empty, so a client with a mostly-blank profile (e.g. one
          created before this phase) doesn't show a wall of "—" lines. See
          docs/phasesClient/PHASE_21_CLIENT_PROFILE.md.
          Moved below Préstamos/Historial (client request, 2026-09-04) —
          this is reference info an admin checks occasionally, not the
          day-to-day view. Also switched from one full-width section per
          block to denser card grids: a 2-column field grid stretched
          across the whole page width left large horizontal gaps for
          short values ("se pierde mucho espacio"). */}
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <DetailSection title="Contacto">
            {/* Repeats the celular already shown in the header above —
                same reasoning as the Cédula repeat in DATOS PERSONALES:
                right next to "Celular alterno" is more useful than the
                header. */}
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

          <DetailSection title="Direcciones">
            <DetailField
              label="Dirección de residencia"
              value={client.homeAddress}
            />
            <DetailField
              label="Dirección de trabajo"
              value={client.workAddress}
            />
            <DetailField label="Ciudad" value={client.city} />
          </DetailSection>
        </div>

        <DetailSection title="Datos personales" columns={4}>
          {/* Repeats the cédula already shown in the header above — per
              client feedback, seeing it again here next to the rest of
              the identification fields (tipo, fechas, lugar) is more
              useful than making them scroll up to cross-reference it. */}
          <DetailField label="Cédula" value={client.documentNumber} />
          <DetailField
            label="Fecha de nacimiento"
            value={
              client.dateOfBirth
                ? `${formatDateOnly(client.dateOfBirth)} (${calculateAge(client.dateOfBirth)} años)`
                : null
            }
          />
          <DetailField
            label="Tipo de documento"
            value={
              client.documentType
                ? DOCUMENT_TYPE_LABELS[client.documentType]
                : null
            }
          />
          <DetailField
            label="Sexo / Género"
            value={client.gender ? GENDER_LABELS[client.gender] : null}
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

        <div className="flex flex-col gap-2.5 rounded-lg border border-border bg-surface px-6 py-5">
          <span className="text-section-label font-normal tracking-normal text-subtle">
            Referencias
          </span>
          {client.references.length === 0 ? (
            <p className="text-small text-muted">
              Sin referencias registradas.
            </p>
          ) : (
            // grid, not a single flex column: each reference card is short
            // (name + one phone + a badge), so one per row at full page
            // width left the same kind of wasted horizontal space as the
            // old Datos personales layout — 2 per row uses it better.
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
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

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2.5 rounded-lg border border-border bg-surface px-6 py-5">
            <span className="text-section-label font-normal tracking-normal text-subtle">
              Documentos
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

          <div className="flex flex-col gap-2.5 rounded-lg border border-border bg-surface px-6 py-5">
            <span className="text-section-label font-normal tracking-normal text-subtle">
              Autorización de tratamiento de datos
            </span>
            <div className="flex items-center gap-3">
              {client.dataProcessingConsent ? (
                <StatusBadge tone="success">Autorización firmada</StatusBadge>
              ) : (
                <StatusBadge tone="danger">
                  Sin autorización registrada
                </StatusBadge>
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

// Phase 21 — one of the sectioned profile blocks below the stats grid,
// mirroring ClientForm.tsx's FormSection titles. Always renders (no
// "empty section" collapse) so the page's shape stays predictable even
// when every field inside is blank — the individual DetailFields below
// handle the empty-value case instead.
// Phase 27 — replaces the old overdue/upcoming_due "curated audience"
// editor (Phase 18, MessageTemplatesPage.tsx), which controlled whether a
// client was reminded at all. This instead throttles HOW OFTEN an already-
// qualifying client is reminded — it never changes eligibility. Visible to
// every role (so a cobrador can see a client is on the whitelist), but only
// an admin or someone granted the clients module can set/clear it — Phase
// 20 migrated PUT/DELETE /clients/:id/message-frequency to
// @RequireModule(AppModule.Clients) (was @Roles(Admin)). See
// docs/phases/PHASE_27_MESSAGE_FREQUENCY.md and
// docs/phases/PHASE_20_MODULE_PERMISSIONS.md.
function MessageFrequencySection({
  client,
  canManage,
}: {
  client: ClientDetail;
  canManage: boolean;
}) {
  const [isEditing, setIsEditing] = useState(false);
  // '' (no default, no placeholder either) when there's no frequency set
  // yet — human report, 2026-09-17: pre-filling a real-looking number
  // here read as "this is what's currently happening" rather than "type
  // a number", even though it was just an arbitrary suggestion nobody
  // had confirmed. Genuinely empty until the admin types something — see
  // handleSave's own guard below. Editing an EXISTING frequency still
  // pre-fills the real number, set explicitly by the "Editar" button's
  // own onClick — that one really is the current value, not a
  // suggestion.
  const [days, setDays] = useState<number | ''>(
    () => client.messageFrequency?.minimumDaysBetweenMessages ?? '',
  );
  const [error, setError] = useState<string | null>(null);
  const setFrequency = useSetClientMessageFrequency();
  const clearFrequency = useClearClientMessageFrequency();

  const handleSave = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (days === '') {
      setError('Escribe cada cuántos días como mínimo.');
      return;
    }
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
    <div className="flex flex-col gap-2.5">
      <span className="text-section-label font-normal tracking-normal text-subtle">
        Frecuencia de mensajes
      </span>

      <div className="flex flex-col gap-2.5 rounded-lg border border-border bg-surface px-6 py-5">
        <p className="text-meta text-muted">
          Solo ajusta cada cuántos días como mínimo recibe recordatorios de mora
          o aviso — no afecta si los recibe o no.
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
              onChange={(event) => {
                const raw = event.target.value;
                setDays(raw === '' ? '' : Number(raw));
              }}
              className="h-9 w-20 rounded border border-border bg-input px-2 text-meta text-white focus:outline-none"
            />
            <span className="text-small text-white">días como mínimo</span>
            <Button
              type="submit"
              disabled={setFrequency.isPending || days === ''}
            >
              {setFrequency.isPending ? 'Guardando…' : 'Guardar'}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setIsEditing(false)}
            >
              Cancelar
            </Button>
          </form>
        ) : client.messageFrequency ? (
          <div className="flex items-center gap-3">
            <span className="rounded-[3px] border border-border bg-input px-2 py-[3px] text-meta font-medium text-white">
              Cada {client.messageFrequency.minimumDaysBetweenMessages} días
            </span>
            {canManage && (
              <>
                <RowActionButton
                  onClick={() => {
                    setDays(
                      client.messageFrequency!.minimumDaysBetweenMessages,
                    );
                    setIsEditing(true);
                  }}
                >
                  Editar
                </RowActionButton>
                <RowActionButton
                  onClick={() => void handleClear()}
                  disabled={clearFrequency.isPending}
                  tone="subtle"
                >
                  {clearFrequency.isPending ? 'Quitando…' : 'Quitar'}
                </RowActionButton>
              </>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <span className="text-small text-white">
              Sin frecuencia personalizada — recibe todos los envíos que
              califiquen.
            </span>
            {canManage && (
              <RowActionButton
                onClick={() => {
                  setDays('');
                  setIsEditing(true);
                }}
              >
                Ajustar
              </RowActionButton>
            )}
          </div>
        )}
        {error && <p className="text-meta text-danger">{error}</p>}

        <div className="border-t border-border" />
        <MessageRecipientsList client={client} canManage={canManage} />
      </div>
    </div>
  );
}

// Human report, 2026-09-23 — a manual send comes back empty only when every
// number that would have received it has messages turned off (see
// MessageRecipientsList) — otherwise the API sends or errors.
const ALL_RECIPIENTS_MUTED_MESSAGE =
  'No se envió nada: los mensajes están desactivados para todos los números de este cliente.';

const RECIPIENT_KIND_LABELS: Record<ClientMessageRecipient['kind'], string> = {
  primary: 'Número principal',
  alternate: 'Número secundario',
  alternate_contact: 'Tercero',
};

function recipientLabel(recipient: ClientMessageRecipient): string {
  if (recipient.kind !== 'alternate_contact') {
    return RECIPIENT_KIND_LABELS[recipient.kind];
  }
  const notes = recipient.promissoryNoteNumbers.join(', ');
  return `${RECIPIENT_KIND_LABELS.alternate_contact}${
    recipient.contactName ? ` · ${recipient.contactName}` : ''
  } (pagaré ${notes})`;
}

// Human report, 2026-09-23 — "desactivar envío de mensajes a ciertas
// personas... número principal, número secundario, y el número de la
// tercera persona... desactivar uno, dos o todos". One row per number
// that can receive an automated message (see ClientMessageRecipient),
// each switched on/off individually, plus a shortcut for all of them.
// Saves the whole muted set on every click (PUT replaces it), so each
// click is one self-contained change. Read-only without canManage, same
// as the frequency controls above.
function MessageRecipientsList({
  client,
  canManage,
}: {
  client: ClientDetail;
  canManage: boolean;
}) {
  const setMuted = useSetClientMutedPhoneNumbers();
  const [error, setError] = useState<string | null>(null);
  const recipients = client.messageRecipients;
  const mutedPhoneNumbers = recipients
    .filter((recipient) => recipient.muted)
    .map((recipient) => recipient.phoneNumber);
  const allMuted = mutedPhoneNumbers.length === recipients.length;

  const save = async (phoneNumbers: string[]) => {
    setError(null);
    try {
      await setMuted.mutateAsync({ clientId: client.id, phoneNumbers });
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'No se pudo actualizar el envío de mensajes.',
      );
    }
  };

  const toggle = (recipient: ClientMessageRecipient) =>
    void save(
      recipient.muted
        ? mutedPhoneNumbers.filter((n) => n !== recipient.phoneNumber)
        : [...mutedPhoneNumbers, recipient.phoneNumber],
    );

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-meta text-muted">
          Números que reciben mensajes automáticos (recordatorios,
          confirmaciones de pago, aviso de nuevo pagaré). Un número desactivado
          no recibe ninguno; las respuestas manuales desde la bandeja no se ven
          afectadas.
        </p>
        {canManage && recipients.length > 1 && (
          <RowActionButton
            onClick={() =>
              void save(
                allMuted
                  ? []
                  : recipients.map((recipient) => recipient.phoneNumber),
              )
            }
            disabled={setMuted.isPending}
            tone={allMuted ? undefined : 'subtle'}
          >
            {allMuted ? 'Activar todos' : 'Desactivar todos'}
          </RowActionButton>
        )}
      </div>

      <ul className="flex flex-col divide-y divide-border rounded border border-border">
        {recipients.map((recipient) => (
          <li
            key={recipient.phoneNumber}
            className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5"
          >
            <div className="flex min-w-0 flex-col">
              <span className="text-meta text-subtle">
                {recipientLabel(recipient)}
              </span>
              <span
                className={`text-small ${
                  recipient.muted ? 'text-muted line-through' : 'text-white'
                }`}
              >
                {formatPhoneNumber(recipient.phoneNumber)}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span
                className={`rounded-[3px] border px-2 py-[3px] text-meta font-medium ${
                  recipient.muted
                    ? 'border-danger/40 text-danger'
                    : 'border-success/40 text-success'
                }`}
              >
                {recipient.muted ? 'Desactivado' : 'Activo'}
              </span>
              {canManage && (
                <RowActionButton
                  onClick={() => toggle(recipient)}
                  disabled={setMuted.isPending}
                  tone={recipient.muted ? undefined : 'subtle'}
                >
                  {recipient.muted ? 'Activar' : 'Desactivar'}
                </RowActionButton>
              )}
            </div>
          </li>
        ))}
      </ul>
      {error && <p className="text-meta text-danger">{error}</p>}
    </div>
  );
}

// columns defaults to 2 (Contacto/Direcciones, each with few enough
// fields that 2 columns already reads tight); Datos personales passes 4
// since it has 8 fields and otherwise reads as a tall, sparse column at
// full page width. Hardcoded to explicit classnames (not a template
// string) since Tailwind's build only picks up literal class names.
function DetailSection({
  title,
  children,
  columns = 2,
}: {
  title: string;
  children: ReactNode;
  columns?: 2 | 3 | 4;
}) {
  // Human report, 2026-09-22 — collapses to 1 column below sm (640px),
  // reaching the configured column count at sm and up, same pattern as
  // every other page-level grid in the app (see index.css's font-size
  // bump commit for the sibling "responsive" report this came with).
  const gridColsClassName =
    columns === 4
      ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4'
      : columns === 3
        ? 'grid-cols-1 sm:grid-cols-3'
        : 'grid-cols-1 sm:grid-cols-2';
  return (
    <div className="flex flex-col gap-2.5 rounded-lg border border-border bg-surface px-6 py-5">
      <span className="text-section-label font-normal tracking-normal text-subtle">
        {title}
      </span>
      <div className={`grid ${gridColsClassName} gap-x-6 gap-y-2 text-small`}>
        {children}
      </div>
    </div>
  );
}

// Same pattern as LoanDetailPage.tsx's DetailField (Phase 21 codeudor
// section) — skips rendering entirely when the value is empty, so an
// optional field left blank doesn't leave a dangling "Ciudad: —" line.
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
          className="flex h-[52px] w-[52px] items-center justify-center rounded border border-border bg-input text-meta text-muted hover:border-subtle hover:bg-border hover:text-white"
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
