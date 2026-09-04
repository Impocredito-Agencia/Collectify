import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class QueryClientsDto {
  @ApiPropertyOptional({
    description: 'Matches against name, document number, or phone',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    description:
      "true for active clients (default), false for soft-deleted ones, 'all' for both",
    default: true,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'all' ? 'all' : value !== 'false',
  )
  @IsIn([true, false, 'all'])
  isActive?: boolean | 'all';

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}
