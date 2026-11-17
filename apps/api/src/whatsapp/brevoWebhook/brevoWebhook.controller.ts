import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Public } from '../../auth/decorators/public.decorator';
import { MessageChannel } from '../messageChannel.enum';

import { BrevoWebhookService } from './brevoWebhook.service';

// Phase 36, stage 4 — Brevo's delivery webhooks, one per channel (Brevo
// configures and shapes them separately). @Public(): Brevo has no JWT of
// ours; BREVO_WEBHOOK_SECRET is checked on every call instead. See
// docs/phases/PHASE_36_BREVO_EMAIL_SMS.md.
@ApiTags('brevo')
@Controller('brevo/webhooks')
export class BrevoWebhookController {
  constructor(private readonly brevoWebhookService: BrevoWebhookService) {}

  @Public()
  @Post('email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Brevo's transactional email events (public, secret-checked)",
    description:
      'Authorization: Bearer <BREVO_WEBHOOK_SECRET>, or Basic auth with it as the password. Accepts one event or an array. Updates the matching message delivery status (never backwards) and marks the client email as not contactable on hard bounce, invalid email, blocked, spam or unsubscribe. Unknown message ids are ignored.',
  })
  @ApiResponse({ status: 200, description: 'Returns { processed }.' })
  @ApiResponse({
    status: 401,
    description: 'Missing/invalid secret, or BREVO_WEBHOOK_SECRET not set.',
  })
  receiveEmail(
    @Headers('authorization') authorization: string | undefined,
    @Body() payload: unknown,
  ): Promise<{ processed: number }> {
    this.brevoWebhookService.assertAuthorized(authorization);
    return this.brevoWebhookService.handle(MessageChannel.Email, payload);
  }

  @Public()
  @Post('sms')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Brevo's transactional SMS events (public, secret-checked)",
    description:
      'Same authentication as the email webhook. Updates the matching SMS delivery status and stops SMS to a number that hard-bounces, is blacklisted or replies STOP (WhatsApp is unaffected).',
  })
  @ApiResponse({ status: 200, description: 'Returns { processed }.' })
  @ApiResponse({
    status: 401,
    description: 'Missing/invalid secret, or BREVO_WEBHOOK_SECRET not set.',
  })
  receiveSms(
    @Headers('authorization') authorization: string | undefined,
    @Body() payload: unknown,
  ): Promise<{ processed: number }> {
    this.brevoWebhookService.assertAuthorized(authorization);
    return this.brevoWebhookService.handle(MessageChannel.Sms, payload);
  }
}
