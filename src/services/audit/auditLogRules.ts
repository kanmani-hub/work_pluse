/**
 * Admin → Audit Logs: pure rules (unit-tested).
 * audit_logs has no role column, so the actor role shown is the actor's CURRENT role from
 * employees.role_id → roles.name (trusted, from the database). No actor → "System".
 * An actor whose role cannot be read → "Unknown" (never guessed).
 * The date-range filter is applied to the table AND every summary counter.
 */
import { normalizeRole } from '../../lib/roles';
import { companyDateStr } from '../../utils/companyDate';

export type AuditRole = 'Admin' | 'HR' | 'Employee' | 'System' | 'Unknown';
export type AuditRange = 'Today' | 'Yesterday' | 'Last 7 Days' | 'Last 30 Days' | 'This Month' | string;

export function actorRole(log: any): AuditRole {
  if (!log?.actor_employee_id && !log?.employees) return 'System';
  const r = normalizeRole(log?.employees?.role?.name ?? null);
  if (r === 'ADMIN') return 'Admin';
  if (r === 'HR') return 'HR';
  if (r === 'EMPLOYEE') return 'Employee';
  return 'Unknown';
}

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Inclusive company-date range for a filter value. */
export function auditDateRange(range: AuditRange, today: string): { start: string; end: string } {
  switch (range) {
    case 'Today': return { start: today, end: today };
    case 'Yesterday': { const y = addDays(today, -1); return { start: y, end: y }; }
    case 'Last 7 Days': return { start: addDays(today, -6), end: today };
    case 'Last 30 Days': return { start: addDays(today, -29), end: today };
    case 'This Month':
    default: return { start: `${today.slice(0, 7)}-01`, end: today };
  }
}

export function inAuditRange(log: any, range: AuditRange, today: string): boolean {
  if (!log?.created_at) return false;
  const d = companyDateStr(log.created_at);
  const { start, end } = auditDateRange(range, today);
  return d >= start && d <= end;
}

/** Counters for the logs ALREADY filtered by date range. */
export function summarizeAuditLogs(logs: any[], today: string) {
  const list = logs || [];
  return {
    total: list.length,
    today: list.filter(l => l?.created_at && companyDateStr(l.created_at) === today).length,
    admin: list.filter(l => actorRole(l) === 'Admin').length,
    hr: list.filter(l => actorRole(l) === 'HR').length,
    security: list.filter(l => String(l?.module || '').toUpperCase() === 'SECURITY').length,
    critical: list.filter(l => String(l?.metadata?.severity || '').toLowerCase() === 'critical').length,
  };
}
