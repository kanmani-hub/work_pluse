/**
 * Decide what the app should do for each Supabase auth event.
 *
 * Supabase emits SIGNED_IN not only on a real login but also when the tab regains
 * focus / the app resumes, and TOKEN_REFRESHED roughly every hour. Treating those as
 * a fresh login showed the full-screen spinner, remounted every page and restarted
 * GPS tracking. Only a real change of user needs a full (blocking) reload.
 */

export type AuthEventAction =
  | 'full-reload'   // a different user signed in: load profile/role with the loading screen
  | 'session-only'  // same user: just keep the new session tokens in state, no reload
  | 'user-updated'  // same user, user record changed (password / metadata): update user + session
  | 'signed-out'
  | 'password-recovery'
  | 'ignore';

export function authEventAction(
  event: string,
  loadedUserId: string | null,
  sessionUserId: string | null | undefined,
): AuthEventAction {
  switch (event) {
    case 'SIGNED_OUT':
      return 'signed-out';
    case 'PASSWORD_RECOVERY':
      return 'password-recovery';
    case 'SIGNED_IN':
      if (!sessionUserId) return 'ignore';
      return sessionUserId === loadedUserId ? 'session-only' : 'full-reload';
    case 'TOKEN_REFRESHED':
      if (!sessionUserId) return 'ignore';
      return sessionUserId === loadedUserId ? 'session-only' : 'full-reload';
    case 'USER_UPDATED':
      if (!sessionUserId) return 'ignore';
      return sessionUserId === loadedUserId ? 'user-updated' : 'full-reload';
    default:
      // INITIAL_SESSION is handled by the initial load on mount; MFA events etc. need nothing.
      return 'ignore';
  }
}
