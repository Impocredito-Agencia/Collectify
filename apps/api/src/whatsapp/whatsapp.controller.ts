import {
  Body,
  Controller,
  Get,
  Param,
  ParseEnumPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { Audit } from '../auditLog/decorators/audit.decorator';
import { CurrentUser } from '../auth/decorators/currentUser.decorator';
import { RequireModule } from '../auth/decorators/requireModule.decorator';
import { PaginatedResult } from '../common/interfaces/paginatedResult.interface';
import { AppModule } from '../users/entities/userModulePermission.entity';

import { UpdateCronScheduleDto } from './dto/updateCronSchedule.dto';
import { ConversationMenu } from './entities/whatsappConversationState.entity';
import { WhatsappConversationTicket } from './entities/whatsappConversationTicket.entity';
import { MessageLog } from './entities/messageLog.entity';
import { MessageTemplate } from './entities/messageTemplate.entity';
import { WhatsappInboundMessage } from './entities/whatsappInboundMessage.entity';
import { WhatsappManualReply } from './entities/whatsappManualReply.entity';
import { OverdueReminderService } from './overdueReminder.service';
import { ReminderFamily } from './reminderFamily';
import { UpcomingDueReminderService } from './upcomingDueReminder.service';
import { CloseConversationDto } from './webhook/dto/closeConversation.dto';
import { PhoneNumberDto } from './webhook/dto/phoneNumber.dto';
import { QueryWhatsappConversationsDto } from './webhook/dto/queryWhatsappConversations.dto';
import { QueryWhatsappInboundMessagesDto } from './webhook/dto/queryWhatsappInboundMessages.dto';
import { QueryWhatsappManualRepliesDto } from './webhook/dto/queryWhatsappManualReplies.dto';
import { ReplyToInboundMessageDto } from './webhook/dto/replyToInboundMessage.dto';
import { WhatsappConversationSummary } from './webhook/interfaces/whatsappConversationSummary.interface';
import { WhatsappWebhookService } from './webhook/whatsappWebhook.service';
import { WhatsappConversationTicketService } from './whatsappConversationTicket.service';
import { WhatsappCronService } from './whatsappCron.service';
import { WhatsappDeliveryHealth } from './whatsappDeliveryHealth';

import type { AuthenticatedUser } from '../auth/interfaces/authenticatedUser.interface';
import type { Response } from 'express';

@ApiTags('whatsapp')
@ApiBearerAuth()
// Phase 20 — folded into the "messages" module per the human's decision:
// WhatsApp cron/automation control is part of managing message sends, not
// a separate concern. Was @Roles(UserRole.Admin).
@RequireModule(AppModule.Messages)
@Controller('whatsapp')
export class WhatsappController {
  constructor(
    private readonly overdueReminderService: OverdueReminderService,
    private readonly upcomingDueReminderService: UpcomingDueReminderService,
    private readonly whatsappCronService: WhatsappCronService,
    private readonly whatsappWebhookService: WhatsappWebhookService,
    private readonly whatsappConversationTicketService: WhatsappConversationTicketService,
  ) {}

  @Get('inbound-messages')
  @ApiOperation({
    summary:
      'List inbound WhatsApp messages (admin or granted the messages module) — paginated, filter by client/type/search',
    description:
      "Every button tap or free-text message received via the webhook, whether or not it matched a known client. search matches the matched client's first/last name — see docs/phasesClient/PHASE_22_WHATSAPP_WEBHOOK.md.",
  })
  @ApiResponse({
    status: 200,
    description: 'Returns a page of inbound messages.',
  })
  findInboundMessages(
    @Query() query: QueryWhatsappInboundMessagesDto,
  ): Promise<PaginatedResult<WhatsappInboundMessage>> {
    return this.whatsappWebhookService.findAll(query);
  }

  // Human report, 2026-09-14 (critical bug) — drives the inbox's
  // conversation list instead of findInboundMessages above: paginated by
  // CONVERSATION (one row per contact, aggregated server-side), not by raw
  // message, so a chatty client can no longer crowd others out of the
  // list. See WhatsappWebhookService.findConversations's own comment.
  @Get('conversations')
  @ApiOperation({
    summary:
      'List WhatsApp conversations, one per contact (admin or granted the messages module)',
    description:
      "Paginated by conversation, not by message — each item is the latest event plus a total count for that contact. As of 2026-09-16 this includes a contact who was only ever SENT something (a reminder or self-service/manual reply) and never replied, not only contacts who texted in — lastEvent's direction/source tells the two apart. search matches the matched client's first/last name. Fetch a conversation's own full history separately via GET /whatsapp/inbound-messages?clientId=/fromPhoneNumber=.",
  })
  @ApiResponse({
    status: 200,
    description: 'Returns a page of conversation summaries.',
  })
  findConversations(
    @Query() query: QueryWhatsappConversationsDto,
  ): Promise<PaginatedResult<WhatsappConversationSummary>> {
    return this.whatsappWebhookService.findConversations(query);
  }

  // Human report, 2026-09-14 — an audio/video message must never be
  // re-hosted to Cloudinary (unlike image/document, see
  // WhatsappInboundMessage.mediaUrl's own comment), but a cobrador still
  // needs to listen/watch it from the inbox. Streams the file fetched
  // fresh from Meta on every request instead — @Res() bypasses the global
  // {success, data} envelope entirely, same pattern
  // ClientsImportController's file downloads use, since the response body
  // here is raw bytes an <audio>/<video> element consumes directly, not
  // JSON.
  @Get('inbound-messages/:id/media')
  @ApiOperation({
    summary:
      "Stream an inbound message's original audio/video file straight from Meta (admin or granted the messages module)",
    description:
      "Never persisted anywhere (not Cloudinary, not this API) — fetched fresh from Meta on every call. Meta only keeps a message's media temporarily, so an old enough message can 404 here even though it was received and logged successfully.",
  })
  @ApiResponse({ status: 200, description: 'Streams the raw media bytes.' })
  @ApiResponse({
    status: 404,
    description:
      'This message has no audio/video attached, or Meta no longer has it.',
  })
  async streamInboundMedia(
    @Param('id') id: string,
    @Res() res: Response,
  ): Promise<void> {
    const { bytes, mimeType } =
      await this.whatsappWebhookService.getInboundMedia(id);
    res.set({ 'Content-Type': mimeType });
    res.send(bytes);
  }

  @Post('inbound-messages/reply')
  @Audit('whatsapp.reply', 'whatsappReply')
  @ApiOperation({
    summary:
      'Manually reply to an inbound WhatsApp conversation (admin or granted the messages module)',
    description:
      'Sends a free-form session message — valid because the recipient already messaged in, opening the 24h window. Not tied to any template. See docs/phasesClient/PHASE_22_WHATSAPP_WEBHOOK.md\'s "Noted for later" section — this is the manual-reply half of that, ahead of the full human-handoff/queue flow.',
  })
  @ApiResponse({
    status: 201,
    description: 'Returns whether the send actually succeeded.',
  })
  async replyToInboundMessage(
    @Body() dto: ReplyToInboundMessageDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<{ sent: boolean }> {
    const sent = await this.whatsappWebhookService.sendManualReply(
      dto.phoneNumber,
      dto.message,
      currentUser.id,
    );
    return { sent };
  }

  // Human report, 2026-09-14 — scoped to one conversation (clientId or
  // fromPhoneNumber) since findConversations replaced the old flat,
  // globally-capped fetch this used to back — see getManualReplies' own
  // comment.
  @Get('inbound-messages/manual-replies')
  @ApiOperation({
    summary:
      "A conversation's manual/automated replies, recent window (admin or granted the messages module)",
  })
  @ApiResponse({
    status: 200,
    description: 'Returns the most recent manual replies.',
  })
  findManualReplies(
    @Query() query: QueryWhatsappManualRepliesDto,
  ): Promise<WhatsappManualReply[]> {
    return this.whatsappWebhookService.getManualReplies(query);
  }

  @Get('inbound-messages/conversation-state')
  @ApiOperation({
    summary:
      "One phone number's current self-service-menu state (admin or granted the messages module)",
    description:
      'Backs the "Responder"/"Cerrar conversación" gating on the inbound-messages inbox — null when there\'s no active (or an expired) conversation. See docs/phases/PHASE_34_INTERACTIVE_MENU.md.',
  })
  @ApiResponse({
    status: 200,
    description: 'Returns the current menu, or null if none is active.',
  })
  async getConversationState(
    @Query() query: PhoneNumberDto,
  ): Promise<{ currentMenu: ConversationMenu | null }> {
    const currentMenu = await this.whatsappWebhookService.getConversationState(
      query.phoneNumber,
    );
    return { currentMenu };
  }

  @Post('inbound-messages/close-conversation')
  @Audit('whatsappTicket.resolve', 'whatsappTicket')
  @ApiOperation({
    summary:
      'Close any inbox conversation (admin or granted the messages module)',
    description:
      "Marks the conversation closed (green in the inbox) until the client writes again — see docs/DATABASE.md's whatsapp_conversation_closures. Clears the self-service-menu state, so the client's next message gets the menu fresh instead of the bot staying silent — see docs/phases/PHASE_34_INTERACTIVE_MENU.md. Also resolves that client's WhatsappConversationTicket, if any. Sends the generic closing message unless sendClosingMessage is explicitly false — e.g. a conversation resolved outside WhatsApp, or one whose 24h session window already closed.",
  })
  @ApiResponse({
    status: 201,
    description:
      'Returns whether the closing message actually sent (always false when sendClosingMessage was false).',
  })
  async closeConversation(
    @Body() dto: CloseConversationDto,
  ): Promise<{ sent: boolean }> {
    const sent = await this.whatsappWebhookService.closeConversation(
      dto.phoneNumber,
      dto.sendClosingMessage,
    );
    return { sent };
  }

  // Human report, 2026-09-13 — backs the inbox's pending-tickets badge,
  // filter, and pinning. Flat list, no pagination — see
  // WhatsappConversationTicketService.findAll's own comment.
  @Get('tickets')
  @ApiOperation({
    summary:
      'List every WhatsApp conversation ticket (admin or granted the messages module)',
    description:
      'One row per client that has ever needed a human (Pending or Resolved), oldest-pending-first.',
  })
  @ApiResponse({ status: 200, description: 'Returns every ticket.' })
  findTickets(): Promise<WhatsappConversationTicket[]> {
    return this.whatsappConversationTicketService.findAll();
  }

  @Get('cron/:family/status')
  @ApiOperation({
    summary:
      "Whether a reminder family's cron job is running (admin or granted the messages module)",
    description:
      'One job per family (overdue, upcoming_due) as of Phase 33 — each family internally picks among several exact templates per client. new_loan/refinance and payment-confirmation types have no cron job at all, they send synchronously at their triggering event. See docs/phases/PHASE_33_MESSAGE_TEMPLATES_V2.md.',
  })
  @ApiResponse({ status: 200, description: 'Returns the job running state.' })
  getCronStatus(
    @Param('family', new ParseEnumPipe(ReminderFamily)) family: ReminderFamily,
  ): { running: boolean } {
    return this.whatsappCronService.getStatus(family);
  }

  @Post('cron/:family/pause')
  @Audit('whatsappCron.pause', 'whatsappCron')
  @ApiOperation({
    summary:
      "Pause a reminder family's cron job (admin or granted the messages module)",
  })
  @ApiResponse({ status: 200, description: 'The job is paused.' })
  pauseCron(
    @Param('family', new ParseEnumPipe(ReminderFamily)) family: ReminderFamily,
  ): Promise<{ paused: true }> {
    return this.whatsappCronService.pause(family);
  }

  @Post('cron/:family/resume')
  @Audit('whatsappCron.resume', 'whatsappCron')
  @ApiOperation({
    summary:
      "Resume a reminder family's cron job (admin or granted the messages module)",
  })
  @ApiResponse({ status: 200, description: 'The job is running again.' })
  resumeCron(
    @Param('family', new ParseEnumPipe(ReminderFamily)) family: ReminderFamily,
  ): Promise<{ paused: false }> {
    return this.whatsappCronService.resume(family);
  }

  @Patch('cron/:family/schedule')
  @Audit('whatsappCron.reschedule', 'whatsappCron')
  @ApiOperation({
    summary:
      "Change a reminder family's cron schedule (admin or granted the messages module)",
    description:
      "Persists the new expression on the family's schedule-owner MessageTemplate.cronExpression and reschedules the running job immediately, without a restart.",
  })
  @ApiResponse({ status: 200, description: 'Returns the updated template.' })
  rescheduleCron(
    @Param('family', new ParseEnumPipe(ReminderFamily)) family: ReminderFamily,
    @Body() dto: UpdateCronScheduleDto,
  ): Promise<MessageTemplate> {
    return this.whatsappCronService.reschedule(family, dto.cronExpression);
  }

  @Post('clients/:clientId/send-reminder')
  @Audit('whatsapp.sendReminder', 'client')
  @ApiOperation({
    summary:
      'Manually trigger the overdue reminder for one client (admin or granted the messages module)',
    description:
      'Same grouping/rendering logic as the weekly job, triggered on demand.',
  })
  @ApiResponse({
    status: 201,
    description:
      'Returns the created message log(s) — one per phone number on file for the client.',
  })
  @ApiResponse({
    status: 400,
    description: 'Client has no overdue installments.',
  })
  @ApiResponse({ status: 404, description: 'Client not found.' })
  sendReminder(@Param('clientId') clientId: string): Promise<MessageLog[]> {
    return this.overdueReminderService.sendReminderForClient(clientId);
  }

  @Post('clients/:clientId/send-upcoming-due')
  @Audit('whatsapp.sendUpcomingDue', 'client')
  @ApiOperation({
    summary:
      'Manually trigger the upcoming-due reminder for one client (admin or granted the messages module)',
    description:
      'Same grouping/rendering logic as the daily job, triggered on demand.',
  })
  @ApiResponse({
    status: 201,
    description:
      'Returns the created message log(s) — one per phone number on file for the client.',
  })
  @ApiResponse({
    status: 400,
    description:
      'Client has no installments approaching their due date across their active loans.',
  })
  @ApiResponse({ status: 404, description: 'Client not found.' })
  sendUpcomingDueReminder(
    @Param('clientId') clientId: string,
  ): Promise<MessageLog[]> {
    return this.upcomingDueReminderService.sendReminderForClient(clientId);
  }

  // Human report, 2026-09-16 — "¿cómo sabemos si un cliente nos bloqueó?".
  @Get('clients/:clientId/delivery-health')
  @ApiOperation({
    summary:
      "A client's recent WhatsApp delivery status, and whether they may have blocked the number (admin or granted the messages module)",
    description:
      'Computed from the last few outbound sends (reminders + self-service/manual replies). possiblyBlocked is evidence-based, never a confirmed Meta status — WhatsApp itself never reports a block explicitly. See WhatsappDeliveryHealth.',
  })
  @ApiResponse({
    status: 200,
    description: "Returns the client's delivery health.",
  })
  getDeliveryHealth(
    @Param('clientId') clientId: string,
  ): Promise<WhatsappDeliveryHealth> {
    return this.whatsappWebhookService.getDeliveryHealth(clientId);
  }
}
