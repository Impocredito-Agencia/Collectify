import { Body, Controller, Get, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { Audit } from '../auditLog/decorators/audit.decorator';
import { RequireModule } from '../auth/decorators/requireModule.decorator';
import { AppModule } from '../users/entities/userModulePermission.entity';

import { BrevoService } from './brevo.service';
import { BrevoSendResult, BrevoStatus } from './brevoTypes';
import { SendBrevoTestDto } from './dto/sendBrevoTest.dto';

// Phase 36 — same module gate as the Plantillas page, where the panel's
// Brevo card lives (and where stage 2's per-channel templates will too).
@ApiTags('brevo')
@ApiBearerAuth()
@RequireModule(AppModule.MessageTemplates)
@Controller('brevo')
export class BrevoController {
  constructor(private readonly brevoService: BrevoService) {}

  @Get('status')
  @ApiOperation({
    summary:
      'Brevo email/SMS status (admin or granted the message_templates module)',
    description:
      'Per channel: configured, paused, sender. Plus the Brevo plan and remaining SMS credits, read live from Brevo. Never returns the API key. account.available is false (with a reason) when there is no API key, the key is invalid or Brevo is unreachable.',
  })
  @ApiResponse({ status: 200, description: 'Returns the current status.' })
  @ApiResponse({
    status: 403,
    description: 'Missing the message_templates module.',
  })
  getStatus(): Promise<BrevoStatus> {
    return this.brevoService.getStatus();
  }

  @Post('test')
  @Audit('brevo.testSend', 'brevo')
  @ApiOperation({
    summary:
      'Send a fixed test email or SMS through Brevo (admin or granted the message_templates module)',
    description:
      'The text is fixed server-side (a test SMS is one GSM-7 segment, one credit). Respects BREVO_*_SENDING_PAUSED and BREVO_TEST_RECIPIENTS like any other send. A send Brevo refused, or one skipped because the channel is paused/not configured, is still a 201 with sent: false and a failureReason — it is a business outcome, not a request error.',
  })
  @ApiResponse({
    status: 201,
    description:
      'Returns { sent, providerMessageId, failureReason, errorMessage }.',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid channel, or `to` is not a valid email/phone.',
  })
  sendTest(@Body() dto: SendBrevoTestDto): Promise<BrevoSendResult> {
    return this.brevoService.sendTestMessage(dto.channel, dto.to);
  }
}
