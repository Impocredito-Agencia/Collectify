import { useMemo, useState } from 'react';

import { Header } from '@/components/layout/Header';
import { Button } from '@/components/ui/Button';
import { ImageLightbox } from '@/components/ui/ImageLightbox';
import { RowActionButton } from '@/components/ui/RowActionButton';
import { InstallmentStatus } from '@/features/installments/installmentsApi';
import {
  estadoBadge,
  moraBadgeClasses,
} from '@/features/loans/loanStatusDisplay';
import { useLoan, useLoans } from '@/features/loans/useLoans';
import { MessageLogStatus } from '@/features/messageLogs/messageLogsApi';
import { useMessageLogsForClient } from '@/features/messageLogs/useMessageLogs';
import { messageTypeLabel } from '@/features/messageTemplates/messageTemplatesApi';
import { RegisterPaymentFromWhatsappModal } from '@/features/whatsappInboundMessages/RegisterPaymentFromWhatsappModal';
import {
  useCloseConversation,
  useConversationState,
  useManualReplies,
  useReplyToInboundMessage,
  useWhatsappInboundMessages,
} from '@/features/whatsappInboundMessages/useWhatsappInboundMessages';
import { useWhatsappInboundSocket } from '@/features/whatsappInboundMessages/useWhatsappInboundSocket';
import {
  ConversationMenu,
  WhatsappInboundMessageType,
} from '@/features/whatsappInboundMessages/whatsappInboundMessagesApi';
import { ApiError } from '@/lib/apiClient';
import {
  formatCurrency,
  formatDateOnly,
  formatPhoneNumber,
} from '@/lib/format';

import type { Installment } from '@/features/installments/installmentsApi';
import type { LoanSummary } from '@/features/loans/loansApi';
import type { MessageLog } from '@/features/messageLogs/messageLogsApi';
import type {
  WhatsappInboundMessage,
  WhatsappManualReply,
} from '@/features/whatsappInboundMessages/whatsappInboundMessagesApi';
import type { ReactNode } from 'react';

// No Figma frame for this phase (docs/phases/PHASE_22_WHATSAPP_WEBHOOK.md /
// docs/phasesClient/PHASE_22_WHATSAPP_WEBHOOK.md). Redesigned from a flat
// table (one row per message) to a conversation inbox — one entry per
// contact, opened into a chat-style thread — matching how every real
// messaging inbox does this (WhatsApp itself, Intercom, Chatwoot, Front):
// nobody wants a table that grows one row per event from the same person.
// Updates live via useWhatsappInboundSocket instead of needing a manual
// refresh.
//
// Manual reply / "Cerrar conversación" gating (Phase 34, fixed 2026-09-02):
// enabled while the backend's self-service-menu state for that phone
// number is AwaitingReceipt (client tapped "Reportar un pago") or
// HandedOffToHuman (client tapped "Hablar con asesor", or already sent a
// receipt) — see useConversationState and SelfServiceMenuService. The bot
// stays silent on further client messages in either state; "Cerrar
// conversación" sends a generic closing message and clears that state, so
// the client's next message gets the real menu fresh. Replaces the old
// TEST-ONLY "client replies '1'" text-scanning hack this page used before
// the real menu existed. A manual reply is persisted server-side and
// pushed live to every connected admin — see useManualReplies/
// useWhatsappInboundSocket.
//
// Automated messages (human report, 2026-09-19): the reminder/confirmation
// templates a client actually received (message_logs) are merged into
// each conversation's thread too, via useMessageLogsForClient — without
// them, a client's "ya pagué" or a tapped "Más información" looked
// unprompted, since the message that caused it only ever showed up on
// the separate "Mensajes" page.
const MESSAGE_FETCH_LIMIT = 100;

const TYPE_LABELS: Record<WhatsappInboundMessageType, string> = {
  [WhatsappInboundMessageType.Button]: 'Botón',
  [WhatsappInboundMessageType.Text]: 'Texto',
  [WhatsappInboundMessageType.Image]: 'Imagen',
  [WhatsappInboundMessageType.Document]: 'Documento',
  [WhatsappInboundMessageType.Audio]: 'Audio',
  [WhatsappInboundMessageType.Video]: 'Video',
  [WhatsappInboundMessageType.Sticker]: 'Sticker',
  [WhatsappInboundMessageType.Location]: 'Ubicación',
  [WhatsappInboundMessageType.Other]: 'Otro',
};

