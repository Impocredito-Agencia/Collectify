import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Max, Min } from 'class-validator';

// Human report, 2026-09-22 — "algunas [cuotas] están el primero y la
// quieren, por ejemplo, que queden todas el 10". Bulk counterpart to
// UpdateInstallmentDueDateDto: moves every PENDING installment of a loan
// to the same day of the month, keeping each one's own year/month — see
// InstallmentsService.alignDueDay and dueDateSchedule.ts's withDayOfMonth.
export class AlignInstallmentDueDayDto {
  @ApiProperty({
    example: 10,
    description: 'Day of the month (1-31) every pending installment moves to.',
  })
  @IsInt()
  @Min(1)
  @Max(31)
  dayOfMonth!: number;
}
