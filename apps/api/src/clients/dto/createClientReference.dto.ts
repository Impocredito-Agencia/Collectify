import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsNotEmpty, IsPhoneNumber, IsString } from 'class-validator';

import { ClientReferenceType } from '../entities/clientReference.entity';
import { normalizePhoneNumber } from '../normalizePhoneNumber';

export class CreateClientReferenceDto {
  @ApiProperty({ enum: ClientReferenceType })
  @IsEnum(ClientReferenceType)
  type!: ClientReferenceType;

  @ApiProperty({ example: 'Carlos Gómez' })
  @IsString()
  @IsNotEmpty()
  fullName!: string;

  @ApiProperty({ example: '+573001112233' })
  @Transform(({ value }) => normalizePhoneNumber(value))
  @IsPhoneNumber('CO')
  phoneNumber!: string;

  @ApiProperty({ example: 'Hermano' })
  @IsString()
  @IsNotEmpty()
  relationship!: string;
}
