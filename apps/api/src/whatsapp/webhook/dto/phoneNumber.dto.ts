import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

// Shared by the two conversation-state admin actions
// (WhatsappController's conversation-state GET and close-conversation
// POST) — same "any format, normalized server-side" contract as
// ReplyToInboundMessageDto.phoneNumber.
export class PhoneNumberDto {
  @ApiProperty({ description: "Recipient's phone number, any format" })
  @IsString()
  @IsNotEmpty()
  phoneNumber!: string;
}
