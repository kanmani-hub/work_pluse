/**
 * Pure authorization + deletion rules shared by the create-employee and delete-employee edge functions.
 * No Deno / npm imports, so the same file is unit-tested with Vitest
 * (supabase/functions/_shared/employeeAdminRules.test.ts).
 *
 * Security rules (bug report C1, C3, R2):
 *  - A caller's role comes ONLY from their own profile row (never from an email match).
 *  - The profile must be active and the linked employee must be ACTIVE.
 *  - Only an ADMIN may create or delete employees.
 *  - Nobody may delete themself or another ADMIN.
 *  - An employee with any history is never deleted: they must be deactivated instead.
 */

export type CallerProfile = {
  auth_user_id?: string | null;
  employee_id?: string | null;
  is_active?: boolean | null;
  roles?: { name?: string | null } | { name?: string | null }[] | null;
  employees?: { status?: string | null } | { status?: string | null }[] | null;
} | null | undefined;

const one = <T>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

/** Canonical role of an authenticated caller, or null when the account must not act. */
export function resolveCallerRole(profile: CallerProfile): 'ADMIN' | 'HR' | 'EMPLOYEE' | null {
  if (!profile || profile.is_active !== true) return null;
  const employee = one(profile.employees);
  if (profile.employee_id && String(employee?.status ?? '').toUpperCase() !== 'ACTIVE') return null;
  const name = String(one(profile.roles)?.name ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
  if (name === 'ADMIN' || name === 'SYSTEM ADMIN') return 'ADMIN';
  if (name === 'HR' || name === 'HR MANAGER' || name === 'HR/STAFF') return 'HR';
  if (name === 'EMPLOYEE') return 'EMPLOYEE';
  return null;
}

/**
 * Tables whose rows are employee history. Their foreign keys are ON DELETE RESTRICT, and payroll /
 * audit data must be kept, so any row here blocks deletion. `optional` tables may not exist in every
 * environment (overtime_requests is created outside the migrations).
 */
export const HISTORY_TABLES: ReadonlyArray<{ table: string; column: string; optional?: boolean }> = [
  { table: 'attendance', column: 'employee_id' },
  { table: 'attendance_breaks', column: 'employee_id' },
  { table: 'attendance_events', column: 'employee_id' },
  { table: 'leave_requests', column: 'employee_id' },
  { table: 'leave_balances', column: 'employee_id' },
  { table: 'wfh_requests', column: 'employee_id' },
  { table: 'permission_requests', column: 'employee_id' },
  { table: 'overtime_requests', column: 'employee_id', optional: true },
  { table: 'salary_structures', column: 'employee_id' },
  { table: 'payroll', column: 'employee_id' },
  { table: 'payslips', column: 'employee_id' },
  { table: 'payroll_payments', column: 'paid_by' },
  { table: 'shift_assignments', column: 'employee_id' },
  { table: 'roster_assignments', column: 'employee_id' },
  { table: 'face_registrations', column: 'employee_id' },
  { table: 'face_verification_events', column: 'employee_id' },
  { table: 'location_verification_events', column: 'employee_id' },
  { table: 'audit_logs', column: 'actor_employee_id' },
];

export type DeletionDecision =
  | { allowed: true }
  | { allowed: false; status: 401 | 403 | 404 | 409; code: string; message: string };

export function decideEmployeeDeletion(input: {
  callerRole: ReturnType<typeof resolveCallerRole>;
  callerEmployeeId: string | null | undefined;
  callerAuthUserId: string | null | undefined;
  targetEmployeeId: string;
  target: { exists: boolean; isAdmin: boolean; authUserId?: string | null };
  historyTables: string[];
}): DeletionDecision {
  const { callerRole, callerEmployeeId, callerAuthUserId, targetEmployeeId, target, historyTables } = input;
  if (callerRole !== 'ADMIN') {
    return { allowed: false, status: 403, code: 'FORBIDDEN', message: 'Only an administrator can delete employees.' };
  }
  if (!target.exists) {
    return { allowed: false, status: 404, code: 'NOT_FOUND', message: 'Employee not found.' };
  }
  if ((callerEmployeeId && callerEmployeeId === targetEmployeeId) || (callerAuthUserId && target.authUserId && callerAuthUserId === target.authUserId)) {
    return { allowed: false, status: 409, code: 'SELF_DELETE', message: 'You cannot delete your own account.' };
  }
  if (target.isAdmin) {
    return { allowed: false, status: 409, code: 'ADMIN_TARGET', message: 'Administrator accounts cannot be deleted. Change their role first.' };
  }
  if (historyTables.length > 0) {
    return {
      allowed: false,
      status: 409,
      code: 'HAS_HISTORY',
      message: `This employee has records (${historyTables.join(', ')}). Deleting would destroy payroll and audit history, so deactivate the employee instead.`,
    };
  }
  return { allowed: true };
}

/** Minimal result shape of a supabase-js query (so the flow can be tested with fakes). */
export type DbResult<T = unknown> = { data: T | null; error: { message: string; code?: string } | null; count?: number | null };

export interface DeletionPorts {
  /** Caller's own profile with roles(name) and employees(status), read with the CALLER's token. */
  loadCallerProfile(authUserId: string): Promise<DbResult<CallerProfile & object>>;
  loadTargetEmployee(employeeId: string): Promise<DbResult<{ id: string; role_id: string | null; roles?: { name?: string | null } | null }>>;
  loadTargetProfile(employeeId: string): Promise<DbResult<{ id: string; auth_user_id: string | null; role_id: string | null; is_active: boolean | null; roles?: { name?: string | null } | null }>>;
  countRows(table: string, column: string, employeeId: string): Promise<DbResult>;
  deleteProfile(profileId: string): Promise<DbResult>;
  restoreProfile(profile: { id: string; auth_user_id: string | null; employee_id: string; role_id: string | null; is_active: boolean | null }): Promise<DbResult>;
  deleteEmployee(employeeId: string): Promise<DbResult>;
  deleteAuthUser(authUserId: string): Promise<DbResult>;
}

export type DeletionOutcome = { status: number; body: { success: boolean; code?: string; error?: string; warning?: string } };

const isMissingTable = (e: { code?: string; message: string } | null) =>
  !!e && (e.code === '42P01' || e.code === 'PGRST205' || /does not exist|could not find the table/i.test(e.message));

const isAdminRoleName = (n: unknown) => ['ADMIN', 'SYSTEM ADMIN'].includes(String(n ?? '').trim().toUpperCase());

/**
 * The whole delete-employee flow. Every database result is checked; nothing is deleted unless all
 * checks pass; if the employee row cannot be removed the profile is restored.
 */
export async function runEmployeeDeletion(ports: DeletionPorts, callerAuthUserId: string, employeeId: unknown): Promise<DeletionOutcome> {
  const fail = (status: number, code: string, error: string): DeletionOutcome => ({ status, body: { success: false, code, error } });

  if (typeof employeeId !== 'string' || !/^[0-9a-f-]{36}$/i.test(employeeId)) {
    return fail(400, 'BAD_REQUEST', 'A valid employee ID is required.');
  }

  const caller = await ports.loadCallerProfile(callerAuthUserId);
  if (caller.error) return fail(500, 'LOOKUP_FAILED', 'Could not verify your permissions.');
  const callerRole = resolveCallerRole(caller.data);
  if (callerRole !== 'ADMIN') return fail(403, 'FORBIDDEN', 'Only an administrator can delete employees.');

  const emp = await ports.loadTargetEmployee(employeeId);
  if (emp.error) return fail(500, 'LOOKUP_FAILED', 'Could not load the employee.');
  const prof = await ports.loadTargetProfile(employeeId);
  if (prof.error) return fail(500, 'LOOKUP_FAILED', 'Could not load the employee\'s account.');

  const history: string[] = [];
  if (emp.data) {
    for (const { table, column, optional } of HISTORY_TABLES) {
      const r = await ports.countRows(table, column, employeeId);
      if (r.error) {
        if (optional && isMissingTable(r.error)) continue;
        return fail(500, 'LOOKUP_FAILED', `Could not check ${table}; nothing was deleted.`);
      }
      if ((r.count ?? 0) > 0) history.push(table);
    }
  }

  const decision = decideEmployeeDeletion({
    callerRole,
    callerEmployeeId: (caller.data as any)?.employee_id ?? null,
    callerAuthUserId,
    targetEmployeeId: employeeId,
    target: {
      exists: !!emp.data,
      isAdmin: isAdminRoleName(emp.data?.roles?.name) || isAdminRoleName(prof.data?.roles?.name),
      authUserId: prof.data?.auth_user_id ?? null,
    },
    historyTables: history,
  });
  if (!decision.allowed) return fail(decision.status, decision.code, decision.message);

  // 1. profile (FK RESTRICT on employees, so it goes first)
  if (prof.data) {
    const d = await ports.deleteProfile(prof.data.id);
    if (d.error) return fail(500, 'DELETE_FAILED', 'Could not remove the employee\'s account; nothing was deleted.');
  }
  // 2. employee row — on failure, put the profile back
  const e = await ports.deleteEmployee(employeeId);
  if (e.error) {
    if (prof.data) {
      const r = await ports.restoreProfile({ ...prof.data, employee_id: employeeId });
      if (r.error) return fail(500, 'PARTIAL_FAILURE', 'Deletion failed and the account could not be restored automatically. Contact support.');
    }
    return fail(500, 'DELETE_FAILED', 'Could not delete the employee; nothing was changed.');
  }
  // 3. login account, by the stored id (never by paging listUsers())
  if (prof.data?.auth_user_id) {
    const a = await ports.deleteAuthUser(prof.data.auth_user_id);
    if (a.error) {
      return { status: 200, body: { success: true, warning: 'Employee deleted, but their login account could not be removed. It has no profile, so it cannot use the app; remove it in Supabase Auth.' } };
    }
  }
  return { status: 200, body: { success: true } };
}
