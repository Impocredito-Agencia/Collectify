import { useWhatsappInboundSocket } from '@/features/whatsappInboundMessages/useWhatsappInboundSocket';

// Human report, 2026-09-13 — mounted once in AppLayout (not inside
// WhatsappInboundMessagesPage, which only exists while that route is
// active) so the live socket connection — and so the "Mensajes entrantes"
// sidebar badge — stays current no matter which page a cobrador is
// actually looking at. Renders nothing; it's a side-effect-only component.
export function WhatsappTicketWatcher() {
  useWhatsappInboundSocket();
  return null;
}
