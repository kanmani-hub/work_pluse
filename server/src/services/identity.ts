import { getSupabase } from './supabase.js';

/**
 * Trusted identity for a verified Supabase auth user (security fix MS-1).
 *
 * The role and employee id come ONLY from the database (profiles -> roles, profiles.employee_id), the
 * same source the WorkPulse database itself uses (public.get_auth_role()). user_metadata is never read:
 * every signed-in user can change their own user_metadata with supabase.auth.updateUser().
 * An inactive profile, an inactive employee or a missing profile gives no identity (request is
 * treated as unauthenticated). Results are cached briefly in memory.
 */
export interface ResolvedIdentity {
  role: 'admin' | 'hr' | 'employee';
  employee_id: string;
}

const ROLE_MAP: Record<string, ResolvedIdentity['role']> = { ADMIN: 'admin', HR: 'hr', EMPLOYEE: 'employee' };
const TTL_MS = 60_000;
const cache = new Map<string, { at: number; value: ResolvedIdentity | null }>();

export function clearIdentityCache(): void {
  cache.clear();
}

export function mapProfileToIdentity(profile: any): ResolvedIdentity | null {
  if (!profile || profile.is_active !== true || !profile.employee_id) return null;
  const employee = Array.isArray(profile.employees) ? profile.employees[0] : profile.employees;
  if (!employee || String(employee.status || '').toUpperCase() !== 'ACTIVE') return null;
  const roleRow = Array.isArray(profile.roles) ? profile.roles[0] : profile.roles;
  const role = ROLE_MAP[String(roleRow?.name || '').toUpperCase()];
  if (!role) return null;
  return { role, employee_id: String(profile.employee_id) };
}

export async function resolveIdentity(authUserId: string): Promise<ResolvedIdentity | null> {
  const hit = cache.get(authUserId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const supabase = getSupabase();
  if (!supabase) return null;   // cannot verify roles without the server key: fail closed
  const { data, error } = await supabase
    .from('profiles')
    .select('employee_id, is_active, roles(name), employees(status)')
    .eq('auth_user_id', authUserId)
    .maybeSingle();
  if (error) throw new Error(`Identity lookup failed: ${error.message}`);   // not cached
  const value = mapProfileToIdentity(data);
  cache.set(authUserId, { at: Date.now(), value });
  return value;
}
