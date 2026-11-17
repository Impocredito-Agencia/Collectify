import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { SendBrevoTestDto } from './sendBrevoTest.dto';

function validate(body: Record<string, unknown>) {
  const dto = plainToInstance(SendBrevoTestDto, body);
  return { dto, errors: validateSync(dto) };
}

describe('SendBrevoTestDto', () => {
  it('accepts and normalizes an email', () => {
    const { dto, errors } = validate({
      channel: 'email',
      to: ' Admin@Example.com ',
    });
    expect(errors).toHaveLength(0);
    expect(dto.to).toBe('admin@example.com');
  });

  it('accepts a local Colombian phone and normalizes it to E.164', () => {
    const { dto, errors } = validate({ channel: 'sms', to: '300 123 4567' });
    expect(errors).toHaveLength(0);
    expect(dto.to).toBe('+573001234567');
  });

  it('rejects a phone on the email channel', () => {
    expect(
      validate({ channel: 'email', to: '3001234567' }).errors,
    ).toHaveLength(1);
  });

  it('rejects an email on the SMS channel', () => {
    expect(
      validate({ channel: 'sms', to: 'admin@example.com' }).errors,
    ).toHaveLength(1);
  });

  it('rejects an unknown channel', () => {
    expect(
      validate({ channel: 'fax', to: 'admin@example.com' }).errors.length,
    ).toBeGreaterThan(0);
  });
});
