/**
 * Central, user-facing authentication messages for WorkPulse HR.
 *
 * Only these strings are ever shown to the user. Raw Supabase / database / SQL
 * errors are never displayed (they are logged to the console in development only).
 */

export type AuthAccountErrorCode = 'INACTIVE' | 'PROFILE_MISSING' | 'ROLE_MISSING';

export const AUTH_MESSAGES = {
  INVALID_CREDENTIALS: 'Invalid email/Employee ID or password.',
  INACTIVE: 'Your account is inactive. Please contact your administrator.',
  PROFILE_MISSING: 'Employee profile not found. Please contact your administrator.',
  ROLE_MISSING: 'Your account role is not configured. Please contact your administrator.',
  EMAIL_NOT_CONFIRMED: 'Your account has not been activated yet. Please contact your administrator.',
  RATE_LIMITED: 'Too many attempts. Please wait a few minutes and try again.',
  NETWORK: 'Unable to reach the server. Check your internet connection and try again.',
  GENERIC: 'Unable to sign in right now. Please try again.',
} as const;

export const accountErrorMessage = (code: AuthAccountErrorCode): string => AUTH_MESSAGES[code];

type AuthLikeError = { message?: string; status?: number; code?: string; name?: string } | null | undefined;

/** Map a Supabase sign-in error to a safe user-facing message. */
export function signInErrorMessage(err: AuthLikeError): string {
  if (!err) return AUTH_MESSAGES.GENERIC;
  const msg = (err.message || '').toLowerCase();
  const code = (err.code || '').toLowerCase();

  if (code === 'invalid_credentials' || msg.includes('invalid login credentials')) return AUTH_MESSAGES.INVALID_CREDENTIALS;
  if (code === 'email_not_confirmed' || msg.includes('email not confirmed')) return AUTH_MESSAGES.EMAIL_NOT_CONFIRMED;
  if (code === 'user_banned' || msg.includes('banned')) return AUTH_MESSAGES.INACTIVE;
  if (err.status === 429 || code.includes('rate_limit') || msg.includes('rate limit') || msg.includes('too many')) return AUTH_MESSAGES.RATE_LIMITED;
  if (err.name === 'AuthRetryableFetchError' || msg.includes('failed to fetch') || msg.includes('network')) return AUTH_MESSAGES.NETWORK;
  return AUTH_MESSAGES.GENERIC;
}

/** Employee IDs are stored upper-case (e.g. EMP001); accept any case / surrounding spaces. */
export const normalizeEmployeeCode = (input: string): string => input.trim().toUpperCase();

export const PASSWORD_MIN_LENGTH = 8;

export const PASSWORD_MESSAGES = {
  REQUIRED: 'Please fill in all password fields.',
  TOO_SHORT: `New password must be at least ${PASSWORD_MIN_LENGTH} characters long.`,
  MISMATCH: 'New password and confirmation do not match.',
  SAME_AS_CURRENT: 'New password must be different from your current password.',
  CURRENT_INCORRECT: 'Current password is incorrect.',
  WEAK: 'This password is too weak. Please choose a stronger password.',
  REAUTH: 'For security, please sign out, sign in again, and then change your password.',
  GENERIC: 'Unable to change your password right now. Please try again.',
  SUCCESS: 'Your password has been changed successfully.',
} as const;

/** Client-side validation for the change-password form. Returns an error message or null. */
export function validatePasswordChange(current: string, next: string, confirm: string): string | null {
  if (!current || !next || !confirm) return PASSWORD_MESSAGES.REQUIRED;
  if (next.length < PASSWORD_MIN_LENGTH) return PASSWORD_MESSAGES.TOO_SHORT;
  if (next !== confirm) return PASSWORD_MESSAGES.MISMATCH;
  if (next === current) return PASSWORD_MESSAGES.SAME_AS_CURRENT;
  return null;
}

/** Map a Supabase updateUser({ password }) error to a safe message. */
export function passwordUpdateErrorMessage(err: AuthLikeError): string {
  if (!err) return PASSWORD_MESSAGES.GENERIC;
  const msg = (err.message || '').toLowerCase();
  const code = (err.code || '').toLowerCase();
  if (code === 'same_password' || msg.includes('different from the old password')) return PASSWORD_MESSAGES.SAME_AS_CURRENT;
  if (code === 'weak_password' || msg.includes('weak') || msg.includes('password should')) return PASSWORD_MESSAGES.WEAK;
  if (code === 'reauthentication_needed' || msg.includes('reauthenticat')) return PASSWORD_MESSAGES.REAUTH;
  if (err.status === 429 || msg.includes('rate limit')) return AUTH_MESSAGES.RATE_LIMITED;
  if (err.name === 'AuthRetryableFetchError' || msg.includes('failed to fetch')) return AUTH_MESSAGES.NETWORK;
  return PASSWORD_MESSAGES.GENERIC;
}
