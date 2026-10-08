/**
 * Canonical role mapping for WorkPulse HR.
 *
 * The source of truth is public.roles.name, which currently holds exactly
 * 'ADMIN', 'HR' and 'EMPLOYEE'. The database RLS policies check the same values via
 * public.get_auth_role() (e.g. payroll: get_auth_role() IN ('ADMIN', 'HR')).
 *
 * Every client-side role check must go through these helpers so the UI and the
 * database agree. Unknown role names resolve to null and are denied (fail closed).
 */

export const ROLES = {
  ADMIN: 'ADMIN',
  HR: 'HR',
  EMPLOYEE: 'EMPLOYEE',
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

/** Legacy / display spellings seen in the codebase, mapped to the canonical role. */
const ROLE_ALIASES: Record<string, Role> = {
  'ADMIN': ROLES.ADMIN,
  'SYSTEM ADMIN': ROLES.ADMIN,
  'HR': ROLES.HR,
  'HR MANAGER': ROLES.HR,
  'HR/STAFF': ROLES.HR,
  'EMPLOYEE': ROLES.EMPLOYEE,
};

/** Normalise any role name (any case/spacing) to the canonical role, or null if unknown. */
export function normalizeRole(name: string | null | undefined): Role | null {
  if (!name) return null;
  const key = name.trim().replace(/\s+/g, ' ').toUpperCase();
  return ROLE_ALIASES[key] ?? null;
}

/** Roles allowed into the /admin portal. */
export const ADMIN_PORTAL_ROLES: readonly Role[] = [ROLES.ADMIN, ROLES.HR];

/** Roles allowed to manage payroll for all employees. Mirrors RLS: get_auth_role() IN ('ADMIN', 'HR'). */
export const PAYROLL_MANAGER_ROLES: readonly Role[] = [ROLES.ADMIN, ROLES.HR];

/** Roles that receive admin/HR notifications. */
export const ADMIN_NOTIFICATION_ROLES: readonly Role[] = [ROLES.ADMIN, ROLES.HR];

export function hasRole(name: string | null | undefined, allowed: readonly Role[]): boolean {
  const role = normalizeRole(name);
  return role !== null && allowed.includes(role);
}

export const isAdminPortalRole = (name: string | null | undefined) => hasRole(name, ADMIN_PORTAL_ROLES);
export const canManagePayroll = (name: string | null | undefined) => hasRole(name, PAYROLL_MANAGER_ROLES);
