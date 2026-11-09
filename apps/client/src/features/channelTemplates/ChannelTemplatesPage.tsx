import { Link } from 'react-router-dom';

import { Header } from '@/components/layout/Header';
import { BrevoCard } from '@/features/brevo/BrevoCard';
import { ChannelTemplatesCard } from '@/features/channelTemplates/ChannelTemplatesCard';

// Phase 36 — everything about the email and SMS channels (Brevo status,
// test send, per-channel templates), kept on its own sub-page reached from
// the "Correo y SMS" button on Plantillas, so that page stays as it was
// (human request, 2026-11-09). Same message_templates module gate as
// Plantillas — see router.tsx.
export function ChannelTemplatesPage() {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-1.5 text-label">
        <Link to="/plantillas" className="text-muted hover:text-white">
          Plantillas
        </Link>
        <span className="text-mid">/</span>
        <span className="font-medium text-white">Correo y SMS</span>
      </div>

      <Header
        title="Correo y SMS"
        subtitle="Solo ADMIN — Envíos por Brevo; textos editables"
      />

      <BrevoCard />

      <ChannelTemplatesCard />
    </div>
  );
}
