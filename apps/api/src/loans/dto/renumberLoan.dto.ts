import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches } from 'class-validator';

// Human request, 2026-10-21 — a pagaré created with the wrong number could
// only be fixed by deleting it, which is blocked as soon as it has a
// payment. Same #0000 format rule as CreateLoanDto.promissoryNoteNumber.
export class RenumberLoanDto {
  @ApiProperty({ example: '#1191' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^#\d{4,}$/, {
    message: 'El número de pagaré debe tener el formato #0000.',
  })
  promissoryNoteNumber!: string;
}
