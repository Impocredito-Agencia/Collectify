import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

export class QueryWhatsappConversationsDto {
  @ApiPropertyOptional({
    description: "Matches against the matched client's first/last name",
  })
  @IsOptional()
  @IsString()
  search?: string;

  // Human report, 2026-09-14 — backs the "Esperando asesor" tab: it needs
  // the exact conversation summary for every PENDING ticket's client,
  // regardless of how long ago they last messaged, since a client who's
  // been quiet while their ticket sits unresolved must never fall off a
  // recency-paginated page. Ignores search/page/limit when set — the
  // caller already knows exactly which clients it wants (from
  // GET /whatsapp/tickets, itself unpaginated and low-volume by design).
  @ApiPropertyOptional({
    type: [String],
    description:
      "Return exactly these clients' conversation summaries, ignoring search/page/limit — used for the pending-tickets queue, not general browsing.",
  })
  @IsOptional()
  @IsArray()
  @Transform(({ value }: { value: unknown }): unknown[] =>
    Array.isArray(value) ? value : [value],
  )
  @IsUUID('4', { each: true })
  clientIds?: string[];

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
