import { useMemo, useState } from 'react';

import { Header } from '@/components/layout/Header';
import { Button } from '@/components/ui/Button';
import { ImageLightbox } from '@/components/ui/ImageLightbox';
import { RowActionButton } from '@/components/ui/RowActionButton';
import {
  useCloseConversation,
  useConversationState,
  useReplyToInboundMessage,
  useWhatsappInboundMessages,
} from '@/features/whatsappInboundMessages/useWhatsappInboundMessages';
import { useWhatsappInboundSocket } from '@/features/whatsappInboundMessages/useWhatsappInboundSocket';
import {
  ConversationMenu,
  WhatsappInboundMessageType,
} from '@/features/whatsappInboundMessages/whatsappInboundMessagesApi';
import { ApiError } from '@/lib/apiClient';
import { formatPhoneNumber } from '@/lib/format';

import type { WhatsappInboundMessage } from '@/features/whatsappInboundMessages/whatsappInboundMessagesApi';
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
// the real menu existed. A sent reply is still only kept in this page's
// local state (lost on refresh) — replies aren't persisted as MessageLog
// rows yet.
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

// A reply sent from this page — kept in local state only, not fetched
// from the server (replies aren't persisted as MessageLog rows yet).
interface LocalReply {
  id: string;
  message: string;
  sentAt: string;
}

type ThreadItem =
  | { direction: 'inbound'; sentAt: string; message: WhatsappInboundMessage }
  | { direction: 'outbound'; sentAt: string; reply: LocalReply };

function buildThreadItems(
  conversation: Conversation,
  localReplies: LocalReply[],
): ThreadItem[] {
  const inbound: ThreadItem[] = conversation.messages.map((message) => ({
    direction: 'inbound',
    sentAt: message.receivedAt,
    message,
  }));
  const outbound: ThreadItem[] = localReplies.map((reply) => ({
    direction: 'outbound',
    sentAt: reply.sentAt,
    reply,
  }));
  return [...inbound, ...outbound].sort(
    (a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime(),
  );
}

export function WhatsappInboundMessagesPage() {
  useWhatsappInboundSocket();

  const [search, setSearch] = useState('');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [localRepliesByKey, setLocalRepliesByKey] = useState<
    Record<string, LocalReply[]>
  >({});

  const { data, isLoading, isError } = useWhatsappInboundMessages({
    search: search || undefined,
    limit: MESSAGE_FETCH_LIMIT,
  });

  const conversations = useMemo(
    () => groupIntoConversations(data?.items ?? []),
    [data],
  );

  const selectedConversation =
    conversations.find((conversation) => conversation.key === selectedKey) ??
    conversations[0] ??
    null;

  function handleReplySent(conversationKey: string, message: string) {
    setLocalRepliesByKey((current) => ({
      ...current,
      [conversationKey]: [
        ...(current[conversationKey] ?? []),
        {
          id: `${Date.now()}-${Math.random()}`,
          message,
          sentAt: new Date().toISOString(),
        },
      ],
    }));
  }

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
              localReplies={localRepliesByKey[selectedConversation.key] ?? []}
              onReplySent={(message) =>
                handleReplySent(selectedConversation.key, message)
              }
            />
          ) : (
            !isLoading && (
              <p className="text-small text-muted">
                Elija una conversación para ver los mensajes.
              </p>
            )
          )}
        </div>
      </div>
    </div>
  );
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
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col gap-1 border-b border-border px-4 py-3 text-left ${
        isActive ? 'bg-input' : 'hover:bg-input/50'
      }`}
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
  localReplies,
  onReplySent,
}: {
  conversation: Conversation;
  localReplies: LocalReply[];
  onReplySent: (message: string) => void;
}) {
  const { data: currentMenu } = useConversationState(conversation.phoneNumber);
  const humanReplyEnabled =
    currentMenu === ConversationMenu.AwaitingReceipt ||
    currentMenu === ConversationMenu.HandedOffToHuman;
  const threadItems = buildThreadItems(conversation, localReplies);

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-center justify-between gap-2 border-b border-border pb-3">
        <div>
          <p className="text-small font-medium text-white">
            {conversation.displayName}
          </p>
          <p className="text-meta text-muted">
            {formatSenderPhoneNumber(conversation.phoneNumber)}
          </p>
        </div>
        {humanReplyEnabled && (
          <CloseConversationButton phoneNumber={conversation.phoneNumber} />
        )}
      </div>

      <div className="flex flex-1 flex-col gap-3">
        {threadItems.map((item) =>
          item.direction === 'inbound' ? (
            <MessageBubble key={item.message.id} message={item.message} />
          ) : (
            <ReplyBubble key={item.reply.id} reply={item.reply} />
          ),
        )}
      </div>

      {humanReplyEnabled ? (
        <ReplyBox phoneNumber={conversation.phoneNumber} onSent={onReplySent} />
      ) : (
        <p className="text-meta text-subtle">
          El cliente todavía no pidió hablar con un asesor ni reportó un pago —
          la respuesta manual se habilita cuando lo hace.
        </p>
      )}
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

// A media message this business's WhatsApp bot actually receives that
// still makes sense to show as an inline thumbnail — a document/audio/
// video gets a "ver archivo" link instead (see MessageBubble below).
const VIEWABLE_IMAGE_TYPES: WhatsappInboundMessageType[] = [
  WhatsappInboundMessageType.Image,
  WhatsappInboundMessageType.Sticker,
];

function MessageBubble({ message }: { message: WhatsappInboundMessage }) {
  const [isImageOpen, setIsImageOpen] = useState(false);
  const isViewableImage = VIEWABLE_IMAGE_TYPES.includes(message.type);

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
          showed. A document/audio/video gets a link instead of an inline
          thumbnail — those don't render as an <img>. */}
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
      {isImageOpen && message.mediaUrl && (
        <ImageLightbox
          imageUrl={message.mediaUrl}
          alt="Imagen enviada por el cliente"
          onClose={() => setIsImageOpen(false)}
        />
      )}
    </div>
  );
}

// Right-aligned, distinct color — the admin's own reply, not something the
// client sent. Local-only (see LocalReply above), so it disappears on
// refresh — it's not fetched from the server.
function ReplyBubble({ reply }: { reply: LocalReply }) {
  return (
    <div className="ml-auto flex max-w-[480px] flex-col gap-1 rounded-lg bg-white/10 px-3.5 py-2.5">
      <div className="flex items-center gap-2">
        <span className="rounded-[3px] border border-border bg-surface px-1.5 py-0.5 text-meta text-muted">
          Tú
        </span>
        <span className="text-meta text-subtle">
          {new Date(reply.sentAt).toLocaleString('es-CO', {
            dateStyle: 'medium',
            timeStyle: 'short',
          })}
        </span>
      </div>
      <p className="text-small text-white">{reply.message}</p>
    </div>
  );
}

function ReplyBox({
  phoneNumber,
  onSent,
}: {
  phoneNumber: string;
  onSent: (message: string) => void;
}) {
  const [draft, setDraft] = useState('');
  const replyMutation = useReplyToInboundMessage();

  function handleSend() {
    const message = draft.trim();
    if (!message) return;

    replyMutation.mutate(
      { phoneNumber, message },
      {
        onSuccess: () => {
          onSent(message);
          setDraft('');
        },
      },
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
