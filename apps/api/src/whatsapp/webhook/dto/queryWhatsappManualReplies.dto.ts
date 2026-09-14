import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID } from 'class-validator';

// Human report, 2026-09-14 — same scoping this endpoint's sibling
// (QueryWhatsappInboundMessagesDto) gained the same day: without a
// clientId/fromPhoneNumber filter, every open thread pulled from one flat,
// globally-capped window shared across every conversation's own replies.
export class QueryWhatsappManualRepliesDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  clientId?: string;

  @ApiPropertyOptional({
    description:
      'Scope to one unrecognized-number conversation (clientId is null) — the raw as-received-from-Meta number. Ignored if clientId is also set.',
  })
  @IsOptional()
  @IsString()
  fromPhoneNumber?: string;
}
