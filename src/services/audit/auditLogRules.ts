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
/** The conditions behind each summary counter (shared by the counters and their detail views). */
export const AUDIT_CARD_FILTERS = {
  total: (_l: any, _today: string) => true,
  today: (l: any, today: string) => !!l?.created_at && companyDateStr(l.created_at) === today,
  admin: (l: any) => actorRole(l) === 'Admin',
  hr: (l: any) => actorRole(l) === 'HR',
  security: (l: any) => String(l?.module || '').toUpperCase() === 'SECURITY',
  critical: (l: any) => String(l?.metadata?.severity || '').toLowerCase() === 'critical',
};
export type AuditCard = keyof typeof AUDIT_CARD_FILTERS;

export function summarizeAuditLogs(logs: any[], today: string) {
  const list = logs || [];
  const n = (k: AuditCard) => list.filter(l => AUDIT_CARD_FILTERS[k](l, today)).length;
  return { total: n('total'), today: n('today'), admin: n('admin'), hr: n('hr'), security: n('security'), critical: n('critical') };
}

/** Log entries behind one summary counter, as display rows (read-only). */
export function auditCardRows(logs: any[], today: string, card: AuditCard): Record<string, any>[] {
  return (logs || []).filter(l => AUDIT_CARD_FILTERS[card](l, today)).map(l => ({
    __key: l.id,
    when: l.created_at ? new Date(l.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—',
    actor: l.employees ? `${l.employees.first_name || ''} ${l.employees.last_name || ''}`.trim() : 'System',
    role: actorRole(l), module: l.module || '—', action: l.action || '—', description: l.description || '—',
    severity: l.metadata?.severity || l.severity || '—', result: l.result || '—',
  }));
}
