import {
  Body,
  Controller,
  Get,
  Param,
  ParseEnumPipe,
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
import { BrevoChannel, BrevoSendResult } from '../../brevo/brevoTypes';
import { AppModule } from '../../users/entities/userModulePermission.entity';
import { MessageType } from '../messageType.enum';

import { SendChannelTemplateTestDto } from './dto/sendChannelTemplateTest.dto';
import { UpdateMessageChannelTemplateDto } from './dto/updateMessageChannelTemplate.dto';
import {
  MessageChannelTemplatesService,
  MessageChannelTemplateView,
} from './messageChannelTemplates.service';

@ApiTags('message-channel-templates')
@ApiBearerAuth()
@RequireModule(AppModule.MessageTemplates)
@Controller('message-channel-templates')
export class MessageChannelTemplatesController {
  constructor(
    private readonly channelTemplatesService: MessageChannelTemplatesService,
  ) {}

  @Get()
  @ApiOperation({
    summary:
      'List the email and SMS templates (admin or granted the message_templates module)',
    description:
      'One row per message type and channel, each with `parameters`: what every {{n}} placeholder is, plus an example value for previews. See docs/phases/PHASE_36_BREVO_EMAIL_SMS.md.',
  })
  @ApiResponse({ status: 200, description: 'Returns every channel template.' })
  findAll(): Promise<MessageChannelTemplateView[]> {
    return this.channelTemplatesService.findAll();
  }

  @Put(':type/:channel')
  @Audit('messageChannelTemplate.update', 'messageChannelTemplate')
  @ApiOperation({
    summary:
      'Edit an email or SMS template (admin or granted the message_templates module)',
    description:
      "Email needs a subject; SMS must have none. Every {{n}} must be between 1 and the message type's parameter count. Applies from the next send.",
  })
  @ApiResponse({ status: 200, description: 'Returns the updated template.' })
  @ApiResponse({
    status: 400,
    description:
      'Missing/forbidden subject, text too long, or an invalid placeholder.',
  })
  @ApiResponse({ status: 404, description: 'Unknown type/channel pair.' })
  update(
    @Param('type', new ParseEnumPipe(MessageType)) type: MessageType,
    @Param('channel', new ParseEnumPipe(BrevoChannel)) channel: BrevoChannel,
    @Body() dto: UpdateMessageChannelTemplateDto,
  ): Promise<MessageChannelTemplateView> {
    return this.channelTemplatesService.update(type, channel, dto);
  }

  @Post(':type/:channel/test')
  @Audit('messageChannelTemplate.testSend', 'messageChannelTemplate')
  @ApiOperation({
    summary:
      'Send the saved template, filled with example values, as a test (admin or granted the message_templates module)',
    description:
      'Email subjects get a "[Prueba]" prefix; SMS go out in GSM-7 like a real send. Respects the BREVO_*_SENDING_PAUSED switches and BREVO_TEST_RECIPIENTS. A send Brevo refused, or one skipped by a pause, is still a 201 with sent: false and a failureReason.',
  })
  @ApiResponse({
    status: 201,
    description:
      'Returns { sent, providerMessageId, failureReason, errorMessage }.',
  })
  @ApiResponse({
    status: 400,
    description: '`to` is not a valid email/phone for that channel.',
  })
  sendTest(
    @Param('type', new ParseEnumPipe(MessageType)) type: MessageType,
    @Param('channel', new ParseEnumPipe(BrevoChannel)) channel: BrevoChannel,
    @Body() dto: SendChannelTemplateTestDto,
  ): Promise<BrevoSendResult> {
    return this.channelTemplatesService.sendTest(type, channel, dto.to);
  }
}
