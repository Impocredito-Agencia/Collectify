import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

export const CLIENT_SORT_COLUMNS = [
  'name',
  'documentNumber',
  'phoneNumber',
  'activeLoanCount',
  'maxOverdueDays',
] as const;
export type ClientSortColumn = (typeof CLIENT_SORT_COLUMNS)[number];

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

  @ApiPropertyOptional({
    enum: CLIENT_SORT_COLUMNS,
    description:
      'Column to order the WHOLE result by before paginating (default: ' +
      'name). Applied server-side so page 1 really holds the first rows of ' +
      'the entire list, not just of the page that happened to be loaded.',
  })
  @IsOptional()
  @IsIn(CLIENT_SORT_COLUMNS)
  sortBy?: ClientSortColumn;

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'asc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDirection?: 'asc' | 'desc';

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
