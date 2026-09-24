import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { connectNamespace } from '@/lib/socket';

// Pushes a live update into the "Mensajes entrantes" inbox — see
// docs/phasesClient/PHASE_22_WHATSAPP_WEBHOOK.md. Invalidates rather than
// merging the pushed message directly into the cache, matching this
// project's existing pattern (useRetryMessageLog) for "something changed,
// refetch" instead of hand-rolled cache surgery.
export function useWhatsappInboundSocket(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    const socket = connectNamespace('whatsapp-inbound');

    socket.on('inbound-message', () => {
      void queryClient.invalidateQueries({
        queryKey: ['whatsappInboundMessages'],
      });
      // Human report, 2026-09-14 — a new inbound event changes which
      // conversation is most recent (and its preview/count), so the
      // conversations list needs to refetch too, not just an already-open
      // thread.
      void queryClient.invalidateQueries({
        queryKey: ['whatsappConversations'],
      });
    });

    // Human report, 2026-09-19 — an admin's manual reply now persists and
    // pushes live, same as an inbound client message, so every OTHER
    // connected admin sees it immediately too.
    socket.on('manual-reply', () => {
      void queryClient.invalidateQueries({
        queryKey: ['whatsappManualReplies'],
      });
      // Human report, 2026-09-23 — "que los chats se ordenen siempre por el
      // más reciente tal cual lo hace WhatsApp": any reply (an admin's or
      // the bot's) makes that chat the newest, so the list re-sorts too.
      void queryClient.invalidateQueries({
        queryKey: ['whatsappConversations'],
      });
    });

    // Human report, 2026-09-23 — a reminder/confirmation went out, or an
    // admin closed a chat: the list's order or green/closed state changed
    // for a reason none of the other events cover. See the gateway's
    // emitConversationUpdate.
    socket.on('conversation-update', () => {
      void queryClient.invalidateQueries({
        queryKey: ['whatsappConversations'],
      });
    });

    // Human report, 2026-09-13 — a ticket can open/reopen/resolve outside
    // an inbound event too (closing a conversation resolves it), so this
    // gets its own event rather than piggybacking on 'inbound-message' —
    // keeps the "Mensajes entrantes" sidebar badge/filter/pinning live.
    socket.on('ticket-update', () => {
      void queryClient.invalidateQueries({
        queryKey: ['whatsappConversationTickets'],
      });
    });

    return () => {
      socket.disconnect();
    };
  }, [queryClient]);
}