// Human report, 2026-09-11 — an image/document/etc. with no caption used
// to render as a bare "—" in the message bubble, indistinguishable from a
// genuinely unrecognized event. Icons prefix a caption so it still reads
// as "media with a note attached", and the fallback labels give a caption-
// less media message readable text instead of "—".
const MEDIA_TYPE_ICONS: Partial<Record<WhatsappInboundMessageType, string>> = {
  [WhatsappInboundMessageType.Image]: '📷',
  [WhatsappInboundMessageType.Document]: '📄',
  [WhatsappInboundMessageType.Audio]: '🎙️',
  [WhatsappInboundMessageType.Video]: '🎥',
  [WhatsappInboundMessageType.Sticker]: '🙂',
  [WhatsappInboundMessageType.Location]: '📍',
};

const MEDIA_TYPE_FALLBACK_LABELS: Partial<
  Record<WhatsappInboundMessageType, string>
> = {
  [WhatsappInboundMessageType.Image]: '📷 Imagen',
  [WhatsappInboundMessageType.Document]: '📄 Documento',
  [WhatsappInboundMessageType.Audio]: '🎙️ Nota de voz',
  [WhatsappInboundMessageType.Video]: '🎥 Video',
  [WhatsappInboundMessageType.Sticker]: '🙂 Sticker',
  [WhatsappInboundMessageType.Location]: '📍 Ubicación',
};

interface Conversation {
  key: string; // clientId when matched, otherwise the raw phone number
  // Human report, 2026-09-19 — same as `key` for a recognized contact, but
  // kept separate and nullable: `key` falls back to the raw phone number
  // for an unrecognized one, and the automated-message lookup below needs
  // to know there's genuinely no client to query message_logs by, not
  // treat that phone-number string as a clientId.
  clientId: string | null;
  displayName: string;
  phoneNumber: string;
  messages: WhatsappInboundMessage[]; // chronological — oldest first
  lastMessage: WhatsappInboundMessage;
}

// Groups the flat, newest-first message list into one conversation per
// contact. Purely client-side for now: with MESSAGE_FETCH_LIMIT covering
// every message received so far, a dedicated backend "conversations"
// aggregation endpoint isn't justified yet — revisit once volume actually
// requires server-side pagination per conversation, not per message.
function groupIntoConversations(
  messages: WhatsappInboundMessage[],
): Conversation[] {
  const byKey = new Map<string, WhatsappInboundMessage[]>();

  for (const message of messages) {
    const key = message.clientId ?? message.fromPhoneNumber;
    const existing = byKey.get(key);
    if (existing) {
      existing.push(message);
    } else {
      byKey.set(key, [message]);
    }
  }

  const conversations: Conversation[] = [];
  for (const [key, groupMessages] of byKey) {
    const lastMessage = groupMessages[0];
    conversations.push({
      key,
      clientId: lastMessage.clientId,
      displayName: lastMessage.client
        ? `${lastMessage.client.firstName} ${lastMessage.client.lastName}`
        : 'Número no reconocido',
      phoneNumber: lastMessage.fromPhoneNumber,
      messages: [...groupMessages].reverse(),
      lastMessage,
    });
  }

  return conversations.sort(
    (a, b) =>
      new Date(b.lastMessage.receivedAt).getTime() -
      new Date(a.lastMessage.receivedAt).getTime(),
  );
}

function formatSenderPhoneNumber(fromPhoneNumber: string): string {
  const withPlus = fromPhoneNumber.startsWith('+')
    ? fromPhoneNumber
    : `+${fromPhoneNumber}`;
  return formatPhoneNumber(withPlus);
}

