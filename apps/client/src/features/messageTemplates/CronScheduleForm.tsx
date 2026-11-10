import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/Button';
import {
  buildCronExpression,
  DEFAULT_SCHEDULE_CONFIG,
  parseCronExpression,
} from '@/features/messageTemplates/cronScheduleUtils';
import { ApiError } from '@/lib/apiClient';

import type { ScheduleConfig } from '@/features/messageTemplates/cronScheduleUtils';

const DAY_OF_WEEK_OPTIONS = [
  { value: 1, label: 'Lun' },
  { value: 2, label: 'Mar' },
  { value: 3, label: 'Mié' },
  { value: 4, label: 'Jue' },
  { value: 5, label: 'Vie' },
  { value: 6, label: 'Sáb' },
  { value: 0, label: 'Dom' },
];

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

// accent (orange) for the WhatsApp families; blue for the email/SMS
// schedules, so the two are easy to tell apart (human request, 2026-11-09).
export type CronScheduleTone = 'accent' | 'blue';

const DAY_BUTTON_CLASSES: Record<
  CronScheduleTone,
  { selected: string; unselected: string }
> = {
  accent: {
    selected: 'border-accent bg-accent text-white',
    unselected: 'border-border bg-input text-muted hover:text-white',
  },
  blue: {
    selected: 'border-accent-secondary bg-accent-secondary text-white',
    unselected:
      'border-accent-secondary-dim bg-accent-secondary-dim text-accent-secondary-soft hover:text-white',
  },
};

interface CronScheduleFormProps {
  // The saved expression; null while it's still loading.
  cronExpression: string | null;
  onSave: (cronExpression: string) => Promise<unknown>;
  isSaving: boolean;
  tone?: CronScheduleTone;
  // 'meta' (11px, default) on Plantillas; 'label' (12px) on Phase 36's
  // Correo y SMS page, which runs on a 12/13px scale only.
  textSize?: 'meta' | 'label';
}

// The weekly day(s) + time picker behind every automatic send — extracted
// from MessageTemplatesPage's FamilyCronControl (Phase 36) so the WhatsApp
// families and the email/SMS schedules share one picker. Every schedule is
// weekly: the admin picks the day(s) of the week and one time (simplified
// 2026-09-05, human request — no periodicity picker).
export function CronScheduleForm({
  cronExpression,
  onSave,
  isSaving,
  tone = 'accent',
  textSize = 'meta',
}: CronScheduleFormProps) {
  const text = textSize === 'label' ? 'text-label' : 'text-meta';
  const [config, setConfig] = useState<ScheduleConfig>(
    () => parseCronExpression(cronExpression) ?? DEFAULT_SCHEDULE_CONFIG,
  );
  const [isDirty, setIsDirty] = useState(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);

  // Keeps the picker in sync after a successful save (or if another admin
  // changed it) without fighting the admin's own in-progress edits.
  useEffect(() => {
    setConfig(parseCronExpression(cronExpression) ?? DEFAULT_SCHEDULE_CONFIG);
    setIsDirty(false);
  }, [cronExpression]);

  const updateConfig = (changes: Partial<ScheduleConfig>) => {
    setConfig((prev) => ({ ...prev, ...changes }));
    setIsDirty(true);
  };

  const toggleDayOfWeek = (day: number) => {
    updateConfig({
      daysOfWeek: config.daysOfWeek.includes(day)
        ? config.daysOfWeek.filter((d) => d !== day)
        : [...config.daysOfWeek, day],
    });
  };

  const hasNoDaysSelected = config.daysOfWeek.length === 0;

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setScheduleError(null);
    try {
      await onSave(buildCronExpression(config));
      setIsDirty(false);
    } catch (error) {
      setScheduleError(
        error instanceof ApiError
          ? error.message
          : 'No se pudo actualizar el horario.',
      );
    }
  };

  return (
    <>
      <form onSubmit={handleSubmit} className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-1">
          {DAY_OF_WEEK_OPTIONS.map((option) => {
            const isSelected = config.daysOfWeek.includes(option.value);
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={isSelected}
                onClick={() => toggleDayOfWeek(option.value)}
                className={`h-9 rounded border px-2.5 ${text} ${
                  isSelected
                    ? DAY_BUTTON_CLASSES[tone].selected
                    : DAY_BUTTON_CLASSES[tone].unselected
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>

        <div className="flex items-center justify-between gap-2">
          <input
            type="time"
            value={`${pad2(config.hour)}:${pad2(config.minute)}`}
            onChange={(event) => {
              const [hour, minute] = event.target.value.split(':').map(Number);
              updateConfig({ hour, minute });
            }}
            className={`h-9 rounded border border-border bg-input px-2 ${text} text-white focus:outline-none`}
          />

          <Button
            type="submit"
            variant={tone === 'blue' ? 'brandBlue' : 'primary'}
            disabled={!isDirty || hasNoDaysSelected || isSaving}
            className="shrink-0"
          >
            {isSaving ? 'Guardando…' : 'Guardar horario'}
          </Button>
        </div>
        {hasNoDaysSelected && (
          <span className={`${text} text-danger`}>
            Seleccione al menos un día.
          </span>
        )}
        {!hasNoDaysSelected && isDirty && (
          <span className={`${text} text-warning`}>Cambios sin guardar</span>
        )}
      </form>
      {scheduleError && (
        <p className={`${text} text-danger`}>{scheduleError}</p>
      )}
    </>
  );
}
