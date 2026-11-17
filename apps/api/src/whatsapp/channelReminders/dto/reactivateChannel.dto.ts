import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString } from 'class-validator';

import { normalizePhoneNumber } from '../../../clients/normalizePhoneNumber';
import { BrevoChannel } from '../../../brevo/brevoTypes';

export class ReactivateChannelDto {
  @ApiProperty({ enum: BrevoChannel, example: BrevoChannel.Email })
  @IsEnum(BrevoChannel)
  channel!: BrevoChannel;

  @ApiPropertyOptional({
    example: '+573001234567',
    description:
      'SMS only: the number to re-enable. Omit to re-enable every blocked number of the client.',
  })
  @IsOptional()
  @Transform(({ value }) => normalizePhoneNumber(value))
  @IsString()
  phoneNumber?: string;
}
