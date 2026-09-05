import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

import { MessageLogStatus } from '../../entities/messageLog.entity';
import { MessageType } from '../../messageType.enum';

export class QueryMessageLogsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  clientId?: string;

  @ApiPropertyOptional({
    description: "Matches against the client's first/last name",
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ enum: MessageType })
  @IsOptional()
  @IsEnum(MessageType)
  type?: MessageType;

  @ApiPropertyOptional({ enum: MessageLogStatus })
  @IsOptional()
  @IsEnum(MessageLogStatus)
  status?: MessageLogStatus;

  @ApiPropertyOptional({
    description:
      "'YYYY-MM-DD' — sentAt >= start of this calendar day in Bogotá " +
      '(UTC-5), not UTC midnight. See bogotaStartOfDayUtc() in ' +
      'dueDateSchedule.ts.',
  })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({
    description:
      "'YYYY-MM-DD' — sentAt <= end of this calendar day in Bogotá " +
      '(UTC-5), not UTC midnight. See bogotaEndOfDayUtc() in ' +
      'dueDateSchedule.ts.',
  })
  @IsOptional()
  @IsDateString()
  dateTo?: string;

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
