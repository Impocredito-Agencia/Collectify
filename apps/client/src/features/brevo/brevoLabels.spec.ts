import { describe, expect, it } from 'vitest';

import {
  BrevoChannel,
  BrevoSendFailureReason,
} from '@/features/brevo/brevoApi';
import {
  describeChannelState,
  describeSendFailure,
  formatPlanType,
  isLocalAddress,
} from '@/features/brevo/brevoLabels';

describe('describeChannelState', () => {
  it('reports "Sin configurar" before a pause', () => {
    const state = describeChannelState(BrevoChannel.Sms, {
      configured: false,
      sendingPaused: true,
      sender: null,
    });
    expect(state.label).toBe('Sin configurar');
    expect(state.description).toContain('remitente de SMS');
  });

  it('reports a configured but paused channel with its own variable', () => {
    const state = describeChannelState(BrevoChannel.Email, {
      configured: true,
      sendingPaused: true,
      sender: 'cobros@example.com',
    });
    expect(state).toMatchObject({ label: 'En pausa', tone: 'danger' });
    expect(state.description).toContain('BREVO_EMAIL_SENDING_PAUSED');
  });

  it('reports an active channel', () => {
    const state = describeChannelState(BrevoChannel.Sms, {
      configured: true,
      sendingPaused: false,
      sender: 'Collectify',
    });
    expect(state).toMatchObject({ label: 'Activo', tone: 'success' });
  });
});

describe('describeSendFailure', () => {
  it('explains a pause with the test list', () => {
    expect(
      describeSendFailure(BrevoSendFailureReason.Paused, BrevoChannel.Sms),
    ).toContain('BREVO_TEST_RECIPIENTS');
  });

  it('explains missing credits', () => {
    expect(
      describeSendFailure(
        BrevoSendFailureReason.InsufficientCredits,
        BrevoChannel.Sms,
      ),
    ).toContain('créditos');
  });

  it('falls back to a generic rejection', () => {
    expect(describeSendFailure(null, BrevoChannel.Email)).toBe(
      'Brevo rechazó el envío.',
    );
  });
});

describe('formatPlanType', () => {
  it('translates known plan types and keeps unknown ones', () => {
    expect(formatPlanType('free')).toBe('Gratuito');
    expect(formatPlanType('enterprise')).toBe('enterprise');
    expect(formatPlanType(null)).toBe('Desconocido');
  });
});

describe('isLocalAddress', () => {
  it('flags addresses Brevo cannot reach from the internet', () => {
    expect(isLocalAddress('http://localhost:3000/api/v1')).toBe(true);
    expect(isLocalAddress('http://127.0.0.1:3000/api/v1')).toBe(true);
    expect(isLocalAddress('http://192.168.1.20:3000/api/v1')).toBe(true);
    expect(isLocalAddress('http://172.20.0.5/api/v1')).toBe(true);
  });

  it('accepts a public address, and never throws on a bad one', () => {
    expect(isLocalAddress('https://api-production.up.railway.app/api/v1')).toBe(
      false,
    );
    expect(isLocalAddress('http://172.40.0.5/api/v1')).toBe(false);
    expect(isLocalAddress('not a url')).toBe(false);
  });
});
