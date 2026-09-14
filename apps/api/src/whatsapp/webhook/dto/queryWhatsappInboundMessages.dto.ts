import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

import { WhatsappInboundMessageType } from '../../entities/whatsappInboundMessage.entity';

export class QueryWhatsappInboundMessagesDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  clientId?: string;

  @ApiPropertyOptional({
    description:
      'Scope to one unrecognized-number conversation (clientId is null) — the raw as-received-from-Meta number, exactly as whatsapp_inbound_messages.from_phone_number stores it. Ignored if clientId is also set.',
  })
  @IsOptional()
  @IsString()
  fromPhoneNumber?: string;

  @ApiPropertyOptional({
    description: "Matches against the matched client's first/last name",
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ enum: WhatsappInboundMessageType })
  @IsOptional()
  @IsEnum(WhatsappInboundMessageType)
  type?: WhatsappInboundMessageType;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}
