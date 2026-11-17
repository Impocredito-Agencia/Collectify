import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  isEmail,
  isPhoneNumber,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

import { normalizePhoneNumber } from '../../clients/normalizePhoneNumber';
import { BrevoChannel } from '../brevoTypes';

// `to` is an email or a phone depending on `channel` — a single conditional
// constraint, since stacking two @ValidateIf on one property skips it
// whenever either condition is false (i.e. always).
@ValidatorConstraint({ name: 'brevoRecipient' })
class BrevoRecipientConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    if (typeof value !== 'string') {
      return false;
    }
    const { channel } = args.object as SendBrevoTestDto;
    return channel === BrevoChannel.Sms
      ? isPhoneNumber(value, 'CO')
      : isEmail(value);
  }

  defaultMessage(args: ValidationArguments): string {
    const { channel } = args.object as SendBrevoTestDto;
    return channel === BrevoChannel.Sms
      ? 'to must be a valid Colombian phone number'
      : 'to must be a valid email';
  }
}

export class SendBrevoTestDto {
  @ApiProperty({ enum: BrevoChannel, example: BrevoChannel.Email })
  @IsEnum(BrevoChannel)
  channel!: BrevoChannel;

  @ApiProperty({
    example: 'admin@example.com',
    description:
      'An email when channel is "email"; a Colombian phone (any common format, normalized to E.164) when channel is "sms".',
  })
  @Transform(({ value, obj }: { value: unknown; obj: SendBrevoTestDto }) =>
    obj.channel === BrevoChannel.Sms
      ? normalizePhoneNumber(value)
      : typeof value === 'string'
        ? value.trim().toLowerCase()
        : value,
  )
  @Validate(BrevoRecipientConstraint)
  to!: string;
}
