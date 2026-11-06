import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

// Phase 35 — body of DELETE /loans/:id. Both fields are mandatory: the
// panel's double confirmation, re-checked here so the rule can't be
// skipped by calling the api directly.
export class DeleteLoanDto {
  @ApiProperty({
    example: 'Pagaré de prueba',
    description:
      'Why the pagaré is being deleted. Stored on the loan, shown in its read-only view and in the audit log, and used as the void reason of every payment it had.',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty({ message: 'El motivo de la eliminación es obligatorio.' })
  @MaxLength(500)
  reason!: string;

  @ApiProperty({
    example: '#0800',
    description:
      "The pagaré's current number, typed by the admin to confirm. Compared ignoring surrounding spaces and a leading '#'.",
  })
  @IsString()
  @IsNotEmpty()
  confirmPromissoryNoteNumber!: string;
}
