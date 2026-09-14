import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

// Used by WhatsappController's conversation-state GET — same "any format,
// normalized server-side" contract as ReplyToInboundMessageDto.phoneNumber.
// close-conversation POST moved to its own CloseConversationDto (2026-09-13)
// once that action gained a second field.
export class PhoneNumberDto {
  @ApiProperty({ description: "Recipient's phone number, any format" })
  @IsString()
  @IsNotEmpty()
  phoneNumber!: string;
}
