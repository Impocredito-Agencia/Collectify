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
      <main className="flex-1 overflow-y-auto px-10 pb-10 pt-8">
        <Outlet />
      </main>
    </div>
  );
}
