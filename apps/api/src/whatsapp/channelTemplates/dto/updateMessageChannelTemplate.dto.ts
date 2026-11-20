import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateMessageChannelTemplateDto {
  @ApiPropertyOptional({
    example: 'Su cuota No. {{2}} vence {{5}}',
    description:
      'Email only (required there, max 150 characters); must be empty for SMS. May use the same {{n}} placeholders as the body.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  subject?: string | null;

  @ApiProperty({
    example:
      '*{{1}}*, IMPROCRÉDITO le informa:\n\nLa cuota *No. {{2}}* del pagaré *{{3}}* vence *{{5}}*.',
    description:
      "Plain text with {{n}} placeholders (1 up to the message type's parameter count). Email: *text* is bold, a blank line starts a paragraph (max 5000). SMS: max 480; accents GSM-7 lacks are dropped when sending.",
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  body!: string;
}
