import { ApiProperty } from '@nestjs/swagger';
import { IsInt, NotEquals } from 'class-validator';

// Human request, 2026-09-25 — see LoansConfig's comment in
// config/configuration.ts. One flat amount added to every still-pending
// installment of a loan, booked entirely as capital (confirmed with the
// human over a separate fixed charge, knowing it means the payoff/
// refinance true-up sees the larger balance too).
export class AdjustPendingInstallmentsDto {
  @ApiProperty({
    example: 10000,
    description:
      'Whole pesos added to every pending installment (negative to lower them). Cannot be 0.',
  })
  @IsInt()
  @NotEquals(0)
  amountPerInstallment!: number;
}
