import { useEffect, useMemo, useRef, useState } from 'react';

import { Header } from '@/components/layout/Header';
import { Button } from '@/components/ui/Button';
import { ImageLightbox } from '@/components/ui/ImageLightbox';
import { Modal } from '@/components/ui/Modal';
import { Pager } from '@/components/ui/Pager';
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
  useConversations,
  useConversationsForClientIds,
  useConversationState,
  useConversationTickets,
  useManualReplies,
  useReplyToInboundMessage,
  useWhatsappInboundMessages,
} from '@/features/whatsappInboundMessages/useWhatsappInboundMessages';
import {
  WhatsappTicketStatus,
  WhatsappTicketTriggerKind,
} from '@/features/whatsappInboundMessages/whatsappConversationTicketsApi';
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
import { useEscapeKey } from '@/lib/useEscapeKey';

import type { Installment } from '@/features/installments/installmentsApi';
import type { LoanSummary } from '@/features/loans/loansApi';
import type { MessageLog } from '@/features/messageLogs/messageLogsApi';
import type { WhatsappConversationSummary } from '@/features/whatsappInboundMessages/whatsappConversationsApi';
import type { WhatsappConversationTicket } from '@/features/whatsappInboundMessages/whatsappConversationTicketsApi';
import type {
  SelfServiceReplyKind,
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
// Updates live via the socket connection WhatsappTicketWatcher establishes
// in AppLayout (moved there 2026-09-13 so the ticket badge works from any
// page, not just this one) instead of needing a manual refresh.
//
// Ticket badge/filter (human report, 2026-09-13, restructured 2026-09-14 —
// see the critical-bug comment on useConversations): a
// WhatsappConversationTicket (Pending/Resolved — see its own entity
// comment) tracks whether a human still needs to act, separately from the
// bot's own ConversationMenu state below. "Todos" is the recency-ordered,
// server-paginated conversation list; "Esperando asesor" is now a
// SEPARATE data source entirely — the pending tickets themselves, oldest-
// waiting-first, each resolved to its own conversation summary via
// useConversationsForClientIds — rather than a client-side pin/reorder of
// whatever page of "Todos" happened to be loaded. A pinned-within-
// pagination design doesn't compose: a pending ticket's own client might
// not be recently active enough to be on the currently loaded page at
// all, which is exactly the kind of gap this whole restructuring exists
// to close.
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
const CONVERSATIONS_PAGE_SIZE = 20;

// Human report, 2026-09-14 — how many of a conversation's own messages
// load initially once it's opened; "Cargar mensajes anteriores" bumps this
// (see ConversationThread) rather than fetching disjoint pages, so it
// stays one simple growing window instead of merging separate page
// results.
const INITIAL_THREAD_MESSAGE_LIMIT = 50;
const THREAD_MESSAGE_LOAD_MORE_STEP = 50;

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

// One entry in the sidebar list — either tab (see useConversations vs.
// useConversationsForClientIds below). Deliberately carries no message
// history of its own: opening a conversation fetches its thread
// separately, scoped and on demand — see ConversationThread.
interface ConversationSummaryEntry {
  key: string; // clientId when matched, otherwise the raw phone number
  // Human report, 2026-09-19 — same as `key` for a recognized contact, but
  // kept separate and nullable: `key` falls back to the raw phone number
  // for an unrecognized one, and the automated-message lookup below needs
  // to know there's genuinely no client to query message_logs by, not
  // treat that phone-number string as a clientId.
  clientId: string | null;
  displayName: string;
  phoneNumber: string;
  lastMessage: WhatsappInboundMessage;
  messageCount: number;
}

function toConversationSummaryEntry(
  summary: WhatsappConversationSummary,
): ConversationSummaryEntry {
  return {
    key: summary.key,
    clientId: summary.clientId,
    displayName: summary.lastMessage.client
      ? `${summary.lastMessage.client.firstName} ${summary.lastMessage.client.lastName}`
      : 'Número no reconocido',
    phoneNumber: summary.fromPhoneNumber,
    lastMessage: summary.lastMessage,
    messageCount: summary.messageCount,
  };
}

// Human report, 2026-09-13 — short label for why a conversation is
// pending, shown in the conversation list so a cobrador knows without
// opening it. Mirrors apps/api's WhatsappTicketTriggerKind.
const TICKET_TRIGGER_LABELS: Record<WhatsappTicketTriggerKind, string> = {
  [WhatsappTicketTriggerKind.AdvisorRequested]: 'Pidió hablar con un asesor',
  [WhatsappTicketTriggerKind.ReceiptImage]: 'Envió un posible comprobante',
  [WhatsappTicketTriggerKind.ReceiptDocument]:
    'Envió un posible comprobante (documento)',
  [WhatsappTicketTriggerKind.FreeText]: 'Está escribiendo sin usar el menú',
};

function formatSenderPhoneNumber(fromPhoneNumber: string): string {
  const withPlus = fromPhoneNumber.startsWith('+')
    ? fromPhoneNumber
    : `+${fromPhoneNumber}`;
  return formatPhoneNumber(withPlus);
}

// Human report, 2026-09-13 — the conversation list only ever showed the
// date (día/mes), never the time, so two messages from the same day were
// indistinguishable at a glance. Matches how WhatsApp itself does it:
// just the time for anything received today, the date otherwise — keeps
// this compact enough for the list's own narrow column.
function formatConversationTimestamp(receivedAt: string): string {
  const date = new Date(receivedAt);
  const isToday = date.toDateString() === new Date().toDateString();
  return isToday
    ? formatTimeOnly(receivedAt)
    : date.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit' });
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
  | { direction: 'automated'; sentAt: string; log: MessageLog }
  // Human report, 2026-09-13 — see groupRoutineNavigation's own comment.
  // Carries both sides of the run: the client's own taps (messages) and
  // the bot's own routine replies to them (replies) — kept as two arrays
  // rather than one merged/typed list so NavigationGroupBubble can still
  // hand each to the same MessageBubble/ReplyBubble every other item uses.
  | {
      direction: 'navigation';
      sentAt: string;
      messages: WhatsappInboundMessage[];
      replies: WhatsappManualReply[];
    };

// Mirrors apps/api/src/whatsapp/selfServiceMenuPayloads.ts's
// SelfServiceMenuButtonId — only the ones that are PURE navigation, where
// the bot already fully answered on its own and nobody needs to act.
// Deliberately excludes menu_reportar_pago and menu_hablar_asesor (the
// two that hand the conversation off to a human — see
// docs/DATABASE.md's `whatsapp_conversation_states` note) and the two
// quick-reply buttons attached to reminder templates ("Ya pagué", "Más
// información" — a client claiming they already paid, or asking for more
// detail on a specific overdue reminder, is exactly the kind of signal
// that must never end up buried inside a collapsed group).
const ROUTINE_NAVIGATION_PAYLOADS = new Set([
  'menu_mi_cuenta',
  'menu_estado_cuenta',
  'menu_cuotas_pendientes',
  'menu_historial_pagos',
  'menu_volver',
]);

function isRoutineNavigationTap(message: WhatsappInboundMessage): boolean {
  return (
    message.type === WhatsappInboundMessageType.Button &&
    message.buttonPayload !== null &&
    ROUTINE_NAVIGATION_PAYLOADS.has(message.buttonPayload)
  );
}

// Human report, 2026-09-14 — mirrors apps/api's SelfServiceReplyKind:
// every routine reply the self-service menu sends of its own accord, as
// opposed to the three kinds that matter (a receipt request/ack, or the
// advisor hand-off message) — those must never end up hidden inside a
// collapsed group either.
const ROUTINE_SELF_SERVICE_REPLY_KINDS = new Set<SelfServiceReplyKind>([
  'main_menu',
  'mi_cuenta_submenu',
  'breakdown',
  'payment_history',
  'volver_al_menu_follow_up',
]);

function isRoutineBotReply(reply: WhatsappManualReply): boolean {
  return (
    reply.sentByUserId === null &&
    reply.selfServiceReplyKind !== null &&
    ROUTINE_SELF_SERVICE_REPLY_KINDS.has(reply.selfServiceReplyKind)
  );
}

// Human report, 2026-09-14 (bug fix) — every routine tap is answered
// immediately by the bot's own reply (merged into this same thread since
// 2026-09-19's "automated messages" work), which used to unconditionally
// break the run right after a single tap: in practice NO run ever
// collapsed more than one message, defeating the whole point below. The
// bot's own ROUTINE replies (main menu, submenu, breakdown, payment
// history, the "¿algo más?" follow-up) now extend the run instead of
// breaking it — everything else (free text, media, a signal button, the
// admin's own reply, an automated template, or a receipt-request/-ack/
// advisor-handoff reply) still breaks it.
//
// Human report, 2026-09-13 — every menu tap (even pure navigation like
// "Mi cuenta" → "Estado de cuenta" → "Volver al menú") rendered exactly
// like a real message the client typed and sent, which read as noise once
// a client clicked through a few menu screens. Collapses any RUN of
// consecutive routine-navigation taps (and the bot's own routine replies
// to them) into one compact, expandable entry (see NavigationGroupBubble).
// A run of exactly one tap still becomes its own compact entry, for one
// consistent visual treatment regardless of how many taps happened in a
// row.
function groupRoutineNavigation(items: ThreadItem[]): ThreadItem[] {
  const result: ThreadItem[] = [];
  let currentTaps: WhatsappInboundMessage[] = [];
  let currentReplies: WhatsappManualReply[] = [];

  const flushRun = () => {
    if (currentTaps.length === 0) return;
    result.push({
      direction: 'navigation',
      sentAt: currentTaps[0].receivedAt,
      messages: currentTaps,
      replies: currentReplies,
    });
    currentTaps = [];
    currentReplies = [];
  };

  for (const item of items) {
    if (item.direction === 'inbound' && isRoutineNavigationTap(item.message)) {
      currentTaps.push(item.message);
      continue;
    }
    // Only folds into an ALREADY-open run — a routine reply with no
    // active run (shouldn't happen in practice; the bot only ever replies
    // to something) still renders on its own rather than starting a
    // "group" out of nothing.
    if (
      item.direction === 'outbound' &&
      isRoutineBotReply(item.reply) &&
      currentTaps.length > 0
    ) {
      currentReplies.push(item.reply);
      continue;
    }
    flushRun();
    result.push(item);
  }
  flushRun();

  return result;
}

// Human report, 2026-09-14 — messages/manualReplies are now each fetched
// already scoped to this one conversation (see ConversationThread), not
// filtered down from a flat cross-conversation window — this just merges
// the three already-scoped sources into one sorted thread.
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
  clientId: string | null,
  messages: WhatsappInboundMessage[], // chronological — oldest first
  manualReplies: WhatsappManualReply[],
  messageLogs: MessageLog[],
): ThreadItem[] {
  const inbound: ThreadItem[] = messages.map((message) => ({
    direction: 'inbound',
    sentAt: message.receivedAt,
    message,
  }));
  const outbound: ThreadItem[] = manualReplies.map((reply) => ({
    direction: 'outbound',
    sentAt: reply.sentAt,
    reply,
  }));
  const automated: ThreadItem[] = messageLogs
    .filter((log) => log.clientId === clientId)
    .map((log) => ({
      direction: 'automated',
      sentAt: log.sentAt,
      log,
    }));
  const merged = [...inbound, ...outbound, ...automated].sort(
    (a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime(),
  );
  return groupRoutineNavigation(merged);
}

type TicketFilter = 'all' | 'pending';

export function WhatsappInboundMessagesPage() {
  // The live socket connection lives in AppLayout's WhatsappTicketWatcher
  // now (2026-09-13) — this page just reads the same react-query cache it
  // keeps invalidated.

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  // Holds the full entry, not just a key — see the comment on
  // selectedConversation below for why.
  const [selectedConversation, setSelectedConversation] =
    useState<ConversationSummaryEntry | null>(null);
  const [isInfoPanelOpen, setIsInfoPanelOpen] = useState(false);
  const [ticketFilter, setTicketFilter] = useState<TicketFilter>('all');

  // Human report, 2026-09-14 (critical bug) — paginated by conversation
  // server-side now (see useConversations' own comment), replacing the old
  // client-side grouping of a flat, globally-capped message fetch. Reset
  // to page 1 whenever the search term changes, same convention
  // ClientsListPage/LoansListPage already use.
  const {
    data: allConversationsPage,
    isLoading,
    isError,
  } = useConversations({
    search: search || undefined,
    page,
    limit: CONVERSATIONS_PAGE_SIZE,
  });
  const { data: tickets } = useConversationTickets();

  const ticketByClientId = useMemo(() => {
    const map = new Map<string, WhatsappConversationTicket>();
    for (const ticket of tickets ?? []) {
      map.set(ticket.clientId, ticket);
    }
    return map;
  }, [tickets]);

  const pendingTickets = useMemo(
    () =>
      (tickets ?? [])
        .filter((ticket) => ticket.status === WhatsappTicketStatus.Pending)
        // FIFO — a client waiting 2 days shouldn't get buried under one
        // who just wrote in.
        .sort(
          (a, b) =>
            new Date(a.pendingSince).getTime() -
            new Date(b.pendingSince).getTime(),
        ),
    [tickets],
  );

  // Human report, 2026-09-14 (critical bug) — a SEPARATE data source from
  // "Todos", not a client-side filter of whatever page happens to be
  // loaded: see the module comment above for why pinning-within-pagination
  // doesn't compose. Only fetched while this tab is actually active.
  const { data: pendingConversationSummaries } = useConversationsForClientIds(
    ticketFilter === 'pending' ? pendingTickets.map((t) => t.clientId) : [],
  );

  const visibleConversations = useMemo(() => {
    if (ticketFilter === 'pending') {
      const summaryByClientId = new Map(
        (pendingConversationSummaries ?? []).map((summary) => [
          summary.clientId,
          summary,
        ]),
      );
      return pendingTickets
        .map((ticket) => summaryByClientId.get(ticket.clientId))
        .filter((summary): summary is WhatsappConversationSummary =>
          Boolean(summary),
        )
        .map(toConversationSummaryEntry);
    }
    return (allConversationsPage?.items ?? []).map(toConversationSummaryEntry);
  }, [
    ticketFilter,
    pendingTickets,
    pendingConversationSummaries,
    allConversationsPage,
  ]);

  // Falls back to the first visible conversation only once nothing has
  // been explicitly clicked yet. Holds onto the clicked entry directly
  // (not just its key looked back up in visibleConversations) so switching
  // the "Todos"/"Esperando asesor" tab never yanks an already-open thread
  // out from under whoever's reading it, even though the two tabs are now
  // genuinely separate data sources that don't always overlap in memory.
  const effectiveSelectedConversation =
    selectedConversation ?? visibleConversations[0] ?? null;

  return (
    <div className="flex h-full flex-col gap-5">
      <Header
        title="Mensajes entrantes"
        subtitle="Botones tocados y mensajes de texto que los clientes enviaron — se actualiza en vivo"
      />

      <div className="flex items-center gap-3">
        <div className="flex h-[38px] w-[280px] items-center gap-2 rounded bg-input px-3">
          <input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder="Buscar cliente…"
            className="w-full bg-transparent text-small text-white placeholder-mid focus:outline-none"
          />
        </div>
        <div className="flex items-center gap-2">
          <TicketFilterTab
            active={ticketFilter === 'all'}
            onClick={() => setTicketFilter('all')}
          >
            Todos
          </TicketFilterTab>
          <TicketFilterTab
            active={ticketFilter === 'pending'}
            onClick={() => setTicketFilter('pending')}
          >
            Esperando asesor
            {pendingTickets.length > 0 ? ` (${pendingTickets.length})` : ''}
          </TicketFilterTab>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden rounded-lg bg-surface">
        <div className="flex w-[300px] shrink-0 flex-col overflow-y-auto border-r border-border">
          {isLoading && ticketFilter === 'all' && (
            <SidebarMessage>Cargando…</SidebarMessage>
          )}
          {isError && ticketFilter === 'all' && (
            <SidebarMessage tone="error">
              No se pudieron cargar los mensajes entrantes.
            </SidebarMessage>
          )}
          {!isLoading && !isError && visibleConversations.length === 0 && (
            <SidebarMessage>
              {ticketFilter === 'pending'
                ? 'No hay conversaciones esperando asesor.'
                : 'No hay mensajes entrantes todavía.'}
            </SidebarMessage>
          )}
          <div className="flex flex-1 flex-col">
            {visibleConversations.map((conversation) => (
              <ConversationListItem
                key={conversation.key}
                conversation={conversation}
                ticket={ticketByClientId.get(conversation.key) ?? null}
                isActive={
                  conversation.key === effectiveSelectedConversation?.key
                }
                onClick={() => setSelectedConversation(conversation)}
              />
            ))}
          </div>
          {ticketFilter === 'all' &&
            allConversationsPage &&
            allConversationsPage.meta.totalPages > 1 && (
              <div className="flex justify-center border-t border-border p-3">
                <Pager
                  page={page}
                  totalPages={allConversationsPage.meta.totalPages}
                  onPageChange={setPage}
                />
              </div>
            )}
        </div>

        <div className="flex min-h-0 flex-1 flex-col p-5">
          {effectiveSelectedConversation ? (
            <ConversationThread
              conversation={effectiveSelectedConversation}
              ticket={
                ticketByClientId.get(effectiveSelectedConversation.key) ?? null
              }
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
        {isInfoPanelOpen && effectiveSelectedConversation?.clientId && (
          <ClientInfoPanel
            clientId={effectiveSelectedConversation.clientId}
            clientName={effectiveSelectedConversation.displayName}
            onClose={() => setIsInfoPanelOpen(false)}
          />
        )}
      </div>
    </div>
  );
}

type ConversationAttention = 'pending' | 'resolved' | 'none';

// Human report, 2026-09-14 (bug fix) — this used to key off `currentMenu
// === HandedOffToHuman`, which had two real gaps a cobrador ran into:
// (1) closing a conversation just clears that state, so it fell straight
// back to "red", indistinguishable from a conversation that never needed
// anyone; (2) an unprompted comprobante (no "Reportar un pago" first)
// never sets HandedOffToHuman at all, so that conversation stayed red
// forever with no way to tell it had already been flagged. The
// WhatsappConversationTicket this client may have covers both cases
// directly — it's the actual "does a human still need to act" source of
// truth now, not a side effect of the bot's own menu state.
function conversationAttention(
  ticket: WhatsappConversationTicket | null,
): ConversationAttention {
  if (!ticket) return 'none';
  return ticket.status === WhatsappTicketStatus.Pending
    ? 'pending'
    : 'resolved';
}

// Left-border accent so an admin scanning the list (or the open thread)
// can tell at a glance which conversations need a person, without opening
// each one — red while a ticket is pending, green once it's been closed
// (see conversationAttention above), neutral for a conversation that
// never needed a human at all. Purely a status signal: every conversation
// can always be replied to manually regardless of color (see ReplyBox
// below).
function attentionBorderClass(attention: ConversationAttention): string {
  if (attention === 'pending') return 'border-l-danger';
  if (attention === 'resolved') return 'border-l-success';
  return 'border-l-border';
}

// Human report, 2026-09-13 — small pill tabs matching the same active-state
// treatment Sidebar's own nav items use (bg-accent/15 + white text), so
// this reads as the same visual language as the rest of the app rather
// than a one-off control.
function TicketFilterTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-small ${
        active
          ? 'border-transparent bg-accent/15 font-medium text-white'
          : 'border-border text-muted hover:text-white'
      }`}
    >
      {children}
    </button>
  );
}

function ConversationListItem({
  conversation,
  ticket,
  isActive,
  onClick,
}: {
  conversation: ConversationSummaryEntry;
  ticket: WhatsappConversationTicket | null;
  isActive: boolean;
  onClick: () => void;
}) {
  const attention = conversationAttention(ticket);

  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col gap-1 border-b border-border border-l-4 px-4 py-3 text-left ${attentionBorderClass(
        attention,
      )} ${isActive ? 'bg-input' : 'hover:bg-input/50'}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-small font-medium text-white">
          {conversation.displayName}
        </span>
        <span className="shrink-0 text-meta text-subtle">
          {formatConversationTimestamp(conversation.lastMessage.receivedAt)}
        </span>
      </div>
      {attention === 'pending' && ticket && (
        <span className="flex items-center gap-1.5 text-meta text-danger">
          🔴 {TICKET_TRIGGER_LABELS[ticket.triggerKind]}
        </span>
      )}
      {attention === 'resolved' && (
        <span className="flex items-center gap-1.5 text-meta text-success">
          ✅ Conversación cerrada
        </span>
      )}
      <span className="truncate text-meta text-muted">
        {messagePreview(conversation.lastMessage)}
      </span>
      {conversation.messageCount > 1 && (
        <span className="text-meta text-subtle">
          {conversation.messageCount} mensajes
        </span>
      )}
    </button>
  );
}

function ConversationThread({
  conversation,
  ticket,
  isInfoPanelOpen,
  onToggleInfoPanel,
}: {
  conversation: ConversationSummaryEntry;
  ticket: WhatsappConversationTicket | null;
  isInfoPanelOpen: boolean;
  onToggleInfoPanel: () => void;
}) {
  // Human report, 2026-09-14 (critical bug) — this conversation's own
  // history, fetched scoped to it alone (clientId, or fromPhoneNumber for
  // an unrecognized number) instead of grouped out of a flat, globally-
  // capped fetch shared with every other conversation. Starts with the
  // most recent INITIAL_THREAD_MESSAGE_LIMIT messages; "Cargar mensajes
  // anteriores" grows the window rather than fetching a disjoint page, so
  // there's one simple list to merge, not pages to stitch together. Reset
  // to the initial window on every conversation switch — otherwise a
  // long-expanded window from a PREVIOUS conversation would carry over.
  const [threadMessageLimit, setThreadMessageLimit] = useState(
    INITIAL_THREAD_MESSAGE_LIMIT,
  );
  useEffect(() => {
    setThreadMessageLimit(INITIAL_THREAD_MESSAGE_LIMIT);
  }, [conversation.key]);

  const { data: messagesPage } = useWhatsappInboundMessages({
    clientId: conversation.clientId ?? undefined,
    fromPhoneNumber: conversation.clientId
      ? undefined
      : conversation.phoneNumber,
    limit: threadMessageLimit,
  });
  const { data: manualReplies } = useManualReplies({
    clientId: conversation.clientId,
    fromPhoneNumber: conversation.phoneNumber,
  });
  const { data: currentMenu } = useConversationState(conversation.phoneNumber);
  const { data: messageLogs } = useMessageLogsForClient(conversation.clientId);
  const attention = conversationAttention(ticket);
  // Human report, 2026-09-14 (bug fix) — used to gate on `currentMenu ===
  // HandedOffToHuman`, which an unprompted comprobante never sets at all
  // (see conversationAttention's own comment) — that conversation had a
  // pending ticket with no way to close it. AwaitingReceipt is kept as
  // its own OR'd condition since a ticket doesn't exist yet at that point
  // (only once the receipt actually arrives, or the client asks for an
  // advisor) — it still needs a way to bail out of the wait.
  const showCloseConversationButton =
    currentMenu === ConversationMenu.AwaitingReceipt || attention === 'pending';
  // findAll (and so messagesPage) comes back newest-first — reversed here
  // to chronological order, same as the old groupIntoConversations did.
  const messages = [...(messagesPage?.items ?? [])].reverse();
  const hasOlderMessages = (messagesPage?.meta.total ?? 0) > messages.length;
  const threadItems = buildThreadItems(
    conversation.clientId,
    messages,
    manualReplies ?? [],
    messageLogs?.items ?? [],
  );

  // Human report, 2026-09-13 — opening a conversation (or a new message
  // arriving in the one already open) used to leave the view wherever it
  // last was, which for a long thread meant landing on the OLDEST message
  // instead of the most recent one. Scrolls the message list (not the
  // whole thread column — the header/reply box stay put) to the bottom on
  // both: a conversation switch (conversation.key) and thread growth
  // (threadItems.length). Human report, 2026-09-14 — EXCEPT when that
  // growth came from "Cargar mensajes anteriores": jumping back to the
  // bottom right after loading older history would undo the very thing
  // that button was just clicked for.
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const skipNextAutoScrollRef = useRef(false);
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    if (skipNextAutoScrollRef.current) {
      skipNextAutoScrollRef.current = false;
      return;
    }
    container.scrollTop = container.scrollHeight;
  }, [conversation.key, threadItems.length]);

  return (
    <div
      className={`flex h-full flex-col gap-4 rounded-lg border-l-4 pl-4 ${attentionBorderClass(
        attention,
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
          {attention === 'resolved' && (
            <p className="mt-1 flex items-center gap-1.5 text-meta text-success">
              ✅ Conversación cerrada
            </p>
          )}
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

      <div
        ref={messagesContainerRef}
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto"
      >
        {hasOlderMessages && (
          <button
            type="button"
            onClick={() => {
              skipNextAutoScrollRef.current = true;
              setThreadMessageLimit(
                (limit) => limit + THREAD_MESSAGE_LOAD_MORE_STEP,
              );
            }}
            className="mx-auto rounded-full border border-border px-3 py-1 text-meta text-subtle hover:text-muted"
          >
            Cargar mensajes anteriores
          </button>
        )}
        {threadItems.map((item) => {
          if (item.direction === 'inbound') {
            return (
              <MessageBubble key={item.message.id} message={item.message} />
            );
          }
          if (item.direction === 'outbound') {
            return <ReplyBubble key={item.reply.id} reply={item.reply} />;
          }
          if (item.direction === 'navigation') {
            return (
              <NavigationGroupBubble
                key={item.messages[0].id}
                messages={item.messages}
                replies={item.replies}
              />
            );
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

// Human report, 2026-09-14 — the "Avisar al cliente" checkbox used to sit
// inline between "Ver información" and "Cerrar conversación" in the
// header, with no context on what it actually did — easy to miss, and not
// obvious it only applies to closing. Moved into its own confirmation
// dialog (same Modal pattern as VoidPaymentDialog on the loan detail
// page), where it has room for a real explanation.
function CloseConversationButton({ phoneNumber }: { phoneNumber: string }) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  return (
    <>
      <RowActionButton onClick={() => setIsDialogOpen(true)}>
        Cerrar conversación
      </RowActionButton>
      {isDialogOpen && (
        <CloseConversationDialog
          phoneNumber={phoneNumber}
          onClose={() => setIsDialogOpen(false)}
        />
      )}
    </>
  );
}

function CloseConversationDialog({
  phoneNumber,
  onClose,
}: {
  phoneNumber: string;
  onClose: () => void;
}) {
  const closeConversation = useCloseConversation();
  // Defaults to checked — the only behavior this had before this dialog
  // existed, so closing a conversation still sends the generic closing
  // message unless someone deliberately unchecks it.
  const [sendClosingMessage, setSendClosingMessage] = useState(true);

  useEscapeKey(onClose);

  const handleConfirm = () => {
    closeConversation.mutate(
      { phoneNumber, sendClosingMessage },
      { onSuccess: onClose },
    );
  };

  return (
    <Modal maxWidth="max-w-[420px]">
      <h2 className="text-[16px] font-medium text-white">
        Cerrar conversación
      </h2>
      <p className="mt-2.5 text-small text-muted">
        Marca la conversación como resuelta y borra el estado del menú de
        autoservicio, así el próximo mensaje del cliente arranca el menú desde
        cero.
      </p>

      <label className="mt-4 flex items-start gap-2">
        <input
          type="checkbox"
          checked={sendClosingMessage}
          onChange={(event) => setSendClosingMessage(event.target.checked)}
          className="mt-0.5 h-3.5 w-3.5 accent-white"
        />
        <span className="text-small text-white">
          Avisar al cliente
          <span className="mt-0.5 block text-meta text-subtle">
            Le manda un mensaje de cierre por WhatsApp. Desmárcalo si ya se le
            avisó por otro medio, o si su ventana de 24 horas ya se cerró (el
            envío fallaría de todas formas).
          </span>
        </span>
      </label>

      {closeConversation.isError && (
        <p className="mt-3 text-small text-danger" role="alert">
          No se pudo cerrar la conversación. Intenta de nuevo.
        </p>
      )}

      <div className="mt-6 border-t border-border" />

      <div className="mt-5 flex items-center justify-end gap-3">
        <Button
          variant="secondary"
          onClick={onClose}
          disabled={closeConversation.isPending}
        >
          Cancelar
        </Button>
        <Button onClick={handleConfirm} disabled={closeConversation.isPending}>
          {closeConversation.isPending ? 'Cerrando…' : 'Cerrar conversación'}
        </Button>
      </div>
    </Modal>
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

function formatTimeOnly(receivedAt: string): string {
  return new Date(receivedAt).toLocaleString('es-CO', { timeStyle: 'short' });
}

type NavigationDetailItem =
  | { kind: 'tap'; sentAt: string; message: WhatsappInboundMessage }
  | { kind: 'reply'; sentAt: string; reply: WhatsappManualReply };

// Human report, 2026-09-13 — see groupRoutineNavigation's own comment.
// Collapsed by default as a small centered pill (distinct from both the
// client's left-aligned bubbles and the admin's right-aligned ones — this
// isn't a message either side "said", it's the bot's own menu handling
// noted for the record) so a run of routine menu taps takes one compact
// line instead of one full bubble each; expands in place to the same
// MessageBubble/ReplyBubble treatment every other item gets, for anyone
// who actually needs to trace exactly what was tapped, and what the bot
// answered, and when.
function NavigationGroupBubble({
  messages,
  replies,
}: {
  messages: WhatsappInboundMessage[];
  replies: WhatsappManualReply[];
}) {
  const [expanded, setExpanded] = useState(false);

  if (expanded) {
    const detailItems: NavigationDetailItem[] = [
      ...messages.map((message) => ({
        kind: 'tap' as const,
        sentAt: message.receivedAt,
        message,
      })),
      ...replies.map((reply) => ({
        kind: 'reply' as const,
        sentAt: reply.sentAt,
        reply,
      })),
    ].sort(
      (a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime(),
    );

    return (
      <div className="flex flex-col gap-2">
        {detailItems.map((item) =>
          item.kind === 'tap' ? (
            <MessageBubble key={item.message.id} message={item.message} />
          ) : (
            <ReplyBubble key={item.reply.id} reply={item.reply} />
          ),
        )}
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="self-center text-meta text-subtle hover:text-muted"
        >
          Ocultar detalle ▲
        </button>
      </div>
    );
  }

  const timeRange =
    messages.length > 1
      ? `${formatTimeOnly(messages[0].receivedAt)}–${formatTimeOnly(messages[messages.length - 1].receivedAt)}`
      : formatTimeOnly(messages[0].receivedAt);
  const label =
    messages.length === 1
      ? '1 interacción de menú'
      : `${messages.length} interacciones de menú`;

  return (
    <button
      type="button"
      onClick={() => setExpanded(true)}
      className="mx-auto flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-meta text-subtle hover:text-muted"
    >
      🔘 {label} · {timeRange} ▾
    </button>
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
            {/* Human report, 2026-09-14 (bug fix) — a hardcoded "#" here
                doubled up into "##1041" for any loan created since
                2026-09-03, whose promissoryNoteNumber already stores the
                "#" as part of the value itself (see
                apps/api/src/common/promissoryNoteLabel.ts's own comment
                on the two coexisting shapes). Every other place in this
                app that displays promissoryNoteNumber (LoanRow,
                LoanDetailPage, ClientDetailPage, etc.) already renders it
                raw, with no prefix — this is the one that didn't match. */}
            Pagaré {loan.promissoryNoteNumber}
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
