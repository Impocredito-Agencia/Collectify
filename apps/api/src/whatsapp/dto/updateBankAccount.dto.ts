import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

import { BANK_ACCOUNT_MAX_LENGTH } from '../bankAccountTemplate';

export class UpdateBankAccountDto {
  @ApiProperty({
    example:
      'Cuenta de Ahorros Bancolombia No. 123123-5235-23535 / Alejandro Martinez',
    description:
      'Sent as {{1}} of the cuenta_bancaria template. Flattened to a single line server-side.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(BANK_ACCOUNT_MAX_LENGTH)
  bankAccount!: string;
}
