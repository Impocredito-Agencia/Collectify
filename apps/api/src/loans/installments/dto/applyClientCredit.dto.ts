import { ApiProperty } from '@nestjs/swagger';
import { IsPositive, IsUUID } from 'class-validator';

// Human report, 2026-09-14 — see InstallmentsService.applyCreditToInstallment.
// clientId is required in the body (not inferred from the installment
// alone) so ClientCreditBalanceService.assertCanApply can confirm the
// target installment actually belongs to the client whose credit is being
// spent, not just any installment the caller happens to name.
export class ApplyClientCreditDto {
  @ApiProperty()
  @IsUUID()
  clientId!: string;

  @ApiProperty({ example: 50000 })
  @IsPositive()
  amount!: number;
}
