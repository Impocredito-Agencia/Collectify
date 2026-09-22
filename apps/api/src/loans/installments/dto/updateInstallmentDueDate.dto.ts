import { ApiProperty } from '@nestjs/swagger';
import { IsDateString } from 'class-validator';

// Human report, 2026-09-22 — an explicit, narrow exception to the "a
// loan's numbers are fixed at creation" rule (see UpdateLoanDto's own
// comment and docs/DATABASE.md's `interest_rate` "Resolved, 2026-09-04"
// note): this ONLY moves a single pending installment's collection date,
// never its amount, principal/interest split, or concept breakdown — see
// InstallmentsService.updateDueDate for the enforced rules (must still be
// Pending, must not cross an adjacent installment's own due date).
export class UpdateInstallmentDueDateDto {
  @ApiProperty({ example: '2026-08-10' })
  @IsDateString()
  dueDate!: string;
}
