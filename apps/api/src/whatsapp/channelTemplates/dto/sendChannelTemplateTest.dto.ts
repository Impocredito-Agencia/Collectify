import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class SendChannelTemplateTestDto {
  @ApiProperty({
    example: 'admin@example.com',
    description:
      'An email for an email template, a Colombian phone (any common format) for an SMS template — checked against the channel in the path.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(254)
  to!: string;
}