function messagePreview(message: WhatsappInboundMessage): string {
  if (message.bodyText) {
    // A caption on a photo/documento/video — prefix with its icon so it
    // still reads as "media with a note attached", not plain text.
    const icon = MEDIA_TYPE_ICONS[message.type];
    return icon ? `${icon} ${message.bodyText}` : message.bodyText;
  }
  if (message.buttonPayload) {
    return `Botón: ${message.buttonPayload}`;
  }
  return MEDIA_TYPE_FALLBACK_LABELS[message.type] ?? '—';
}

type ThreadItem =
  | { direction: 'inbound'; sentAt: string; message: WhatsappInboundMessage }
  | { direction: 'outbound'; sentAt: string; reply: WhatsappManualReply }
  | { direction: 'automated'; sentAt: string; log: MessageLog };

// Human report, 2026-09-19 — manualReplies is the full flat recent window
// (see useManualReplies), filtered down to this one conversation here.
// Matched the same way groupIntoConversations keys a conversation:
// clientId when the reply resolved to a known client, otherwise the raw
// phone number — reply.phoneNumber is E.164-normalized
// (+573001234567) while conversation.key falls back to the RAW
// as-received-from-Meta number (573001234567) for an unrecognized
// contact, hence the leading '+' stripped before comparing.
//
// messageLogs (human report, 2026-09-19) — the automated reminder/
// confirmation templates the client actually received, so a reply like
// "ya pagué" or a tapped "Más información" reads in context instead of
// looking unprompted. Already scoped to this one client by
// useMessageLogsForClient's clientId param — filtered again here only to
// guard against a stale cache entry from a previously selected
// conversation still being in memory. Empty (and never fetched at all)
// for an unrecognized-number conversation, which has no clientId to
// query message_logs by.
function buildThreadItems(
  conversation: Conversation,
  manualReplies: WhatsappManualReply[],
  messageLogs: MessageLog[],
): ThreadItem[] {
  const inbound: ThreadItem[] = conversation.messages.map((message) => ({
    direction: 'inbound',
    sentAt: message.receivedAt,
    message,
  }));
  const outbound: ThreadItem[] = manualReplies
    .filter(
      (reply) =>
        (reply.clientId ?? reply.phoneNumber.replace('+', '')) ===
        conversation.key,
    )
    .map((reply) => ({
      direction: 'outbound',
      sentAt: reply.sentAt,
      reply,
    }));
  const automated: ThreadItem[] = messageLogs
    .filter((log) => log.clientId === conversation.clientId)
    .map((log) => ({
      direction: 'automated',
      sentAt: log.sentAt,
      log,
    }));
  return [...inbound, ...outbound, ...automated].sort(
    (a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime(),
  );
}

export function WhatsappInboundMessagesPage() {
  useWhatsappInboundSocket();

  const [search, setSearch] = useState('');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [isInfoPanelOpen, setIsInfoPanelOpen] = useState(false);

  const { data, isLoading, isError } = useWhatsappInboundMessages({
    search: search || undefined,
    limit: MESSAGE_FETCH_LIMIT,
  });
  const { data: manualReplies } = useManualReplies();

  const conversations = useMemo(
    () => groupIntoConversations(data?.items ?? []),
    [data],
  );

  const selectedConversation =
    conversations.find((conversation) => conversation.key === selectedKey) ??
    conversations[0] ??
    null;

  return (
    <div className="flex flex-col gap-5">
      <Header
        title="Mensajes entrantes"
        subtitle="Botones tocados y mensajes de texto que los clientes enviaron — se actualiza en vivo"
      />

      <div className="flex h-[38px] w-[280px] items-center gap-2 rounded bg-input px-3">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Buscar cliente…"
          className="w-full bg-transparent text-small text-white placeholder-mid focus:outline-none"
        />
      </div>

      <div className="flex h-[70vh] overflow-hidden rounded-lg bg-surface">
        <div className="flex w-[300px] shrink-0 flex-col overflow-y-auto border-r border-border">
          {isLoading && <SidebarMessage>Cargando…</SidebarMessage>}
          {isError && (
            <SidebarMessage tone="error">
              No se pudieron cargar los mensajes entrantes.
            </SidebarMessage>
          )}
          {!isLoading && !isError && conversations.length === 0 && (
            <SidebarMessage>No hay mensajes entrantes todavía.</SidebarMessage>
          )}
          {conversations.map((conversation) => (
            <ConversationListItem
              key={conversation.key}
              conversation={conversation}
              isActive={conversation.key === selectedConversation?.key}
              onClick={() => setSelectedKey(conversation.key)}
            />
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {selectedConversation ? (
            <ConversationThread
              conversation={selectedConversation}
              manualReplies={manualReplies ?? []}
              isInfoPanelOpen={isInfoPanelOpen}
              onToggleInfoPanel={() => setIsInfoPanelOpen((open) => !open)}
            />
          ) : (
            !isLoading && (
              <p className="text-small text-muted">
                Elija una conversación para ver los mensajes.
              </p>
            )
          )}
        </div>

        {/* Human report, 2026-09-19 — "más informativo para que el admin
            pueda ver de manera rápida la información del cliente": a
            client's pagarés/cuotas at a glance while chatting, without
            leaving this page. Only for a recognized client — an
            unrecognized number has no clientId to look loans up by. */}
        {isInfoPanelOpen && selectedConversation?.clientId && (
          <ClientInfoPanel
            clientId={selectedConversation.clientId}
            clientName={selectedConversation.displayName}
            onClose={() => setIsInfoPanelOpen(false)}
          />
        )}
      </div>
    </div>
  );
}

// Human report, 2026-09-19 — the client's only way to explicitly ask for a
// human is the self-service menu's "Hablar con asesor" button
// (HandedOffToHuman). AwaitingReceipt (tapped "Reportar un pago", still
// waiting on the photo) is deliberately NOT counted here — that's the bot
// still doing its job, not a client waiting on a person.
function hasRequestedAdvisor(
  currentMenu: ConversationMenu | null | undefined,
): boolean {
  return currentMenu === ConversationMenu.HandedOffToHuman;
}

// Left-border accent so an admin scanning the list (or the open thread)
// can tell at a glance which conversations need a person, without opening
// each one — red by default (the bot is still handling it, or nobody's
// asked for anything), green once the client explicitly asked to talk to
// an advisor. Purely a status signal: every conversation can always be
// replied to manually regardless of color (see ReplyBox below).
function attentionBorderClass(requestedAdvisor: boolean): string {
  return requestedAdvisor ? 'border-l-success' : 'border-l-danger';
}

function ConversationListItem({
  conversation,
  isActive,
  onClick,
}: {
  conversation: Conversation;
  isActive: boolean;
  onClick: () => void;
}) {
  const { data: currentMenu } = useConversationState(conversation.phoneNumber);
  const requestedAdvisor = hasRequestedAdvisor(currentMenu);

  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col gap-1 border-b border-border border-l-4 px-4 py-3 text-left ${attentionBorderClass(
        requestedAdvisor,
      )} ${isActive ? 'bg-input' : 'hover:bg-input/50'}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-small font-medium text-white">
          {conversation.displayName}
        </span>
        <span className="shrink-0 text-meta text-subtle">
          {new Date(conversation.lastMessage.receivedAt).toLocaleDateString(
            'es-CO',
            { day: '2-digit', month: '2-digit' },
          )}
        </span>
      </div>
      <span className="truncate text-meta text-muted">
        {messagePreview(conversation.lastMessage)}
      </span>
      {conversation.messages.length > 1 && (
        <span className="text-meta text-subtle">
          {conversation.messages.length} mensajes
        </span>
      )}
    </button>
  );
}

function ConversationThread({
  conversation,
  manualReplies,
  isInfoPanelOpen,
  onToggleInfoPanel,
}: {
  conversation: Conversation;
  manualReplies: WhatsappManualReply[];
  isInfoPanelOpen: boolean;
  onToggleInfoPanel: () => void;
}) {
  const { data: currentMenu } = useConversationState(conversation.phoneNumber);
  const { data: messageLogs } = useMessageLogsForClient(conversation.clientId);
  const requestedAdvisor = hasRequestedAdvisor(currentMenu);
  // Human report, 2026-09-19 — "Cerrar conversación" only means something
  // while the bot is actually paused waiting on this client (AwaitingReceipt)
  // or handed off (HandedOffToHuman); unlike the reply box below, this one
  // stays conditional. Kept as its own check rather than reusing
  // requestedAdvisor (which is HandedOffToHuman only) — AwaitingReceipt
  // still needs a way to bail out of the wait.
  const showCloseConversationButton =
    currentMenu === ConversationMenu.AwaitingReceipt ||
    currentMenu === ConversationMenu.HandedOffToHuman;
  const threadItems = buildThreadItems(
    conversation,
    manualReplies,
    messageLogs?.items ?? [],
  );

  return (
    <div
      className={`flex h-full flex-col gap-4 rounded-lg border-l-4 pl-4 ${attentionBorderClass(
        requestedAdvisor,
      )}`}
    >
      <div className="flex items-center justify-between gap-2 border-b border-border pb-3">
        <div>
          <p className="text-small font-medium text-white">
            {conversation.displayName}
          </p>
          <p className="text-meta text-muted">
            {formatSenderPhoneNumber(conversation.phoneNumber)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {conversation.clientId && (
            <RowActionButton onClick={onToggleInfoPanel}>
              {isInfoPanelOpen ? 'Ocultar información' : 'Ver información'}
            </RowActionButton>
          )}
          {showCloseConversationButton && (
            <CloseConversationButton phoneNumber={conversation.phoneNumber} />
          )}
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-3">
        {threadItems.map((item) => {
          if (item.direction === 'inbound') {
            return (
              <MessageBubble key={item.message.id} message={item.message} />
            );
          }
          if (item.direction === 'outbound') {
            return <ReplyBubble key={item.reply.id} reply={item.reply} />;
          }
          return <AutomatedMessageBubble key={item.log.id} log={item.log} />;
        })}
      </div>

      {/* Human report, 2026-09-19 — replying manually must always stay
          possible, regardless of self-service-menu state: the color-coded
          border above is only a status signal, never a gate. */}
      <ReplyBox phoneNumber={conversation.phoneNumber} />
    </div>
  );
}

function CloseConversationButton({ phoneNumber }: { phoneNumber: string }) {
  const closeConversation = useCloseConversation();

  return (
    <RowActionButton
      disabled={closeConversation.isPending}
      onClick={() => closeConversation.mutate(phoneNumber)}
    >
      {closeConversation.isPending ? 'Cerrando…' : 'Cerrar conversación'}
    </RowActionButton>
  );
}

// Only image ever populates mediaUrl for an inline thumbnail — document
// gets a "ver archivo" link instead (see MessageBubble below). audio/
// video/sticker never re-host at all (see WhatsappMediaService), so they
// never reach either branch.
const VIEWABLE_IMAGE_TYPES: WhatsappInboundMessageType[] = [
  WhatsappInboundMessageType.Image,
];

// Human report, 2026-09-11 — the two kinds relevant as payment evidence,
// the only ones "Registrar pago con este comprobante" applies to.
const PAYMENT_EVIDENCE_TYPES: WhatsappInboundMessageType[] = [
  WhatsappInboundMessageType.Image,
  WhatsappInboundMessageType.Document,
];

function MessageBubble({ message }: { message: WhatsappInboundMessage }) {
  const [isImageOpen, setIsImageOpen] = useState(false);
  const [isRegisteringPayment, setIsRegisteringPayment] = useState(false);
  const isViewableImage = VIEWABLE_IMAGE_TYPES.includes(message.type);
  const canRegisterPayment =
    !message.payment &&
    message.mediaUrl &&
    message.client &&
    PAYMENT_EVIDENCE_TYPES.includes(message.type);

  return (
    <div className="flex max-w-[480px] flex-col gap-1 rounded-lg bg-input px-3.5 py-2.5">
      <div className="flex items-center gap-2">
        <span className="rounded-[3px] border border-border bg-surface px-1.5 py-0.5 text-meta text-muted">
          {TYPE_LABELS[message.type]}
        </span>
        <span className="text-meta text-subtle">
          {new Date(message.receivedAt).toLocaleString('es-CO', {
            dateStyle: 'medium',
            timeStyle: 'short',
          })}
        </span>
      </div>
      {/* Human report, 2026-09-11 — see WhatsappMediaService's own
          comment. mediaUrl is null until that download+upload succeeds
          (or for any non-media message, or while Cloudinary/WhatsApp
          credentials aren't configured), in which case this falls all
          the way through to the same type/caption-only text it always
          showed. document gets a link instead of an inline thumbnail —
          those don't render as an <img>. */}
      {message.mediaUrl && isViewableImage && (
        <button
          type="button"
          onClick={() => setIsImageOpen(true)}
          className="self-start"
        >
          <img
            src={message.mediaUrl}
            alt="Imagen enviada por el cliente"
            className="max-h-56 rounded object-cover"
          />
        </button>
      )}
      {message.mediaUrl && !isViewableImage && (
        <a
          href={message.mediaUrl}
          target="_blank"
          rel="noreferrer"
          className="text-small text-white underline"
        >
          {messagePreview(message)}
        </a>
      )}
      {(!message.mediaUrl || (isViewableImage && message.bodyText)) && (
        <p className="text-small text-white">{messagePreview(message)}</p>
      )}
      {/* Human report, 2026-09-11 — set once "Registrar pago con este
          comprobante" (below) registers a payment from this exact
          message. Shown instead of that button so the same comprobante
          can't accidentally be registered twice. */}
      {message.payment && (
        <p className="text-small text-success">
          ✅ Ya registrado — pago de{' '}
          {formatCurrency(message.payment.amountPaid)} a la cuota{' '}
          {message.payment.installment.installmentNumber} del pagaré{' '}
          {message.payment.installment.loan.promissoryNoteNumber} el{' '}
          {formatDateOnly(message.payment.paidAt)}
        </p>
      )}
      {canRegisterPayment && (
        <button
          type="button"
          onClick={() => setIsRegisteringPayment(true)}
          className="self-start text-small text-white underline"
        >
          Registrar pago con este comprobante
        </button>
      )}
      {isImageOpen && message.mediaUrl && (
        <ImageLightbox
          imageUrl={message.mediaUrl}
          alt="Imagen enviada por el cliente"
          onClose={() => setIsImageOpen(false)}
        />
      )}
      {isRegisteringPayment && message.client && message.mediaUrl && (
        <RegisterPaymentFromWhatsappModal
          clientId={message.client.id}
          mediaUrl={message.mediaUrl}
          sourceWhatsappMessageId={message.id}
          onClose={() => setIsRegisteringPayment(false)}
        />
      )}
    </div>
  );
}

// Right-aligned, distinct color — the admin's own reply, not something the
// client sent. Human report, 2026-09-19 — now persisted server-side and
// pushed live to every connected admin (see useManualReplies/
// useWhatsappInboundSocket), no longer local-only/lost on refresh.
function ReplyBubble({ reply }: { reply: WhatsappManualReply }) {
  // Human report, 2026-09-19 — this table now also holds the self-service
  // menu's own automated replies (sentByUserId null), not just an admin's
  // typed ones — label them apart so "Tú" doesn't misrepresent something
  // the bot sent.
  const isAutomated = reply.sentByUserId === null;
  const failed = reply.status === 'failed';

  return (
    <div
      className={`ml-auto flex max-w-[480px] flex-col gap-1 rounded-lg px-3.5 py-2.5 ${
        failed ? 'bg-danger/10' : 'bg-white/10'
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="rounded-[3px] border border-border bg-surface px-1.5 py-0.5 text-meta text-muted">
          {isAutomated ? 'Automático' : 'Tú'}
        </span>
        <span className="text-meta text-subtle">
          {new Date(reply.sentAt).toLocaleString('es-CO', {
            dateStyle: 'medium',
            timeStyle: 'short',
          })}
        </span>
        {failed && <span className="text-meta text-danger">No entregado</span>}
      </div>
      <p className="text-small text-white">{reply.messageContent}</p>
    </div>
  );
}

// Right-aligned like ReplyBubble (it's also something sent TO the client),
// but visually distinct from an admin's own typed reply — labeled with
// the template type instead of "Tú", and muted further when the send
// actually failed (WHATSAPP_SENDING_PAUSED, a Meta API error, etc.), so
// the admin can tell "the client never got this" from the conversation
// itself. Human report, 2026-09-19 — without this, a client's "ya pagué"
// or a tapped "Más información" showed up with no visible prompt, since
// the reminder/confirmation that caused it lived only on the separate
// "Mensajes" page.
function AutomatedMessageBubble({ log }: { log: MessageLog }) {
  const failed = log.status === MessageLogStatus.Failed;

  return (
    <div
      className={`ml-auto flex max-w-[480px] flex-col gap-1 rounded-lg px-3.5 py-2.5 ${
        failed ? 'bg-danger/10' : 'bg-white/5'
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="rounded-[3px] border border-border bg-surface px-1.5 py-0.5 text-meta text-muted">
          {messageTypeLabel(log.type)}
        </span>
        <span className="text-meta text-subtle">
          {new Date(log.sentAt).toLocaleString('es-CO', {
            dateStyle: 'medium',
            timeStyle: 'short',
          })}
        </span>
        {failed && <span className="text-meta text-danger">No entregado</span>}
      </div>
      <p className="text-small text-white">{log.messageContent}</p>
    </div>
  );
}

function ReplyBox({ phoneNumber }: { phoneNumber: string }) {
  const [draft, setDraft] = useState('');
  const replyMutation = useReplyToInboundMessage();

  function handleSend() {
    const message = draft.trim();
    if (!message) return;

    replyMutation.mutate(
      { phoneNumber, message },
      { onSuccess: () => setDraft('') },
    );
  }

  return (
    <div className="flex flex-col gap-1.5 border-t border-border pt-3">
      {replyMutation.isError && (
        <p className="text-meta text-danger" role="alert">
          {replyMutation.error instanceof ApiError
            ? replyMutation.error.message
            : 'No se pudo enviar la respuesta.'}
        </p>
      )}
      {replyMutation.isSuccess && replyMutation.data === false && (
        <p className="text-meta text-danger" role="alert">
          WhatsApp no confirmó el envío — revise las credenciales de Meta.
        </p>
      )}
      <div className="flex items-center gap-2">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') handleSend();
          }}
          placeholder="Escriba una respuesta…"
          className="h-[38px] flex-1 rounded bg-input px-3 text-small text-white placeholder-mid focus:outline-none"
        />
        <Button
          onClick={handleSend}
          disabled={replyMutation.isPending || !draft.trim()}
          className="h-[38px]"
        >
          {replyMutation.isPending ? 'Enviando…' : 'Enviar'}
        </Button>
      </div>
    </div>
  );
}

// Human report, 2026-09-19 — "un botón para abrir un side menu a la
// derecha que muestre pagarés de la persona y cuotas, algo más
// informativo para que el admin pueda ver de manera rápida la información
// del cliente". Reuses the exact same list endpoint/hook as the
// standalone "Préstamos" screen (useLoans) rather than inventing a new
// combined loans+installments endpoint — LoanSummary already carries
// enough at-a-glance stats (saldo, cuotas pagadas, días de mora, próxima
// cuota) that a full installment breakdown is only fetched per pagaré,
// on demand, when the admin actually expands one (see LoanCard).
function ClientInfoPanel({
  clientId,
  clientName,
  onClose,
}: {
  clientId: string;
  clientName: string;
  onClose: () => void;
}) {
  const { data, isLoading, isError } = useLoans({ clientId, limit: 100 });
  const [expandedLoanId, setExpandedLoanId] = useState<string | null>(null);

  return (
    <div className="flex w-[320px] shrink-0 flex-col overflow-y-auto border-l border-border p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <p className="text-small font-medium text-white">{clientName}</p>
          <p className="text-meta text-muted">Pagarés y cuotas</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar información del cliente"
          className="text-meta text-subtle hover:text-white"
        >
          ✕
        </button>
      </div>

      {isLoading && <p className="text-small text-muted">Cargando…</p>}
      {isError && (
        <p className="text-small text-danger">
          No se pudo cargar la información del cliente.
        </p>
      )}
      {!isLoading && !isError && data?.items.length === 0 && (
        <p className="text-small text-muted">
          Este cliente no tiene pagarés registrados.
        </p>
      )}

      <div className="flex flex-col gap-3">
        {data?.items.map((loan) => (
          <LoanCard
            key={loan.id}
            loan={loan}
            expanded={expandedLoanId === loan.id}
            onToggle={() =>
              setExpandedLoanId((current) =>
                current === loan.id ? null : loan.id,
              )
            }
          />
        ))}
      </div>
    </div>
  );
}

function LoanCard({
  loan,
  expanded,
  onToggle,
}: {
  loan: LoanSummary;
  expanded: boolean;
  onToggle: () => void;
}) {
  // Only fetched once actually expanded — useLoan's own `enabled: Boolean(id)`
  // skips the request entirely for the empty-string id below, same pattern
  // useMessageLogsForClient uses to guard an optional lookup.
  const { data: detail, isLoading: isLoadingDetail } = useLoan(
    expanded ? loan.id : '',
  );
  const estado = estadoBadge(loan);

  return (
    <div className="rounded-lg border border-border">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full flex-col gap-1.5 px-3 py-2.5 text-left"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-small font-medium text-white">
            Pagaré #{loan.promissoryNoteNumber}
          </span>
          <span
            className={`rounded-[3px] border px-1.5 py-0.5 text-meta ${estado.classes}`}
          >
            {estado.label}
          </span>
        </div>
        <p className="text-meta text-muted">
          Saldo: {formatCurrency(loan.outstandingBalance)} · Cuotas pagadas:{' '}
          {loan.installmentsPaid}/{loan.totalInstallments}
        </p>
        {loan.overdueDays > 0 && (
          <span
            className={`w-fit rounded-[3px] border px-1.5 py-0.5 text-meta ${moraBadgeClasses(
              loan.overdueDays,
            )}`}
          >
            {loan.overdueDays} días en mora ·{' '}
            {formatCurrency(loan.overdueBalance)}
          </span>
        )}
        {loan.nextInstallmentDueDate && (
          <p className="text-meta text-subtle">
            Próxima cuota: {formatDateOnly(loan.nextInstallmentDueDate)}
          </p>
        )}
      </button>

      {expanded && (
        <div className="border-t border-border px-3 py-2.5">
          {isLoadingDetail && (
            <p className="text-meta text-muted">Cargando cuotas…</p>
          )}
          {detail?.installments.map((installment) => (
            <InstallmentRow key={installment.id} installment={installment} />
          ))}
        </div>
      )}
    </div>
  );
}

function InstallmentRow({ installment }: { installment: Installment }) {
  const isPending = installment.status === InstallmentStatus.Pending;
  const statusLabel =
    installment.status === InstallmentStatus.Paid
      ? 'Pagada'
      : installment.status === InstallmentStatus.Cancelled
        ? 'Cancelada'
        : installment.overdueDays > 0
          ? `${installment.overdueDays}d mora`
          : 'Pendiente';

  return (
    <div className="flex items-center justify-between gap-2 py-1 text-meta">
      <span className="text-muted">
        Cuota {installment.installmentNumber} ·{' '}
        {formatDateOnly(installment.dueDate)}
      </span>
      <span
        className={
          isPending && installment.overdueDays > 0
            ? 'text-danger'
            : 'text-subtle'
        }
      >
        {formatCurrency(isPending ? installment.totalDue : installment.amount)}{' '}
        · {statusLabel}
      </span>
    </div>
  );
}

function SidebarMessage({
  children,
  tone = 'muted',
}: {
  children: ReactNode;
  tone?: 'muted' | 'error';
}) {
  return (
    <p
      className={`p-4 text-small ${tone === 'error' ? 'text-danger' : 'text-muted'}`}
    >
      {children}
    </p>
  );
}
