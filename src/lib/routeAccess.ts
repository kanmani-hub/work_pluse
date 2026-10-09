import { normalizeRole, isAdminPortalRole, ROLES } from './roles';

export type RouteAccessDecision = 'allow' | 'redirect-admin' | 'redirect-employee' | 'role-error';

/**
 * Route-guard decision for a signed-in user with a loaded profile.
 *
 * A redirect is only returned when it targets a portal the user's role IS allowed
 * into, so a guard can never redirect to itself (no endless redirect loop). A missing
 * or unknown role always yields 'role-error' (fail closed, show an error screen).
 */
export function decideRouteAccess(role: string | null | undefined, allowedRoles?: readonly string[]): RouteAccessDecision {
  const canonicalRole = normalizeRole(role);
  if (!canonicalRole) return 'role-error';
  if (!allowedRoles || allowedRoles.length === 0) return 'allow';

  const canonicalAllowed = allowedRoles.map(r => normalizeRole(r));
  if (canonicalAllowed.includes(canonicalRole)) return 'allow';

  if (isAdminPortalRole(canonicalRole)) return 'redirect-admin';
  if (canonicalRole === ROLES.EMPLOYEE) return 'redirect-employee';
  return 'role-error';
}
