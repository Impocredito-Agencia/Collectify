import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, Matches } from 'class-validator';

export class QueryClientBreakdownDto {
  @ApiProperty({
    example: '2026-10-02',
    description:
      'The day to value the installments at (YYYY-MM-DD, Bogotá calendar day). Today or earlier.',
  })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'date debe tener el formato YYYY-MM-DD.',
  })
  @IsDateString()
  date!: string;
}
