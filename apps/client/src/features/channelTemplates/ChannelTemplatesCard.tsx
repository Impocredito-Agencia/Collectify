import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { BrevoChannel } from '@/features/brevo/brevoApi';
import { ChannelTemplateEditor } from '@/features/channelTemplates/ChannelTemplateEditor';
import {
  fillPlaceholders,
  MESSAGE_TYPE_GROUPS,
} from '@/features/channelTemplates/channelTemplateText';
import {
  countSmsSegments,
  toGsm7Text,
} from '@/features/channelTemplates/smsText';
import { useChannelTemplates } from '@/features/channelTemplates/useChannelTemplates';
import { MESSAGE_TYPE_LABELS } from '@/features/messageTemplates/messageTemplatesApi';

import type { ChannelTemplate } from '@/features/channelTemplates/channelTemplatesApi';
import type { MessageType } from '@/features/messageTemplates/messageTemplatesApi';

interface SelectedTemplate {
  type: MessageType;
  channel: BrevoChannel;
}

function smsCredits(template: ChannelTemplate | undefined): number | null {
  if (!template) {
    return null;
  }
  const examples = template.parameters.map((parameter) => parameter.example);
  return countSmsSegments(toGsm7Text(fillPlaceholders(template.body, examples)))
    .segments;
}

// Phase 36, stage 2 — the email and SMS wording of every message type,
// editable here (unlike the WhatsApp templates, which Meta approves). Not
// sent to clients yet: choosing which messages go by which channel is
// stage 3.
export function ChannelTemplatesCard() {
  const { data: templates, isLoading, isError } = useChannelTemplates();
  const [selected, setSelected] = useState<SelectedTemplate | null>(null);

  const find = (type: MessageType, channel: BrevoChannel) =>
    templates?.find(
      (template) => template.type === type && template.channel === channel,
    );
  // Read from the query cache, so the editor sees the saved version right
  // after saving.
  const selectedTemplate = selected
    ? find(selected.type, selected.channel)
    : undefined;

  return (
    <div className="flex flex-col gap-3.5 rounded bg-surface p-5">
      <div className="flex flex-col gap-1">
        <span className="text-card-title font-medium text-white">
          Plantillas de correo y SMS
        </span>
        <p className="text-label text-muted">
          El texto que recibirá el cliente por correo o SMS en cada tipo de
          mensaje, con los mismos valores que el WhatsApp. Se pueden editar
          libremente. Salen según los envíos automáticos de arriba.
        </p>
      </div>

      {isLoading && <p className="text-small text-muted">Cargando…</p>}
      {isError && (
        <p className="text-small text-danger" role="alert">
          No se pudieron cargar las plantillas de correo y SMS.
        </p>
      )}

      {templates &&
        MESSAGE_TYPE_GROUPS.map((group) => (
          <div key={group.label} className="flex flex-col gap-1.5">
            <span className="text-label text-muted">{group.label}</span>
            {/* A grid of compact cards rather than one full-width row per
                type, which left most of a wide screen empty (human
                feedback, 2026-11-09). items-stretch + justify-between keep
                the buttons on one baseline across a row even when a long
                name wraps. */}
            <div className="grid grid-cols-1 items-stretch gap-2.5 md:grid-cols-2">
              {group.types.map((type) => {
                const credits = smsCredits(find(type, BrevoChannel.Sms));
                return (
                  <div
                    key={type}
                    className="flex flex-col justify-between gap-3 rounded-lg bg-white/[0.03] px-3.5 py-3"
                  >
                    <span className="text-small text-white">
                      {MESSAGE_TYPE_LABELS[type]}
                    </span>
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`text-label ${credits !== null && credits > 1 ? 'text-warning' : 'text-muted'}`}
                      >
                        {credits !== null &&
                          `SMS ≈ ${credits} ${credits === 1 ? 'crédito' : 'créditos'}`}
                      </span>
                      <div className="flex gap-2">
                        <Button
                          variant="secondary"
                          onClick={() =>
                            setSelected({ type, channel: BrevoChannel.Email })
                          }
                        >
                          Correo
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={() =>
                            setSelected({ type, channel: BrevoChannel.Sms })
                          }
                        >
                          SMS
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}

      {selectedTemplate && (
        <ChannelTemplateEditor
          key={`${selectedTemplate.type}-${selectedTemplate.channel}`}
          template={selectedTemplate}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
