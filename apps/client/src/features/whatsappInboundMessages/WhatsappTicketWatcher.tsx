import { useEffect, useRef } from 'react';

import { useConversationTickets } from '@/features/whatsappInboundMessages/useWhatsappInboundMessages';
import { useWhatsappInboundSocket } from '@/features/whatsappInboundMessages/useWhatsappInboundSocket';
import { WhatsappTicketStatus } from '@/features/whatsappInboundMessages/whatsappConversationTicketsApi';

// Human report, 2026-09-13 — mounted once in AppLayout (not inside
// WhatsappInboundMessagesPage, which only exists while that route is
// active) so the live socket connection — and so the "Mensajes entrantes"
// sidebar badge, plus the tab-title/favicon/sound alerts below — stays
// current no matter which page a cobrador is actually looking at. Renders
// nothing; it's a side-effect-only component.
export function WhatsappTicketWatcher() {
  useWhatsappInboundSocket();
  useTicketAlerts();
  return null;
}

const FAVICON_LINK_ID = 'whatsapp-pending-ticket-favicon';

// index.html sets no <link rel="icon"> at all today (the browser just
// shows its own blank/default tab icon), so there's no existing favicon to
// draw a badge over — this only ever INJECTS a favicon while there's
// something pending, and removes it entirely otherwise, restoring exactly
// today's "no custom favicon" look rather than inventing a permanent app
// icon nobody asked for.
function setPendingFavicon(pending: boolean): void {
  const existing = document.getElementById(
    FAVICON_LINK_ID,
  ) as HTMLLinkElement | null;

  if (!pending) {
    existing?.remove();
    return;
  }

  const link = existing ?? document.createElement('link');
  link.id = FAVICON_LINK_ID;
  link.rel = 'icon';
  link.href = buildPendingFaviconDataUrl();
  if (!existing) {
    document.head.appendChild(link);
  }
}

// A plain red dot, same tone as --color-danger — matches the 🔴 marker the
// inbox's own conversation list already uses for a pending ticket.
function buildPendingFaviconDataUrl(): string {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  const context = canvas.getContext('2d');
  if (!context) return '';

  context.beginPath();
  context.arc(16, 16, 14, 0, Math.PI * 2);
  context.fillStyle = '#ef4444';
  context.fill();
  return canvas.toDataURL('image/png');
}

// Two short sine-wave tones (a classic "ding-dong" notification shape),
// synthesized with the Web Audio API rather than shipping an audio asset —
// nothing to source/license/bundle. Never throws outward: browsers block
// audio from playing until the page has had at least one real user
// gesture in this session (an unavoidable autoplay restriction, not a bug
// here), and older browsers may lack AudioContext entirely — either way,
// this silently no-ops and the title/favicon alerts above still work.
function playNotificationSound(): void {
  try {
    const AudioContextClass =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioContextClass) return;

    const context = new AudioContextClass();
    const now = context.currentTime;

    [880, 1108.73].forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const start = now + index * 0.12;

      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.2, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.18);

      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.2);
    });

    // Browsers cap how many AudioContexts can exist at once — close this
    // one once both tones have finished rather than leaking one per alert.
    setTimeout(() => void context.close(), 500);
  } catch {
    // Soft-fail — see the comment above.
  }
}

// Human report, 2026-09-13 — "necesito un sistema parecido al de
// WhatsApp/Gmail: me llega un mensaje y suena un sonido, y en la pestaña
// del navegador se ve que hay algo pendiente", explicitly WITHOUT the
// browser's own permission-gated Notification popups — just a sound plus
// the tab's own title/favicon, both of which need no permission at all.
function useTicketAlerts(): void {
  const { data: tickets } = useConversationTickets();
  const pendingCount = (tickets ?? []).filter(
    (ticket) => ticket.status === WhatsappTicketStatus.Pending,
  ).length;

  // Captured once — index.html's title is a static "Collectify", nothing
  // else in this app ever changes document.title.
  const baseTitleRef = useRef(document.title);
  const previousCountRef = useRef<number | null>(null);

  useEffect(() => {
    document.title =
      pendingCount > 0
        ? `(${pendingCount}) ${baseTitleRef.current}`
        : baseTitleRef.current;
    setPendingFavicon(pendingCount > 0);
  }, [pendingCount]);

  useEffect(() => {
    // Skip while the first fetch is still in flight — there's nothing yet
    // to compare against, and a page load that already had, say, 3
    // pending tickets sitting there from before shouldn't ding on arrival.
    if (tickets === undefined) return;

    const previous = previousCountRef.current;
    if (previous !== null && pendingCount > previous) {
      playNotificationSound();
    }
    previousCountRef.current = pendingCount;
  }, [tickets, pendingCount]);

  // Restores the tab to its normal state if this watcher ever unmounts
  // (e.g. an admin revokes the "messages" module mid-session) — AppLayout
  // only renders it while hasMessagesAccess is true. baseTitle is copied
  // to a local rather than read off the ref inside the cleanup itself —
  // it never actually changes post-mount, but this keeps the effect
  // self-contained per the usual React rule for ref reads in a cleanup.
  useEffect(() => {
    const baseTitle = baseTitleRef.current;
    return () => {
      document.title = baseTitle;
      setPendingFavicon(false);
    };
  }, []);
}
