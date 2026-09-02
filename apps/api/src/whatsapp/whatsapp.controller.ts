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

import { Roles } from '../auth/decorators/roles.decorator';
import { PaginatedResult } from '../common/interfaces/paginatedResult.interface';
import { UserRole } from '../users/entities/user.entity';

import { UpdateCronScheduleDto } from './dto/updateCronSchedule.dto';
import { MessageLog } from './entities/messageLog.entity';
import { MessageTemplate } from './entities/messageTemplate.entity';
import { WhatsappInboundMessage } from './entities/whatsappInboundMessage.entity';
import { OverdueReminderService } from './overdueReminder.service';
import { ReminderFamily } from './reminderFamily';
import { UpcomingDueReminderService } from './upcomingDueReminder.service';
import { QueryWhatsappInboundMessagesDto } from './webhook/dto/queryWhatsappInboundMessages.dto';
import { ReplyToInboundMessageDto } from './webhook/dto/replyToInboundMessage.dto';
import { WhatsappWebhookService } from './webhook/whatsappWebhook.service';
import { WhatsappCronService } from './whatsappCron.service';

@ApiTags('whatsapp')
@ApiBearerAuth()
@Roles(UserRole.Admin)
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
      'List inbound WhatsApp messages (admin only) — paginated, filter by client/type/search',
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
    summary: 'Manually reply to an inbound WhatsApp conversation (admin only)',
    description:
      'Sends a free-form session message — valid because the recipient already messaged in, opening the 24h window. Not tied to any template. See docs/phasesClient/PHASE_22_WHATSAPP_WEBHOOK.md\'s "Noted for later" section — this is the manual-reply half of that, ahead of the full human-handoff/queue flow.',
  })
  @ApiResponse({
    status: 201,
    description: 'Returns whether the send actually succeeded.',
  })
  async replyToInboundMessage(
    @Body() dto: ReplyToInboundMessageDto,
  ): Promise<{ sent: boolean }> {
    const sent = await this.whatsappWebhookService.sendManualReply(
      dto.phoneNumber,
      dto.message,
    );
    return { sent };
  }

  @Get('cron/:family/status')
  @ApiOperation({
    summary: "Whether a reminder family's cron job is running (admin only)",
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
  @ApiOperation({ summary: "Pause a reminder family's cron job (admin only)" })
  @ApiResponse({ status: 200, description: 'The job is paused.' })
  pauseCron(
    @Param('family', new ParseEnumPipe(ReminderFamily)) family: ReminderFamily,
  ): Promise<{ paused: true }> {
    return this.whatsappCronService.pause(family);
  }

  @Post('cron/:family/resume')
  @ApiOperation({ summary: "Resume a reminder family's cron job (admin only)" })
  @ApiResponse({ status: 200, description: 'The job is running again.' })
  resumeCron(
    @Param('family', new ParseEnumPipe(ReminderFamily)) family: ReminderFamily,
  ): { paused: false } {
    return this.whatsappCronService.resume(family);
  }

  @Patch('cron/:family/schedule')
  @ApiOperation({
    summary: "Change a reminder family's cron schedule (admin only)",
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
      'Manually trigger the overdue reminder for one client (admin only)',
    description:
      'Same grouping/rendering logic as the weekly job, triggered on demand.',
  })
  @ApiResponse({ status: 201, description: 'Returns the created message log.' })
  @ApiResponse({
    status: 400,
    description: 'Client has no overdue installments.',
  })
  @ApiResponse({ status: 404, description: 'Client not found.' })
  sendReminder(@Param('clientId') clientId: string): Promise<MessageLog> {
    return this.overdueReminderService.sendReminderForClient(clientId);
  }

  @Post('clients/:clientId/send-upcoming-due')
  @ApiOperation({
    summary:
      'Manually trigger the upcoming-due reminder for one client (admin only)',
    description:
      'Same grouping/rendering logic as the daily job, triggered on demand.',
  })
  @ApiResponse({ status: 201, description: 'Returns the created message log.' })
  @ApiResponse({
    status: 400,
    description:
      'Client has no installments approaching their due date across their active loans.',
  })
  @ApiResponse({ status: 404, description: 'Client not found.' })
  sendUpcomingDueReminder(
    @Param('clientId') clientId: string,
  ): Promise<MessageLog> {
    return this.upcomingDueReminderService.sendReminderForClient(clientId);
  }
}
