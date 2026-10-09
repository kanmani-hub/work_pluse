import { describe, it, expect } from 'vitest';
import { authEventAction } from './authEvents';

describe('authEventAction', () => {
  it('tab focus / app resume (SIGNED_IN for the same user) does not reload', () => {
    expect(authEventAction('SIGNED_IN', 'u1', 'u1')).toBe('session-only');
  });

  it('token refresh for the same user is background only', () => {
    expect(authEventAction('TOKEN_REFRESHED', 'u1', 'u1')).toBe('session-only');
  });

  it('a real login (no user loaded yet, or a different user) does a full reload', () => {
    expect(authEventAction('SIGNED_IN', null, 'u1')).toBe('full-reload');
    expect(authEventAction('SIGNED_IN', 'u1', 'u2')).toBe('full-reload');
  });

  it('password/metadata change updates the user without reloading', () => {
    expect(authEventAction('USER_UPDATED', 'u1', 'u1')).toBe('user-updated');
  });

  it('logout and password recovery are passed through', () => {
    expect(authEventAction('SIGNED_OUT', 'u1', null)).toBe('signed-out');
    expect(authEventAction('PASSWORD_RECOVERY', null, 'u1')).toBe('password-recovery');
  });

  it('INITIAL_SESSION and events without a session are ignored', () => {
    expect(authEventAction('INITIAL_SESSION', null, 'u1')).toBe('ignore');
    expect(authEventAction('SIGNED_IN', 'u1', null)).toBe('ignore');
    expect(authEventAction('TOKEN_REFRESHED', 'u1', undefined)).toBe('ignore');
  });
});
