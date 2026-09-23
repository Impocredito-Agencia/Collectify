import { Outlet } from 'react-router-dom';

import { Sidebar } from '@/components/layout/Sidebar';
import { useAuth } from '@/features/auth/useAuth';
import { WhatsappTicketWatcher } from '@/features/whatsappInboundMessages/WhatsappTicketWatcher';

export function AppLayout() {
  const { user } = useAuth();
  // Same "admin or granted the messages module" check Sidebar uses to
  // decide whether to show the "Mensajes entrantes" nav item at all — kept
  // as its own inline copy rather than a shared helper, matching this
  // codebase's existing tolerance for this kind of small duplication (see
  // AuditLogInterceptor's WHATSAPP_CRON_FAMILY_LABELS comment). Gates the
  // socket connection so a user with no visibility into WhatsApp messages
  // doesn't open one, or get a pointless 403 from GET /whatsapp/tickets.
  const hasMessagesAccess = Boolean(
    user && (user.role === 'admin' || user.modules.includes('messages')),
  );

  return (
    <div className="flex h-screen bg-background">
      {hasMessagesAccess && <WhatsappTicketWatcher />}
      <Sidebar />
      {/* min-w-0 (human report, 2026-09-22 — responsive pass): without it,
          a flex item defaults to min-width: auto, so a page containing
          something with its own intrinsic minimum width (e.g. one of the
          data tables now given min-w-[…] + overflow-x-auto, see
          ClientsListPage.tsx et al.) would grow THIS element — and with
          it, the whole flex row including Sidebar — instead of letting
          that one element scroll internally within its own fixed share
          of the width. */}
      <main className="min-w-0 flex-1 overflow-y-auto px-10 pb-10 pt-8">
        <Outlet />
      </main>
    </div>
  );
}
