import { describe, expect, it } from 'vitest';

import { buildClientPayload } from '@/features/clients/buildClientPayload';

import type { ClientFormValues } from '@/features/clients/buildClientPayload';

const filled: ClientFormValues = {
  firstName: 'Juana',
  lastName: 'Pérez',
  documentNumber: '1234567890',
  phoneNumber: '+573001234567',
  creditLimit: 2000000,
  documentType: 'CC',
  dateOfBirth: '1998-04-12',
  gender: 'F',
  documentIssuePlace: ' Bogotá ',
  documentIssueDate: '2015-03-20',
  email: 'juana@example.com',
  alternatePhoneNumber: ' +573009876543 ',
  homeAddress: 'Cra 1 #2-3',
  workAddress: 'Av. 4 #5-6',
  city: 'Medellín',
  occupation: 'Comerciante',
  employerName: 'Almacén',
  monthlyIncome: 1800000,
  dataProcessingConsent: true,
};

const cleared: ClientFormValues = {
  ...filled,
  creditLimit: 0,
  documentType: '',
  dateOfBirth: '',
  gender: '',
  documentIssuePlace: '  ',
  documentIssueDate: '',
  email: '',
  alternatePhoneNumber: '',
  workAddress: '',
  city: '',
  occupation: '',
  employerName: '',
  monthlyIncome: 0,
};

const optionalKeys = [
  'creditLimit',
  'documentType',
  'dateOfBirth',
  'gender',
  'documentIssuePlace',
  'documentIssueDate',
  'email',
  'alternatePhoneNumber',
  'workAddress',
  'city',
  'occupation',
  'employerName',
  'monthlyIncome',
] as const;

describe('buildClientPayload', () => {
  it('sends filled optional fields trimmed', () => {
    const payload = buildClientPayload(filled, true);

    expect(payload.alternatePhoneNumber).toBe('+573009876543');
    expect(payload.documentIssuePlace).toBe('Bogotá');
    expect(payload.creditLimit).toBe(2000000);
  });

  it('sends null for cleared optional fields when editing, so the PATCH clears them', () => {
    const payload = buildClientPayload(cleared, true);

    for (const key of optionalKeys) {
      expect(payload[key]).toBeNull();
    }
    expect(payload.homeAddress).toBe('Cra 1 #2-3');
  });

  it('omits empty optional fields when creating', () => {
    const body = JSON.parse(
      JSON.stringify(buildClientPayload(cleared, false)),
    ) as Record<string, unknown>;

    for (const key of optionalKeys) {
      expect(body).not.toHaveProperty(key);
    }
  });
});
