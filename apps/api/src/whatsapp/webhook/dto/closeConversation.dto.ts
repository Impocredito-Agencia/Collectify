import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

// Human report, 2026-09-13 — separate from the shared PhoneNumberDto (used
// by GET conversation-state, which has nothing to opt in/out of) since only
// this action gained a second field: whether to actually send the generic
// closing message, or resolve the ticket silently. Defaults to true (the
// original, only-ever behavior) when omitted.
export class CloseConversationDto {
  @ApiProperty({ description: "Recipient's phone number, any format" })
  @IsString()
  @IsNotEmpty()
  phoneNumber!: string;

  @ApiPropertyOptional({
    description:
      'Whether to send the generic closing message to the client. Defaults to true.',
  })
  @IsOptional()
  @IsBoolean()
  sendClosingMessage?: boolean;
}
