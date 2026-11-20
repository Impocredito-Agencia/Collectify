import {
  Body,
  Controller,
  Get,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { Audit } from '../../auditLog/decorators/audit.decorator';
import { RequireModule } from '../../auth/decorators/requireModule.decorator';
import { BrevoChannel } from '../../brevo/brevoTypes';
import { AppModule } from '../../users/entities/userModulePermission.entity';
import { UpdateCronScheduleDto } from '../dto/updateCronSchedule.dto';
import {
  ChannelReminderFamily,
  MessageChannelSchedule,
} from '../entities/messageChannelSchedule.entity';
import { ReminderFamily } from '../reminderFamily';

import {
  BulkSelectionResult,
  ChannelRecipient,
  ChannelRecipientsService,
  ChannelSelectionChange,
} from './channelRecipients.service';
import { ChannelReminderCronService } from './channelReminderCron.service';
import { BulkUpdateChannelSelectionDto } from './dto/bulkUpdateChannelSelection.dto';
import { UpdateChannelSelectionDto } from './dto/updateChannelSelection.dto';

// Phase 36, stage 3 — the scheduled email/SMS reminders: when they run
// (per family and channel) and which clients get them. Same module gate as
// the rest of Plantillas → Correo y SMS.
@ApiTags('message-channels')
@ApiBearerAuth()
@RequireModule(AppModule.MessageTemplates)
@Controller('message-channels')
export class ChannelRemindersController {
  constructor(
    private readonly cronService: ChannelReminderCronService,
    private readonly recipientsService: ChannelRecipientsService,
  ) {}

  @Get('schedules')
  @ApiOperation({
    summary:
      'List the email/SMS reminder schedules (admin or granted the message_templates module)',
    description:
      'One row per family (overdue, upcoming_due, credit_report) and channel (email, sms), each with its own cron expression (America/Bogota) and paused flag. Independent of the WhatsApp schedule of the same family.',
  })
  @ApiResponse({ status: 200, description: 'Returns every schedule.' })
  findSchedules(): Promise<MessageChannelSchedule[]> {
    return this.cronService.findAll();
  }

  @Patch('schedules/:family/:channel')
  @Audit('channelReminder.reschedule', 'channelReminderSchedule')
  @ApiOperation({
    summary: 'Change when an email/SMS reminder family runs',
  })
  @ApiResponse({ status: 200, description: 'Returns the updated schedule.' })
  @ApiResponse({ status: 400, description: 'Invalid cron expression.' })
  @ApiResponse({
    status: 404,
    description: 'That family has no email/SMS schedule (e.g. new_loan).',
  })
  reschedule(
    @Param('family', new ParseEnumPipe(ReminderFamily)) family: ReminderFamily,
    @Param('channel', new ParseEnumPipe(BrevoChannel)) channel: BrevoChannel,
    @Body() dto: UpdateCronScheduleDto,
  ): Promise<MessageChannelSchedule> {
    return this.cronService.reschedule(
      family as ChannelReminderFamily,
      channel,
      dto.cronExpression,
    );
  }

  @Post('schedules/:family/:channel/pause')
  @Audit('channelReminder.pause', 'channelReminderSchedule')
  @ApiOperation({ summary: 'Pause an email/SMS reminder family' })
  @ApiResponse({ status: 201, description: 'Returns the updated schedule.' })
  pause(
    @Param('family', new ParseEnumPipe(ReminderFamily)) family: ReminderFamily,
    @Param('channel', new ParseEnumPipe(BrevoChannel)) channel: BrevoChannel,
  ): Promise<MessageChannelSchedule> {
    return this.cronService.setPaused(
      family as ChannelReminderFamily,
      channel,
      true,
    );
  }

  @Post('schedules/:family/:channel/resume')
  @Audit('channelReminder.resume', 'channelReminderSchedule')
  @ApiOperation({
    summary:
      'Turn on an email/SMS reminder family — it then runs on its schedule for the selected clients',
  })
  @ApiResponse({ status: 201, description: 'Returns the updated schedule.' })
  resume(
    @Param('family', new ParseEnumPipe(ReminderFamily)) family: ReminderFamily,
    @Param('channel', new ParseEnumPipe(BrevoChannel)) channel: BrevoChannel,
  ): Promise<MessageChannelSchedule> {
    return this.cronService.setPaused(
      family as ChannelReminderFamily,
      channel,
      false,
    );
  }

  @Get('recipients')
  @ApiOperation({
    summary: 'Clients to pick for email/SMS reminders',
    description:
      'Every client with an overdue cuota (most days of mora first), plus every client who already has email or SMS reminders on.',
  })
  @ApiResponse({ status: 200, description: 'Returns the list.' })
  listRecipients(): Promise<ChannelRecipient[]> {
    return this.recipientsService.list();
  }

  @Put('recipients')
  @Audit('channelReminder.updateRecipients', 'channelReminderRecipients')
  @ApiOperation({
    summary: 'Turn email/SMS reminders on or off for several clients',
    description:
      'Clients without an email are skipped (and listed) when turning email on.',
  })
  @ApiResponse({
    status: 200,
    description: 'Returns { updatedClientIds, skippedWithoutEmail }.',
  })
  @ApiResponse({ status: 400, description: 'No channel given.' })
  updateRecipients(
    @Body() dto: BulkUpdateChannelSelectionDto,
  ): Promise<BulkSelectionResult> {
    const { clientIds, ...change } = dto;
    return this.recipientsService.updateMany(clientIds, change);
  }

  @Put('recipients/:clientId')
  @Audit('channelReminder.updateClient', 'client')
  @ApiOperation({
    summary: "Turn a client's email/SMS reminders on or off",
  })
  @ApiResponse({
    status: 200,
    description: 'Returns the client’s two flags.',
  })
  @ApiResponse({
    status: 400,
    description: 'Turning email on for a client with no email.',
  })
  @ApiResponse({ status: 404, description: 'Client not found.' })
  updateRecipient(
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Body() dto: UpdateChannelSelectionDto,
  ): Promise<ChannelSelectionChange> {
    return this.recipientsService.updateOne(clientId, dto);
  }
}
