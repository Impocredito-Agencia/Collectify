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

// Human report, 2026-09-14 — index.html now always sets a real favicon
// (public/favicon.svg, the same CollectifyMark used in the Sidebar/
// LoginPage). This only ever INJECTS an override that draws a small red
// dot ON TOP of that same mark while something's pending, and removes the
// override otherwise — falling back to index.html's plain mark, never to
// a blank tab icon.
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

// Redraws the same mark as public/favicon.svg/CollectifyMark.tsx (as
// canvas paths, not by loading the SVG file — keeps this synchronous, no
// image-load race) plus a small red dot badge in the corner, same tone as
// --color-danger and the 🔴 marker the inbox's own conversation list
// already uses for a pending ticket.
function buildPendingFaviconDataUrl(): string {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  const context = canvas.getContext('2d');
  if (!context) return '';

  context.fillStyle = '#0f1011';
  context.beginPath();
  context.roundRect(0, 0, 32, 32, 7);
  context.fill();

  context.fillStyle = '#f7f8f8';
  const facets: Array<{ path: [number, number][]; opacity: number }> = [
    {
      path: [
        [12, 2],
        [22, 12],
        [12, 22],
        [2, 12],
      ],
      opacity: 0.22,
    },
    {
      path: [
        [12, 2],
        [22, 12],
        [12, 12],
      ],
      opacity: 0.95,
    },
    {
      path: [
        [12, 12],
        [22, 12],
        [12, 22],
      ],
      opacity: 0.55,
    },
    {
      path: [
        [2, 12],
        [12, 12],
        [12, 22],
      ],
      opacity: 0.75,
    },
  ];
  for (const facet of facets) {
    context.globalAlpha = facet.opacity;
    context.beginPath();
    facet.path.forEach(([x, y], index) => {
      // +4 — same translate(4 4) offset as favicon.svg, centering the
      // mark's 24x24 viewBox inside this 32x32 canvas.
      if (index === 0) context.moveTo(x + 4, y + 4);
      else context.lineTo(x + 4, y + 4);
    });
    context.closePath();
    context.fill();
  }
  context.globalAlpha = 1;

  context.beginPath();
  context.arc(25, 7, 6, 0, Math.PI * 2);
  context.fillStyle = '#ef4444';
  context.fill();

  return canvas.toDataURL('image/png');
}

// Human report, 2026-09-14 — the synthesized "ding-dong" below (kept as
// the fallback) didn't sound right; human wants to pick a real sound
// file. Drop it at public/notification-sound.mp3 (any browser-playable
// format works — .mp3/.ogg/.wav — just keep this exact filename, or
// update NOTIFICATION_SOUND_URL below to match) and it starts playing
// automatically, no other code changes needed. Until that file exists,
// the browser's own 404 makes this silently fall through to the
// synthesized tones, so today's behavior is unchanged.
const NOTIFICATION_SOUND_URL = '/notification-sound.mp3';

function playNotificationSound(): void {
  const audio = new Audio(NOTIFICATION_SOUND_URL);
  audio.volume = 0.5;
  audio.play().catch(() => {
    // Missing file (404), blocked autoplay, or an unsupported format —
    // either way, fall back to the synthesized tones rather than staying
    // silent.
    playSynthesizedNotificationSound();
  });
}

// Two short sine-wave tones (a classic "ding-dong" notification shape),
// synthesized with the Web Audio API — the fallback for when no real
// sound file is present yet (see playNotificationSound above). Never
// throws outward: browsers block audio from playing until the page has
// had at least one real user gesture in this session (an unavoidable
// autoplay restriction, not a bug here), and older browsers may lack
// AudioContext entirely — either way, this silently no-ops and the
// title/favicon alerts above still work.
function playSynthesizedNotificationSound(): void {
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
