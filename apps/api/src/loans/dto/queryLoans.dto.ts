import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

import { LoanStatus } from '../entities/loan.entity';

export const LOAN_SORT_COLUMNS = [
  'promissoryNoteNumber',
  'clientFullName',
  'outstandingBalance',
  'overdueDays',
  'status',
] as const;
export type LoanSortColumn = (typeof LOAN_SORT_COLUMNS)[number];

export class QueryLoansDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  clientId?: string;

  @ApiPropertyOptional({ enum: LoanStatus })
  @IsOptional()
  @IsEnum(LoanStatus)
  status?: LoanStatus;

  // Added for the standalone "Préstamos" list screen (F-16/17), which
  // searches by client — there was previously no text search on loans at
  // all, only an exact clientId filter. Matches ClientsService's search
  // pattern (ILIKE across the relevant text fields).
  @ApiPropertyOptional({
    description: "Matches against the client's name or promissory note number",
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    enum: LOAN_SORT_COLUMNS,
    description:
      'Column to order the WHOLE result by before paginating (default: ' +
      'promissoryNoteNumber). Applied server-side so page 1 really holds ' +
      'the first rows of the entire list, not just of the page that ' +
      'happened to be loaded. `status` orders by the label the list shows ' +
      '("Al día"/"En mora"/"Pagado"/"Refinanciado").',
  })
  @IsOptional()
  @IsIn(LOAN_SORT_COLUMNS)
  sortBy?: LoanSortColumn;

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

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}
