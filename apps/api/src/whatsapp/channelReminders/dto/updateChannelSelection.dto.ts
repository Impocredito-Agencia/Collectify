import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

export class UpdateChannelSelectionDto {
  @ApiPropertyOptional({
    example: true,
    description:
      'Turn the scheduled email reminders on/off for the client. Turning it on requires an email on file. Omit to leave it as is.',
  })
  @IsOptional()
  @IsBoolean()
  emailRemindersEnabled?: boolean;

  @ApiPropertyOptional({
    example: false,
    description:
      'Turn the scheduled SMS reminders on/off for the client (same phones as WhatsApp). Omit to leave it as is.',
  })
  @IsOptional()
  @IsBoolean()
  smsRemindersEnabled?: boolean;
}
