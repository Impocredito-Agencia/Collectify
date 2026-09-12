import {
  Body,
  Controller,
  Get,
  Param,
  ParseEnumPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/currentUser.decorator';
import { RequireModule } from '../auth/decorators/requireModule.decorator';
import { PaginatedResult } from '../common/interfaces/paginatedResult.interface';
import { AppModule } from '../users/entities/userModulePermission.entity';

import { UpdateCronScheduleDto } from './dto/updateCronSchedule.dto';
import { ConversationMenu } from './entities/whatsappConversationState.entity';
import { MessageLog } from './entities/messageLog.entity';
import { MessageTemplate } from './entities/messageTemplate.entity';
import { WhatsappInboundMessage } from './entities/whatsappInboundMessage.entity';
import { WhatsappManualReply } from './entities/whatsappManualReply.entity';
import { OverdueReminderService } from './overdueReminder.service';
import { ReminderFamily } from './reminderFamily';
import { UpcomingDueReminderService } from './upcomingDueReminder.service';
import { PhoneNumberDto } from './webhook/dto/phoneNumber.dto';
import { QueryWhatsappInboundMessagesDto } from './webhook/dto/queryWhatsappInboundMessages.dto';
import { ReplyToInboundMessageDto } from './webhook/dto/replyToInboundMessage.dto';
import { WhatsappWebhookService } from './webhook/whatsappWebhook.service';
import { WhatsappCronService } from './whatsappCron.service';

import type { AuthenticatedUser } from '../auth/interfaces/authenticatedUser.interface';

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

  @Post('inbound-messages/reply')
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

  // Human report, 2026-09-19 — a flat recent window, merged client-side
  // into each conversation by WhatsappInboundMessagesPage.tsx, same
  // convention as findInboundMessages above.
  @Get('inbound-messages/manual-replies')
  @ApiOperation({
    summary:
      "An admin's own manual replies, recent window (admin or granted the messages module)",
  })
  @ApiResponse({
    status: 200,
    description: 'Returns the most recent manual replies.',
  })
  findManualReplies(): Promise<WhatsappManualReply[]> {
    return this.whatsappWebhookService.getManualReplies();
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
  @ApiOperation({
    summary:
      'Close a hand-off conversation (admin or granted the messages module)',
    description:
      "Sends a generic closing message and clears the self-service-menu state, so the client's next message gets the menu fresh instead of the bot staying silent — see docs/phases/PHASE_34_INTERACTIVE_MENU.md.",
  })
  @ApiResponse({
    status: 201,
    description: 'Returns whether the closing message actually sent.',
  })
  async closeConversation(
    @Body() dto: PhoneNumberDto,
  ): Promise<{ sent: boolean }> {
    const sent = await this.whatsappWebhookService.closeConversation(
      dto.phoneNumber,
    );
    return { sent };
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
}
