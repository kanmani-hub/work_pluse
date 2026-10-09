import { describe, it, expect } from 'vitest';
import {
  AUTH_MESSAGES, PASSWORD_MESSAGES, signInErrorMessage, normalizeEmployeeCode,
  validatePasswordChange, passwordUpdateErrorMessage,
} from './authErrors';

describe('signInErrorMessage', () => {
  it('maps wrong password to the generic invalid-credentials message', () => {
    expect(signInErrorMessage({ message: 'Invalid login credentials', status: 400 })).toBe(AUTH_MESSAGES.INVALID_CREDENTIALS);
    expect(signInErrorMessage({ code: 'invalid_credentials' })).toBe(AUTH_MESSAGES.INVALID_CREDENTIALS);
  });
  it('maps banned users to inactive, rate limits and network errors', () => {
    expect(signInErrorMessage({ message: 'User is banned' })).toBe(AUTH_MESSAGES.INACTIVE);
    expect(signInErrorMessage({ status: 429, message: 'x' })).toBe(AUTH_MESSAGES.RATE_LIMITED);
    expect(signInErrorMessage({ name: 'AuthRetryableFetchError', message: 'Failed to fetch' })).toBe(AUTH_MESSAGES.NETWORK);
  });
  it('never leaks unknown/internal error text', () => {
    const out = signInErrorMessage({ message: 'relation "profiles" does not exist (SQLSTATE 42P01)' });
    expect(out).toBe(AUTH_MESSAGES.GENERIC);
    expect(out.includes('SQL')).toBe(false);
  });
});

describe('normalizeEmployeeCode', () => {
  it('treats EMP001, emp001, Emp001 and padded input the same', () => {
    for (const v of ['EMP001', 'emp001', 'Emp001', '  emp001 ']) expect(normalizeEmployeeCode(v)).toBe('EMP001');
  });
});

describe('validatePasswordChange', () => {
  it('requires all fields, min length 8, matching confirmation and a new value', () => {
    expect(validatePasswordChange('', 'abcdefgh', 'abcdefgh')).toBe(PASSWORD_MESSAGES.REQUIRED);
    expect(validatePasswordChange('old-pass1', 'short', 'short')).toBe(PASSWORD_MESSAGES.TOO_SHORT);
    expect(validatePasswordChange('old-pass1', 'abcdefgh', 'abcdefgX')).toBe(PASSWORD_MESSAGES.MISMATCH);
    expect(validatePasswordChange('abcdefgh', 'abcdefgh', 'abcdefgh')).toBe(PASSWORD_MESSAGES.SAME_AS_CURRENT);
    expect(validatePasswordChange('old-pass1', 'new-pass1', 'new-pass1')).toBe(null);
  });
  it('maps Supabase password errors to safe messages', () => {
    expect(passwordUpdateErrorMessage({ code: 'same_password' })).toBe(PASSWORD_MESSAGES.SAME_AS_CURRENT);
    expect(passwordUpdateErrorMessage({ code: 'weak_password' })).toBe(PASSWORD_MESSAGES.WEAK);
    expect(passwordUpdateErrorMessage({ code: 'reauthentication_needed' })).toBe(PASSWORD_MESSAGES.REAUTH);
    expect(passwordUpdateErrorMessage({ message: 'internal db failure' })).toBe(PASSWORD_MESSAGES.GENERIC);
  });
});
