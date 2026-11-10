import { BrevoCard } from '@/features/brevo/BrevoCard';
import { ChannelRecipientsCard } from '@/features/channelReminders/ChannelRecipientsCard';
import { ChannelSchedulesCard } from '@/features/channelReminders/ChannelSchedulesCard';
import { ChannelTemplatesCard } from '@/features/channelTemplates/ChannelTemplatesCard';

// Phase 36 — the "Correo y SMS" tab of Plantillas (/plantillas/correo-sms):
// Brevo status and test send, the schedules, who gets them, and the
// per-channel templates. Was its own sub-page behind a button; now a tab
// next to "WhatsApp", like Préstamos' "Eliminados" (human request,
// 2026-11-09). Same message_templates module gate as Plantillas.
export function EmailSmsPanel() {
  return (
    <>
      <BrevoCard />
      <ChannelSchedulesCard />
      <ChannelRecipientsCard />
      <ChannelTemplatesCard />
    </>
  );
}
