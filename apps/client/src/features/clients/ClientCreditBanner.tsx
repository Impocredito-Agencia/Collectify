import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { useAuth } from '@/features/auth/useAuth';
import { ApplyClientCreditDialog } from '@/features/clients/ApplyClientCreditDialog';
import { RefundClientCreditDialog } from '@/features/clients/RefundClientCreditDialog';
import { useClientCreditBalance } from '@/features/clients/useClients';
import { formatCurrency } from '@/lib/format';

interface ClientCreditBannerProps {
  clientId: string;
  // Set from LoanDetailPage to pre-select (and lock) this loan in the
  // apply dialog — omitted on ClientDetailPage, where the saldo a favor
  // can be applied to any of the client's loans, so the dialog shows a
  // loan picker instead. See ApplyClientCreditDialog's own comment.
  loanId?: string;
}

// Human report, 2026-09-14 — saldo a favor: a client-level credit
// generated automatically when a payment exceeds what its installment
// owed (RegisterPaymentDialog's confirm step already discloses this at
// the moment it happens). Applying it, though, stays a deliberate,
// separate operator action — confirmed with the human, matching
// docs/phases/PHASE_33_MESSAGE_TEMPLATES_V2.md's original requirement
// that this never be silent/automatic, for audit-trail reasons. This
// banner is the only place that action is reachable from, so it only
// renders at all once there's actually something to apply — same
// "conditional banner, zero space otherwise" pattern LoanDetailPage.tsx
// already uses for "este préstamo fue refinanciado".
export function ClientCreditBanner({
  clientId,
  loanId,
}: ClientCreditBannerProps) {
  const { data } = useClientCreditBalance(clientId);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isRefundOpen, setIsRefundOpen] = useState(false);
  // Human request, 2026-09-26 — returning cash to the client is admin-only,
  // like voiding a payment (the endpoint is @Roles(Admin)).
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const balance = data?.balance ?? 0;

  if (balance <= 0) {
    return null;
  }

  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-surface px-4 py-3 text-small text-muted">
      <span>
        Este cliente tiene un saldo a favor de{' '}
        <strong className="text-white">{formatCurrency(balance)}</strong>,
        disponible para aplicar a cualquiera de sus cuotas pendientes.
      </span>
      <div className="flex shrink-0 items-center gap-2">
        {isAdmin && (
          <Button variant="secondary" onClick={() => setIsRefundOpen(true)}>
            Devolver
          </Button>
        )}
        <Button onClick={() => setIsDialogOpen(true)}>Aplicar</Button>
      </div>
      {isRefundOpen && (
        <RefundClientCreditDialog
          clientId={clientId}
          balance={balance}
          onClose={() => setIsRefundOpen(false)}
        />
      )}
      {isDialogOpen && (
        <ApplyClientCreditDialog
          clientId={clientId}
          loanId={loanId}
          balance={balance}
          onClose={() => setIsDialogOpen(false)}
        />
      )}
    </div>
  );
}
