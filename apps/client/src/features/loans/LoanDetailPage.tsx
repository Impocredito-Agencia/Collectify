import { useEffect, useState } from 'react';
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { ImageLightbox } from '@/components/ui/ImageLightbox';
import { StatCard } from '@/components/ui/StatCard';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { RowActionButton } from '@/components/ui/RowActionButton';
import { Td, Th } from '@/components/ui/Table';
import { useAuth } from '@/features/auth/useAuth';
import { DOCUMENT_TYPE_LABELS } from '@/features/clients/clientsApi';
import { useClient } from '@/features/clients/useClients';
import { BulkRegisterPaymentDialog } from '@/features/installments/BulkRegisterPaymentDialog';
import { InstallmentStatus } from '@/features/installments/installmentsApi';
import { RegisterPaymentDialog } from '@/features/installments/RegisterPaymentDialog';
import {
  useRegisterBulkPayments,
  useRegisterPayment,
} from '@/features/installments/useInstallments';
import {
  ConceptCalculationType,
  ConceptCategory,
} from '@/features/interestConceptTypes/interestConceptTypesApi';
import { DeleteLoanDialog } from '@/features/loans/DeleteLoanDialog';
import { EditLoanDialog } from '@/features/loans/EditLoanDialog';
import {
  estadoBadge,
  moraBadgeClasses,
} from '@/features/loans/loanStatusDisplay';
import { LoanStatus } from '@/features/loans/loansApi';
import { PayoffDialog } from '@/features/loans/PayoffDialog';
import { RefinanceLoanForm } from '@/features/loans/RefinanceLoanForm';
import {
  useLoan,
  useLoanPayments,
  usePayoffLoan,
  useRefinanceLoan,
  useRemoveLoan,
  useUpdateLoan,
} from '@/features/loans/useLoans';
import { MessageLogStatus } from '@/features/messageLogs/messageLogsApi';
import { useMessageLogs } from '@/features/messageLogs/useMessageLogs';
import { NEW_LOAN_FAMILY_TYPES } from '@/features/messageTemplates/messageTemplatesApi';
import { formatCurrency, formatDateOnly } from '@/lib/format';

import type { Installment } from '@/features/installments/installmentsApi';
import type { LoanDetail } from '@/features/loans/loansApi';

