import type { ReactNode } from 'react';

export type ChannelTabTone = 'green' | 'blue';

// Active: the channel's solid color — WhatsApp green, or Publi Mark blue
// (accent-secondary) for Correo y SMS. Inactive: a dim version of that same
// color, so both tabs keep their identity and the selected one still
// stands out.
const TONE_CLASSES: Record<ChannelTabTone, { active: string; idle: string }> = {
  green: {
    active: 'bg-whatsapp text-white',
    idle: 'bg-whatsapp-dim text-whatsapp-soft hover:text-white',
  },
  blue: {
    active: 'bg-accent-secondary text-white',
    idle: 'bg-accent-secondary-dim text-accent-secondary-soft hover:text-white',
  },
};

interface ChannelTabProps {
  label: string;
  icon: ReactNode;
  tone: ChannelTabTone;
  isActive: boolean;
  onClick: () => void;
}

// Phase 36 — Plantillas' "WhatsApp" | "Correo y SMS" tabs. Laid out like
// Préstamos' "Préstamos" | "Eliminados" FilterTabs, but each one carries
// its channel's color and icon — the look the old "Correo y SMS" button had
// (human request, 2026-11-09).
export function ChannelTab({
  label,
  icon,
  tone,
  isActive,
  onClick,
}: ChannelTabProps) {
  const classes = TONE_CLASSES[tone];
  return (
    <button
      type="button"
      aria-pressed={isActive}
      onClick={onClick}
      className={`flex items-center gap-2 rounded-lg px-4 py-2.5 text-small font-semibold transition-colors ${
        isActive ? classes.active : classes.idle
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
