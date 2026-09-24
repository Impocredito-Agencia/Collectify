import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

export class QueryAuditLogDto {
  @ApiPropertyOptional({
    description:
      'Free-text search, split on whitespace — EVERY word must match. A word ' +
      "matches an entry when it appears in the entry's label (client name/" +
      'cédula, pagaré number...) OR the entry is about a record related to ' +
      "a client/pagaré matching it: searching a client's name also returns " +
      'the audit entries of their loans, installments and payments, and ' +
      "searching a pagaré number also returns that loan's payments. " +
      'Example: "Juana 0928".',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  actorUserId?: string;

  @ApiPropertyOptional({
    description:
      "Exact match, e.g. 'client.create'. Naming convention: " +
      "'<entityType>.<verb>' — see docs/phases/PHASE_11_AUDIT_LOG.md.",
  })
  @IsOptional()
  @IsString()
  action?: string;

  @ApiPropertyOptional({
    description: "Exact match, e.g. 'client', 'loan', 'payment', 'user'.",
  })
  @IsOptional()
  @IsString()
  entityType?: string;

  @ApiPropertyOptional({
    description:
      "'YYYY-MM-DD' — createdAt >= start of this calendar day in Bogotá " +
      '(UTC-5), not UTC midnight. See bogotaStartOfDayUtc() in ' +
      'dueDateSchedule.ts.',
  })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({
    description:
      "'YYYY-MM-DD' — createdAt <= end of this calendar day in Bogotá " +
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