// Matches Figma frame 52:537 ("F-19 / Detalle préstamo — Desktop 1440"),
// with one addition and one removal — see
// apps/client/docs/DESIGN_TOKENS.md "Known design/backend gaps":
//   - Added a "Cuotas" table: Figma only shows payment history, but Phase
//     4's own scope requires showing each installment's overdueDays/
//     interest/totalDue "exactly as returned by GET /loans/:id" — there's
//     no other place in this design for that.
//   - "LOG DE MENSAJES WHATSAPP" and "Enviar mensaje" dropped: the
//     new-loan message has no manual trigger by design (sent
//     automatically at creation), so there's nothing to log/send here —
//     Fase 9 added only the "Mensaje de confirmación" status badge above
//     instead, next to the other status badges.
export function LoanDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  // Phase 20 — was isAdmin. Gates Editar/Liquidar/Refinanciar/Eliminar,
  // the 4 LoansController endpoints migrated to
  // @RequireModule(AppModule.Loans) (update/payoff/refinance/remove) — see
  // docs/phases/PHASE_20_MODULE_PERMISSIONS.md. Mirrors
  // RequirePermission.tsx's check.
  const canManageLoan = Boolean(
    user && (user.role === 'admin' || user.modules.includes('loans')),
  );

  const { data: loan, isLoading, isError } = useLoan(id ?? '');
  const { data: client } = useClient(loan?.clientId ?? '');
  const { data: payments } = useLoanPayments(id ?? '');
  const registerPayment = useRegisterPayment(id ?? '');
  const registerBulkPayments = useRegisterBulkPayments(id ?? '');
  const payoffLoan = usePayoffLoan();
  const updateLoan = useUpdateLoan();
  const refinanceLoan = useRefinanceLoan();
  const removeLoan = useRemoveLoan();

  // Phase 6: fetch whichever side of the refinance chain applies, purely
  // to show a nicer label (promissoryNoteNumber) than a bare link — both
  // are no-ops (`enabled: false`) when there's nothing to link to.
  const { data: refinancedToLoan } = useLoan(loan?.refinancedToLoanId ?? '');
  const { data: refinancedFromLoan } = useLoan(
    loan?.refinancedFromLoanId ?? '',
  );

  // Fase 9, updated Phase 33: the new-loan/refinance message is sent
  // automatically at loan creation or refinance (see NewLoanReminderService
  // in the api), with no manual trigger — this only surfaces whether it
  // actually went through, so a failed/skipped send is visible instead of
  // silent (per docs/phasesClient/PHASE_9_MESSAGE_TYPES.md). There's no
  // loanId on MessageLog (it's per-client, see docs/DATABASE.md), so the
  // matching log is found among the client's messages by type membership
  // (NEW_LOAN_FAMILY_TYPES — Phase 33 split the old single `new_loan` type
  // into 5, and GET /message-logs only accepts one `type` filter at a
  // time, so this filters client-side instead) AND by checking which one
  // mentions this loan's promissoryNoteNumber — every template in that
  // family renders it ("...pagaré *{{2}}*...", see the seeded template
  // content), so the combination is reliable without an extra per-log
  // items request.
  const { data: newLoanMessages } = useMessageLogs({
    clientId: loan?.clientId,
    limit: 50,
  });
  const newLoanMessage = loan
    ? newLoanMessages?.items.find(
        (message) =>
          NEW_LOAN_FAMILY_TYPES.includes(message.type) &&
          message.messageContent.includes(loan.promissoryNoteNumber),
      )
    : undefined;

  const [payingInstallment, setPayingInstallment] =
    useState<Installment | null>(null);
  // Phase 28 — checkbox selection for the bulk "pagar seleccionadas"
  // action below, keyed by installment id so it survives re-renders of
  // InstallmentsTable's own installment objects.
  const [selectedInstallmentIds, setSelectedInstallmentIds] = useState<
    Set<string>
  >(new Set());
  const [isBulkPaying, setIsBulkPaying] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isRefinancing, setIsRefinancing] = useState(false);
  const [isPayingOff, setIsPayingOff] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  // Phase 12 — click-to-enlarge for a payment's receipt photo. No Figma
  // frame exists for this (see DESIGN_TOKENS.md); just the payment's own
  // imageUrl, no extra fetch needed. Phase 21 reuses this same state for
  // the co-debtor's ID document photo below — `alt` travels with the url
  // since the two sources need different alt text.
  const [enlargedImage, setEnlargedImage] = useState<{
    url: string;
    alt: string;
  } | null>(null);

  const pendingInstallments =
    loan?.installments.filter(
      (installment) => installment.status === InstallmentStatus.Pending,
    ) ?? [];
  // Installments come back sorted by installmentNumber ASC (LoansService)
  // and due dates only increase with installment number, so the first
  // pending one is always the next due — no separate sort needed.
  const oldestPending = pendingInstallments[0] ?? null;

  // The list page's quick "Pago" action (?pago=1) lands here and opens the
  // same dialog the top "Registrar pago" button does — see
  // RegisterPaymentDialog's note on why there's no installment picker.
  useEffect(() => {
    if (searchParams.get('pago') === '1' && oldestPending) {
      setPayingInstallment(oldestPending);
      const next = new URLSearchParams(searchParams);
      next.delete('pago');
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, oldestPending?.id]);

  if (!id) {
    return <p className="text-small text-muted">Préstamo no encontrado.</p>;
  }

  if (isLoading) {
    return <p className="text-small text-muted">Cargando…</p>;
  }

  if (isError || !loan) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-small text-danger" role="alert">
          No se pudo cargar este préstamo.
        </p>
        <Link
          to="/prestamos"
          className="text-small text-muted hover:text-white"
        >
          ← Volver a Préstamos
        </Link>
      </div>
    );
  }

  const selectedInstallments = pendingInstallments.filter((installment) =>
    selectedInstallmentIds.has(installment.id),
  );

  const clientFullName = client
    ? `${client.firstName} ${client.lastName}`
    : '…';
  // Phase 30 — mirrors the backend's own delete precondition (any
  // registered Payment row on any installment) rather than re-deriving it
  // from installment status. `payments` is already fetched above for the
  // payment-history table.
  const hasPayments = (payments ?? []).length > 0;
  const outstandingBalance = pendingInstallments.reduce(
    (sum, installment) => sum + installment.totalDue,
    0,
  );
  const installmentsPaid = loan.installments.filter(
    (installment) => installment.status === InstallmentStatus.Paid,
  ).length;
  const overdueDays = pendingInstallments.reduce(
    (max, installment) => Math.max(max, installment.overdueDays),
    0,
  );
  const estado = estadoBadge({ status: loan.status, overdueDays });

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-1.5 text-label">
        <Link to="/prestamos" className="text-muted hover:text-white">
          Préstamos
        </Link>
        <span className="text-mid">/</span>
        <span className="font-medium text-white">
          {loan.promissoryNoteNumber} — {clientFullName}
        </span>
      </div>

      {/* Phase 32 — flex-wrap on this row (and on the button group below)
          instead of a single non-wrapping flex row: with a realistic
          number of action buttons (up to 5: Registrar pago, Pagar
          seleccionadas, Liquidar, Refinanciar, Eliminar — Editar
          descripción lives separately, right next to Descripción below,
          see that section's own comment), a non-wrapping row either
          overflowed or squeezed each button down below its label's width.
          Wrapping to a second line keeps every button at its natural size
          instead. */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded border border-border bg-surface px-6 py-5">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-page-title font-semibold text-white">
            Préstamo {loan.promissoryNoteNumber}
          </h1>
          <div className="flex items-center gap-2.5 text-small text-muted">
            <span>
              {clientFullName} · Creado{' '}
              {new Date(loan.createdAt).toLocaleDateString('es-CO')}
            </span>
            <span
              className={`rounded-[3px] border px-2 py-[3px] text-meta font-medium ${estado.classes}`}
            >
              {estado.label}
            </span>
            {overdueDays > 0 && (
              <span
                className={`rounded-[3px] border px-2 py-[3px] text-meta font-medium ${moraBadgeClasses(overdueDays)}`}
              >
                {overdueDays} días
              </span>
            )}
            <StatusBadge
              tone={
                newLoanMessage?.status === MessageLogStatus.Sent
                  ? 'success'
                  : newLoanMessage?.status === MessageLogStatus.Failed
                    ? 'danger'
                    : 'neutral'
              }
            >
              Mensaje de confirmación:{' '}
              {newLoanMessage?.status === MessageLogStatus.Sent
                ? 'Enviado'
                : newLoanMessage?.status === MessageLogStatus.Failed
                  ? 'Fallido'
                  : 'No enviado'}
            </StatusBadge>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <Button
            disabled={!oldestPending}
            onClick={() => oldestPending && setPayingInstallment(oldestPending)}
            className="shrink-0 whitespace-nowrap"
          >
            Registrar pago
          </Button>
          {selectedInstallments.length >= 2 && (
            <Button
              variant="secondary"
              onClick={() => setIsBulkPaying(true)}
              className="shrink-0 whitespace-nowrap"
            >
              Pagar seleccionadas ({selectedInstallments.length})
            </Button>
          )}
          {canManageLoan && (
            <Button
              variant="secondary"
              disabled={loan.status !== LoanStatus.Active}
              onClick={() => setIsPayingOff(true)}
              className="shrink-0 whitespace-nowrap"
            >
              Liquidar anticipadamente
            </Button>
          )}
          {canManageLoan && (
            <Button
              variant="secondary"
              disabled={loan.status !== LoanStatus.Active}
              onClick={() => setIsRefinancing(true)}
              className="shrink-0 whitespace-nowrap"
            >
              Refinanciar
            </Button>
          )}
          {canManageLoan && (
            <Button
              variant="danger"
              disabled={hasPayments}
              title={
                hasPayments
                  ? 'No se puede eliminar: este préstamo ya tiene pagos registrados.'
                  : undefined
              }
              onClick={() => setIsDeleting(true)}
              className="shrink-0 whitespace-nowrap"
            >
              Eliminar préstamo
            </Button>
          )}
        </div>
      </div>

      {/* Phase 6: either side of the refinance chain, whichever applies.
          A loan is never both at once (refinanced loans are closed out,
          not further refinanced), so these are mutually exclusive in
          practice, but not enforced as an if/else here since both checks
          are independently cheap and harmless. */}
      {loan.status === LoanStatus.Refinanced && loan.refinancedToLoanId && (
        <div className="rounded border border-border bg-surface px-4 py-3 text-small text-muted">
          Este préstamo fue refinanciado. Ver el préstamo nuevo:{' '}
          <Link
            to={`/prestamos/${loan.refinancedToLoanId}`}
            className="text-white hover:underline"
          >
            {refinancedToLoan?.promissoryNoteNumber ?? '…'}
          </Link>
        </div>
      )}
      {loan.refinancedFromLoanId && (
        <div className="rounded border border-border bg-surface px-4 py-3 text-small text-muted">
          Este préstamo nació de una refinanciación. Ver el préstamo original:{' '}
          <Link
            to={`/prestamos/${loan.refinancedFromLoanId}`}
            className="text-white hover:underline"
          >
            {refinancedFromLoan?.promissoryNoteNumber ?? '…'}
          </Link>
        </div>
      )}

      <div className="grid grid-cols-6 gap-4">
        <StatCard
          label="Capital original sin incremento"
          value={formatCurrency(loan.principalAmount)}
        />
        <StatCard
          label="Saldo total (capital + incremento)"
          value={formatCurrency(outstandingBalance)}
        />
        {/* Phase 31 — pure remaining principal, no interest folded in;
            deliberately a separate card from "Saldo total (capital +
            incremento)" above, which does include accrued interest. */}
        <StatCard
          label="Saldo capital a la fecha"
          value={formatCurrency(loan.currentPrincipalBalance)}
        />
        <StatCard
          label="Cuotas pagadas"
          value={`${installmentsPaid} de ${loan.totalInstallments}`}
        />
        <StatCard
          label="Próx. pago"
          value={oldestPending ? formatDateOnly(oldestPending.dueDate) : '—'}
        />
        <StatCard label="Incremento en mora" value={`${loan.interestRate}%`} />
      </div>

      {/* Redesign, 2026-09-06 (client feedback) — moved here, right after
          the loan's core stat cards, from all the way below Historial de
          pagos (see git history for that layout) — the client couldn't
          find it there, especially on a refinanced loan with a long
          installment/payment history to scroll past first. This is the
          same "core facts of the loan" area a brand-new loan's own
          Descripción would sit in, so a refinance's description (e.g.
          noting which old pagarés it merged, per the manual multi-loan-
          refinance workaround) is just as visible as everything else here.
          items-center (not items-start) so the description text is
          vertically centered against the button's own height (the button
          is taller than a bare text line, thanks to its py-2.5 padding). */}
      <div className="flex items-center justify-between gap-4 text-small">
        <p>
          <span className="text-muted">Descripción: </span>
          <span className={loan.description ? 'text-white' : 'text-mid'}>
            {loan.description ?? 'Sin descripción'}
          </span>
        </p>
        {canManageLoan && (
          <Button
            variant="secondary"
            onClick={() => setIsEditing(true)}
            className="shrink-0 whitespace-nowrap"
          >
            Editar descripción
          </Button>
        )}
      </div>

      {/* Phase 26 — optional per loan, not per client (a client can have
          one loan with a codeudor and another without). The codeudor is
          now an existing Client, resolved server-side and linked to their
          own profile instead of shown as static text. Nothing shown at
          all when the loan has none. See
          docs/phasesClient/PHASE_26_CODEBTOR_CLIENT.md. */}
      {loan.coDebtorClient && (
        <div className="flex flex-col gap-2.5 rounded border border-border bg-surface px-6 py-5">
          <span className="text-section-label font-normal tracking-normal text-subtle">
            Codeudor
          </span>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-small">
            <DetailField
              label="Nombre"
              value={
                <Link
                  to={`/clientes/${loan.coDebtorClient.id}`}
                  className="text-white hover:underline"
                >
                  {loan.coDebtorClient.firstName} {loan.coDebtorClient.lastName}
                </Link>
              }
            />
            <DetailField
              label="Documento"
              value={
                loan.coDebtorClient.documentType
                  ? `${DOCUMENT_TYPE_LABELS[loan.coDebtorClient.documentType]} · ${loan.coDebtorClient.documentNumber}`
                  : loan.coDebtorClient.documentNumber
              }
            />
            <DetailField
              label="Teléfono"
              value={loan.coDebtorClient.phoneNumber}
            />
            <DetailField
              label="Relación con el deudor"
              value={loan.coDebtorRelationship}
            />
          </div>
        </div>
      )}

      <InstallmentsTable
        loan={loan}
        onPay={(installment) => setPayingInstallment(installment)}
        oldestPendingInstallmentId={oldestPending?.id ?? null}
        selectedInstallmentIds={selectedInstallmentIds}
        onToggleSelected={(installmentId) =>
          setSelectedInstallmentIds((current) => {
            const next = new Set(current);
            if (next.has(installmentId)) {
              next.delete(installmentId);
            } else {
              next.add(installmentId);
            }
            return next;
          })
        }
      />

      <div className="flex flex-col gap-2.5">
        <span className="text-section-label font-normal tracking-normal text-subtle">
          Historial de pagos
        </span>
        <div className="overflow-hidden rounded-lg bg-surface">
          <table className="w-full">
            <thead className="bg-input">
              <tr>
                <Th className="w-10">#</Th>
                <Th>Fecha</Th>
                <Th>Monto</Th>
                <Th>Observación</Th>
                <Th>Comprobante</Th>
              </tr>
            </thead>
            <tbody>
              {(payments ?? []).length === 0 && (
                <tr>
                  <td
                    colSpan={5}
                    className="p-6 text-center text-small text-muted"
                  >
                    Todavía no se han registrado pagos.
                  </td>
                </tr>
              )}
              {(payments ?? []).map((payment, index) => (
                <tr key={payment.id} className="border-t border-border">
                  <Td muted>{index + 1}</Td>
                  <Td>{formatDateOnly(payment.paidAt)}</Td>
                  <Td>{formatCurrency(payment.amountPaid)}</Td>
                  <Td muted>{payment.observation ?? '—'}</Td>
                  <Td>
                    {payment.imageUrls.length > 0 ? (
                      <div className="flex items-center gap-1.5">
                        {payment.imageUrls.map((imageUrl, imageIndex) => (
                          <button
                            key={imageUrl}
                            type="button"
                            onClick={() =>
                              setEnlargedImage({
                                url: imageUrl,
                                alt: `Comprobante ${imageIndex + 1} del pago del ${formatDateOnly(payment.paidAt)}`,
                              })
                            }
                            className="block"
                          >
                            <img
                              src={imageUrl}
                              alt={`Comprobante ${imageIndex + 1} del pago del ${formatDateOnly(payment.paidAt)}`}
                              className="h-8 w-8 rounded border border-border object-cover hover:border-subtle"
                            />
                          </button>
                        ))}
                      </div>
                    ) : (
                      <span className="text-meta text-mid">—</span>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Updated in Fase 5, now that the real shape is known: WhatsApp
          messages are consolidated per CLIENT (one reminder can cover
          several loans at once), not per loan — there's no "this loan's
          messages" to show here. The client's message history lives on
          ClientDetailPage.tsx instead. */}
      <div className="rounded border border-border bg-surface p-6 text-small text-muted">
        Los mensajes de WhatsApp se agrupan por cliente, no por préstamo —
        puedes verlos en la ficha de{' '}
        <Link
          to={`/clientes/${loan.clientId}`}
          className="text-white hover:underline"
        >
          {clientFullName}
        </Link>
        .
      </div>

      {enlargedImage && (
        <ImageLightbox
          imageUrl={enlargedImage.url}
          alt={enlargedImage.alt}
          onClose={() => setEnlargedImage(null)}
        />
      )}

      {payingInstallment && (
        <RegisterPaymentDialog
          installment={payingInstallment}
          loanLabel={`${loan.promissoryNoteNumber} — ${clientFullName}`}
          onClose={() => setPayingInstallment(null)}
          onConfirm={(input) =>
            registerPayment.mutateAsync({
              installmentId: payingInstallment.id,
              input,
            })
          }
        />
      )}

      {isBulkPaying && (
        <BulkRegisterPaymentDialog
          installments={selectedInstallments}
          loanLabel={`${loan.promissoryNoteNumber} — ${clientFullName}`}
          onClose={() => setIsBulkPaying(false)}
          onConfirm={async (entries) => {
            const result = await registerBulkPayments.mutateAsync(entries);
            setSelectedInstallmentIds(new Set());
            return result;
          }}
        />
      )}

      {isPayingOff && (
        <PayoffDialog
          loanId={loan.id}
          loanLabel={`${loan.promissoryNoteNumber} — ${clientFullName}`}
          onClose={() => setIsPayingOff(false)}
          onConfirm={() => payoffLoan.mutateAsync(loan.id)}
        />
      )}

      {isEditing && (
        <EditLoanDialog
          loanLabel={`${loan.promissoryNoteNumber} — ${clientFullName}`}
          description={loan.description}
          onClose={() => setIsEditing(false)}
          onConfirm={(input) => updateLoan.mutateAsync({ id: loan.id, input })}
        />
      )}

      {isRefinancing && (
        <RefinanceLoanForm
          oldLoanId={loan.id}
          oldLoanClientId={loan.clientId}
          oldLoanLabel={`${loan.promissoryNoteNumber} — ${clientFullName}`}
          oldLoanOutstandingBalance={outstandingBalance}
          oldLoanCoDebtorClient={loan.coDebtorClient}
          oldLoanCoDebtorRelationship={loan.coDebtorRelationship}
          onClose={() => setIsRefinancing(false)}
          onSubmit={async (input) => {
            const newLoan = await refinanceLoan.mutateAsync({
              id: loan.id,
              input,
            });
            // Land on the new loan, not the now-refinanced old one — it's
            // the one the admin actually cares about going forward.
            navigate(`/prestamos/${newLoan.id}`);
          }}
        />
      )}

      {isDeleting && (
        <DeleteLoanDialog
          loanLabel={`${loan.promissoryNoteNumber} — ${clientFullName}`}
          onClose={() => setIsDeleting(false)}
          onConfirm={async () => {
            await removeLoan.mutateAsync(loan.id);
            // The loan no longer exists — land back on the list, same as
            // there being nothing left here to show.
            navigate('/prestamos');
          }}
        />
      )}
    </div>
  );
}

// Phase 23 — replaces the old "list every concept underneath the amount"
// rendering with a genuine dynamic table: one column per charge actually
// assigned to this loan (corriente + moratorio unified, per
// enrichInstallment.ts), one row per installment. Column set is derived
// entirely from whatever the API returns — never a hardcoded list — so a
// loan with 0, 1, or many concepts all render correctly with no code
// change. Horizontal scroll lives inside this table's own container
// (min-w-max + overflow-x-auto), not the page, for a loan with 5+ concepts.
// No client-side recalculation happens anywhere here — every number is
// read straight from the API response.
function InstallmentsTable({
  loan,
  onPay,
  oldestPendingInstallmentId,
  selectedInstallmentIds,
  onToggleSelected,
}: {
  loan: LoanDetail;
  onPay: (installment: Installment) => void;
  // Phase 32 — the single-installment "Pagar" button is only enabled for
  // this one row: the sequential-payment rule (see
  // InstallmentsService.registerPayment) means it's the only pending
  // installment payable on its own right now — matches the parent's
  // already-sorted `pendingInstallments[0]`. Server-side rejection is the
  // real enforcement (defense in depth); this just keeps the UI from
  // offering an action the API would reject.
  oldestPendingInstallmentId: string | null;
  selectedInstallmentIds: Set<string>;
  onToggleSelected: (installmentId: string) => void;
}) {
  const chargeCategoryByName = new Map<string, ConceptCategory>();
  // Added 2026-09-06 (client request — no visual way to tell what rate a
  // given pagaré was actually made at, since two pagarés could legitimately
  // differ as the usury ceiling moves month to month). The rate/flat amount
  // is the same across every cuota of a given charge on one loan — only the
  // resulting currency amount changes cuota to cuota — so it's captured
  // once here, from the first installment that has it, rather than
  // repeated in every row. Shown as a tooltip on the column header (see
  // chargeHeaderTitle below), not inline text, per the client's own
  // preference — a fixed header row is easier to scan than 24 repeated %
  // labels down a column.
  const chargeRateByName = new Map<
    string,
    { value: number; calculationType: ConceptCalculationType }
  >();
  for (const installment of loan.installments) {
    for (const concept of installment.conceptBreakdown) {
      if (!chargeCategoryByName.has(concept.name)) {
        chargeCategoryByName.set(concept.name, concept.category);
      }
      if (
        !chargeRateByName.has(concept.name) &&
        concept.value != null &&
        concept.calculationType != null
      ) {
        chargeRateByName.set(concept.name, {
          value: concept.value,
          calculationType: concept.calculationType,
        });
      }
    }
  }
  const chargeNames = Array.from(chargeCategoryByName.keys());

  function chargeHeaderTitle(name: string): string {
    const category =
      chargeCategoryByName.get(name) === ConceptCategory.Moratorio
        ? 'Moratorio'
        : 'Corriente';
    const rate = chargeRateByName.get(name);
    if (!rate) {
      return category;
    }
    const rateLabel =
      rate.calculationType === ConceptCalculationType.Percentage
        ? `${rate.value}%`
        : `${formatCurrency(rate.value)} fijo`;
    return `${category} · ${rateLabel}`;
  }

  return (
    <div className="flex flex-col gap-2.5">
      <span className="text-section-label font-normal tracking-normal text-subtle">
        Cuotas
      </span>
      <div className="overflow-x-auto rounded border border-border bg-surface">
        <table className="w-full min-w-max border-collapse">
          <thead className="bg-input">
            <tr>
              <Th className="w-8" />
              <Th>N°</Th>
              <Th>Vence</Th>
              <Th>Cuota</Th>
              {chargeNames.map((name) => (
                <Th key={name} title={chargeHeaderTitle(name)}>
                  {name}
                  {/* Shortened to a single letter (style cleanup,
                      2026-09-04) — the full "Corriente"/"Moratorio" word ate
                      too much horizontal space per charge column, which ran
                      out fast on loans with several catalog charges. Same
                      color coding as before. The header's own title=
                      (chargeHeaderTitle, added 2026-09-06) now also carries
                      the %/monto fijo this charge was actually assigned at
                      — hover anywhere on the header cell to see it, instead
                      of repeating it on all 24 rows below (see that
                      function's own comment). */}
                  <span
                    className={`ml-1.5 rounded px-1 py-0.5 text-[9px] font-medium normal-case tracking-normal ${
                      chargeCategoryByName.get(name) ===
                      ConceptCategory.Moratorio
                        ? 'bg-danger/15 text-danger'
                        : 'bg-white/10 text-mid'
                    }`}
                  >
                    {chargeCategoryByName.get(name) ===
                    ConceptCategory.Moratorio
                      ? 'M'
                      : 'C'}
                  </span>
                </Th>
              ))}
              <Th>Mora</Th>
              <Th>Interés</Th>
              <Th>Total</Th>
              <Th>Estado</Th>
              <Th>Acciones</Th>
            </tr>
          </thead>
          <tbody>
            {loan.installments.map((installment) => {
              // Phase 6: cancelled installments (remaining pending ones on
              // a loan at the moment it's refinanced — see
              // docs/DATABASE.md "Refinancing") are kept, not hidden, but
              // shown visually de-emphasized so they read as historical
              // record rather than something still actionable.
              const isCancelled =
                installment.status === InstallmentStatus.Cancelled;
              const isPending =
                installment.status === InstallmentStatus.Pending;
              return (
                <tr
                  key={installment.id}
                  className={`border-t border-border ${isCancelled ? 'opacity-50' : ''}`}
                >
                  <Td>
                    {isPending ? (
                      <input
                        type="checkbox"
                        checked={selectedInstallmentIds.has(installment.id)}
                        onChange={() => onToggleSelected(installment.id)}
                        aria-label={`Seleccionar cuota ${installment.installmentNumber}`}
                        className="h-3.5 w-3.5 accent-white"
                      />
                    ) : null}
                  </Td>
                  <Td>
                    <div className="flex items-center gap-1.5">
                      {installment.installmentNumber}
                      {/* Redesign, 2026-09-03 — flags the loan's own down
                          payment ("cuota inicial"), always installmentNumber
                          1 when present: a real, interest-free installment
                          with its own due date, not a purely informational
                          figure. Replaces the old "Cuota inicial (pagada
                          aparte)" line above the table — see
                          docs/phases/PHASE_13_INITIAL_INSTALLMENT.md for
                          that superseded model. */}
                      {installment.isDownPayment && (
                        <span className="rounded-[3px] border border-border bg-input px-1.5 py-[2px] text-meta font-medium text-muted">
                          Inicial
                        </span>
                      )}
                    </div>
                  </Td>
                  <Td>{formatDateOnly(installment.dueDate)}</Td>
                  <Td>
                    {formatCurrency(installment.amount)}
                    {installment.principalPortion != null && (
                      <div className="mt-0.5 text-meta text-mid">
                        Capital: {formatCurrency(installment.principalPortion)}
                      </div>
                    )}
                  </Td>
                  {chargeNames.map((name) => {
                    const charge = installment.conceptBreakdown.find(
                      (concept) => concept.name === name,
                    );
                    return (
                      <Td key={name} muted={!charge}>
                        {charge ? formatCurrency(charge.amount) : '—'}
                      </Td>
                    );
                  })}
                  <Td>
                    {installment.status === InstallmentStatus.Pending &&
                    installment.overdueDays > 0 ? (
                      <span
                        className={`rounded-[3px] border px-2 py-[3px] text-meta font-medium ${moraBadgeClasses(installment.overdueDays)}`}
                      >
                        {installment.overdueDays} días
                      </span>
                    ) : (
                      <span className="text-mid">—</span>
                    )}
                  </Td>
                  <Td>
                    {installment.interest > 0
                      ? formatCurrency(installment.interest)
                      : '—'}
                  </Td>
                  <Td>
                    {formatCurrency(
                      installment.status === InstallmentStatus.Pending
                        ? installment.totalDue
                        : installment.amount,
                    )}
                  </Td>
                  <Td>
                    {isCancelled ? (
                      <span className="rounded-[3px] border border-mid bg-surface px-2 py-[3px] text-meta font-medium text-mid">
                        Cancelada
                      </span>
                    ) : (
                      installmentStatusLabel(installment.status)
                    )}
                  </Td>
                  <Td>
                    {installment.status === InstallmentStatus.Pending ? (
                      <RowActionButton
                        disabled={installment.id !== oldestPendingInstallmentId}
                        onClick={() => onPay(installment)}
                        title={
                          installment.id !== oldestPendingInstallmentId
                            ? 'Primero debes pagar las cuotas anteriores de este préstamo.'
                            : undefined
                        }
                      >
                        Pagar
                      </RowActionButton>
                    ) : (
                      <span className="text-meta text-mid">—</span>
                    )}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function installmentStatusLabel(status: InstallmentStatus): string {
  switch (status) {
    case InstallmentStatus.Paid:
      return 'Pagada';
    case InstallmentStatus.Cancelled:
      return 'Cancelada';
    default:
      return 'Pendiente';
  }
}

// Local KpiCard removed (style cleanup, 2026-09-02) — was its own third
// copy of the same "label + big number" card as DashboardPage's and
// ClientDetailPage's stat grids, with slightly different padding/label
// size (`p-4`/`text-label` vs `p-5`/`text-small`) than the other two,
// which already matched each other. Replaced with the shared `StatCard`
// so all three use one recipe; see DESIGN_TOKENS.md.

// Phase 21 — a single label/value line for the co-debtor section below.
// Skips rendering entirely when the value is empty, so an optional
// sub-field left blank (e.g. no coDebtorRelationship) doesn't leave a
// dangling "Relación: —" line. Widened to accept a ReactNode (Phase 26) so
// the co-debtor's name can render as a Link to their client profile.
function DetailField({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
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

// Local Th/Td removed (style cleanup, 2026-09-02) — replaced by the shared
// components imported above. The old muted `Td` here used `text-mid`, one
// shade darker than every other table's `text-muted` for the same
// "secondary column" role — an inconsistency found while auditing every
// table in the app; see DESIGN_TOKENS.md. If `text-mid` was actually
// intentional for a specific column, it can take an explicit
// `className="text-mid"` override instead.
