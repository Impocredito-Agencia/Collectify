import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayUnique, IsArray, IsPhoneNumber } from 'class-validator';

import { normalizePhoneNumber } from '../normalizePhoneNumber';

// Human report, 2026-09-23 — the full set of this client's numbers that
// must not receive automated WhatsApp messages. Replaces the previous
// set wholesale (an empty array turns every number back on). Each one
// must be the client's primary/alternate number or an active loan's
// third-party contact — see ClientsService.setMutedPhoneNumbers.
export class SetClientMutedPhoneNumbersDto {
  @ApiProperty({
    type: [String],
    example: ['+573001234567'],
    description:
      "Numbers to stop automated messages to. Any format; normalized to E.164. Must belong to this client (primary, alternate) or to one of their active loans' third-party contact.",
  })
  @Transform(({ value }: { value: unknown }) =>
    Array.isArray(value)
      ? value.map((item) => normalizePhoneNumber(item))
      : value,
  )
  @IsArray()
  @ArrayUnique()
  @IsPhoneNumber('CO', { each: true })
  phoneNumbers!: string[];
}
