import { BrevoSendFailureReason } from './brevoTypes';

export interface BrevoErrorBody {
  code?: unknown;
  message?: unknown;
}

export interface MappedBrevoError {
  failureReason: BrevoSendFailureReason;
  errorMessage: string;
}

// Brevo answers errors with { code, message } and these statuses (see
// https://developers.brevo.com/docs/how-it-works): 401 bad key, 402 account
// needs activation or credits, 429 rate limit. Running out of credits has
// also been documented as a 400 with code "Insufficient credits", so the
// body is checked too, not only the status.
export function mapBrevoError(
  status: number,
  body: BrevoErrorBody | null,
): MappedBrevoError {
  const code = typeof body?.code === 'string' ? body.code : '';
  const message = typeof body?.message === 'string' ? body.message : '';
  const errorMessage = message || code || `Brevo responded with ${status}`;

  if (status === 401) {
    return {
      failureReason: BrevoSendFailureReason.InvalidApiKey,
      errorMessage,
    };
  }
  if (status === 402 || /credit/i.test(`${code} ${message}`)) {
    return {
      failureReason: BrevoSendFailureReason.InsufficientCredits,
      errorMessage,
    };
  }
  if (status === 429) {
    return { failureReason: BrevoSendFailureReason.RateLimited, errorMessage };
  }
  return { failureReason: BrevoSendFailureReason.Rejected, errorMessage };
}
