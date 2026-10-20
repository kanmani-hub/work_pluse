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
/** Inclusive company-date range for a filter value. */
export function auditDateRange(range: AuditRange, today: string): { start: string; end: string } {
  switch (range) {
    case 'Today': return { start: today, end: today };
    case 'Yesterday': { const y = addDays(today, -1); return { start: y, end: y }; }
    case 'Last 7 Days': return { start: addDays(today, -6), end: today };
    case 'Last 30 Days': return { start: addDays(today, -29), end: today };
    case 'All Time':
    case 'All': return { start: '1970-01-01', end: '2099-12-31' };
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

export interface AuditFilters {
  dateRange: string;
  employee: string;
  role: string;
  module: string;
  action: string;
  severity: string;
  result: string;
  search: string;
}

export const DEFAULT_AUDIT_FILTERS: AuditFilters = {
  dateRange: 'This Month',
  employee: 'All',
  role: 'All',
  module: 'All',
  action: 'All',
  severity: 'All',
  result: 'All',
  search: '',
};

/**
 * Case-insensitive search across all available audit log fields:
 * - Employee name (actor / target)
 * - Employee ID / Employee Code
 * - Action
 * - Module
 * - Description
 * - Actor
 * - Event ID (UUID)
 * - Entity ID
 * - Result & Severity
 * - IP Address & Source
 * - Metadata
 */
export function matchesAuditSearch(log: any, query: string): boolean {
  if (!query) return true;
  const q = query.trim().toLowerCase();
  if (!q) return true;

  // 1. Event ID (full UUID or prefix/substring)
  if (log.id && String(log.id).toLowerCase().includes(q)) return true;

  // 2. Action
  if (log.action && String(log.action).toLowerCase().includes(q)) return true;

  // 3. Module
  if (log.module && String(log.module).toLowerCase().includes(q)) return true;

  // 4. Description
  if (log.description && String(log.description).toLowerCase().includes(q)) return true;

  // 5. Actor Name
  const actorFirst = log.employees?.first_name || '';
  const actorLast = log.employees?.last_name || '';
  const fullName = `${actorFirst} ${actorLast}`.trim();
  if (fullName.toLowerCase().includes(q)) return true;
  if (actorFirst.toLowerCase().includes(q) || actorLast.toLowerCase().includes(q)) return true;

  // If no actor record, actor is 'System'
  if (!log.employees && !log.actor_employee_id && 'system'.includes(q)) return true;

  // 6. Actor Role
  const role = actorRole(log);
  if (role.toLowerCase().includes(q)) return true;

  // 7. Employee Code / ID
  if (log.employees?.employee_code && String(log.employees.employee_code).toLowerCase().includes(q)) return true;
  if (log.actor_employee_id && String(log.actor_employee_id).toLowerCase().includes(q)) return true;
  if (log.entity_id && String(log.entity_id).toLowerCase().includes(q)) return true;

  // 8. Severity & Result
  const severity = String(log.severity || log.metadata?.severity || '');
  if (severity.toLowerCase().includes(q)) return true;
  const result = String(log.result || log.metadata?.result || '');
  if (result.toLowerCase().includes(q)) return true;

  // 9. Source & IP
  if (log.source && String(log.source).toLowerCase().includes(q)) return true;
  if (log.ip_address && String(log.ip_address).toLowerCase().includes(q)) return true;

  // 10. Metadata values
  if (log.metadata && typeof log.metadata === 'object') {
    try {
      const metaStr = JSON.stringify(log.metadata).toLowerCase();
      if (metaStr.includes(q)) return true;
    } catch {
      // ignore serialization errors
    }
  }

  return false;
}

/** Matches module filter with alias tolerance (e.g. AUTH <-> AUTHENTICATION, EMPLOYEE <-> EMPLOYEES) */
export function matchModuleFilter(logModule: string | undefined, filterModule: string): boolean {
  if (!filterModule || filterModule === 'All') return true;
  if (!logModule) return false;

  const logMod = logModule.trim().toUpperCase();
  const filterMod = filterModule.trim().toUpperCase();

  if (logMod === filterMod) return true;

  if ((filterMod === 'AUTHENTICATION' || filterMod === 'AUTH') && (logMod === 'AUTH' || logMod === 'AUTHENTICATION')) return true;
  if ((filterMod === 'EMPLOYEES' || filterMod === 'EMPLOYEE') && (logMod === 'EMPLOYEE' || logMod === 'EMPLOYEES')) return true;
  if ((filterMod === 'SETTINGS' || filterMod === 'SETTING') && (logMod === 'SETTINGS' || logMod === 'SETTING')) return true;
  if ((filterMod === 'REPORTS' || filterMod === 'REPORT') && (logMod === 'REPORTS' || logMod === 'REPORT')) return true;

  return false;
}

export function matchSeverityFilter(logSeverity: string | undefined, filterSeverity: string): boolean {
  if (!filterSeverity || filterSeverity === 'All') return true;
  if (!logSeverity) return false;
  return logSeverity.trim().toLowerCase() === filterSeverity.trim().toLowerCase();
}

export function matchResultFilter(logResult: string | undefined, filterResult: string): boolean {
  if (!filterResult || filterResult === 'All') return true;
  if (!logResult) return false;
  const r = logResult.trim().toUpperCase();
  const f = filterResult.trim().toUpperCase();
  if (r === f) return true;
  if ((f === 'FAILED' || f === 'FAILURE') && (r === 'FAILED' || r === 'FAILURE')) return true;
  if (f === 'SUCCESS' && r === 'SUCCESS') return true;
  return false;
}

export function matchEmployeeFilter(log: any, filterEmployee: string): boolean {
  if (!filterEmployee || filterEmployee === 'All') return true;
  const filterVal = filterEmployee.trim().toLowerCase();

  if (filterVal === 'system') {
    return !log.actor_employee_id && !log.employees;
  }

  if (log.actor_employee_id && log.actor_employee_id.toLowerCase() === filterVal) return true;
  if (log.employees?.employee_code && log.employees.employee_code.toLowerCase() === filterVal) return true;

  const fullName = `${log.employees?.first_name || ''} ${log.employees?.last_name || ''}`.trim().toLowerCase();
  if (fullName && fullName === filterVal) return true;

  if (log.metadata?.target_employee_id && String(log.metadata.target_employee_id).toLowerCase() === filterVal) return true;
  if (log.metadata?.employee_code && String(log.metadata.employee_code).toLowerCase() === filterVal) return true;

  return false;
}

/** Comprehensive audit log filter combining date range, search, and all dropdown criteria */
export function filterAuditLogs(logs: any[], filters: AuditFilters, today: string): any[] {
  if (!logs || !Array.isArray(logs)) return [];

  return logs.filter(log => {
    // 1. Date Range
    if (filters.dateRange && !inAuditRange(log, filters.dateRange, today)) {
      return false;
    }

    // 2. Role
    if (filters.role && filters.role !== 'All') {
      const role = actorRole(log);
      if (role.toLowerCase() !== filters.role.trim().toLowerCase()) {
        return false;
      }
    }

    // 3. Module
    if (!matchModuleFilter(log.module, filters.module)) {
      return false;
    }

    // 4. Action
    if (filters.action && filters.action !== 'All') {
      if (String(log.action || '').toUpperCase() !== filters.action.trim().toUpperCase()) {
        return false;
      }
    }

    // 5. Severity
    const logSev = log.severity || log.metadata?.severity;
    if (!matchSeverityFilter(logSev, filters.severity)) {
      return false;
    }

    // 6. Result
    const logRes = log.result || log.metadata?.result;
    if (!matchResultFilter(logRes, filters.result)) {
      return false;
    }

    // 7. Employee
    if (!matchEmployeeFilter(log, filters.employee)) {
      return false;
    }

    // 8. Search query
    if (filters.search && !matchesAuditSearch(log, filters.search)) {
      return false;
    }

    return true;
  });
}

export const AUDIT_EXPORT_COLUMNS = [
  { header: 'Event ID', key: 'id', width: 22 },
  { header: 'Timestamp', key: 'timestamp', width: 22 },
  { header: 'Actor', key: 'actor', width: 20 },
  { header: 'Employee Code', key: 'employee_code', width: 16 },
  { header: 'Role', key: 'role', width: 14 },
  { header: 'Module', key: 'module', width: 16 },
  { header: 'Action', key: 'action', width: 22 },
  { header: 'Severity', key: 'severity', width: 12 },
  { header: 'Status', key: 'result', width: 12 },
  { header: 'Description', key: 'description', width: 40 },
  { header: 'IP Address', key: 'ip_address', width: 16 },
];

export function formatAuditLogForExport(log: any): Record<string, any> {
  const actor = log.employees
    ? `${log.employees.first_name || ''} ${log.employees.last_name || ''}`.trim()
    : 'System';
  const role = actorRole(log);
  const employeeCode = log.employees?.employee_code || (log.actor_employee_id ? 'N/A' : 'System');
  const timestamp = log.created_at
    ? new Date(log.created_at).toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    : '—';

  return {
    id: log.id || '—',
    timestamp,
    actor,
    employee_code: employeeCode,
    role,
    module: log.module || '—',
    action: log.action || '—',
    severity: log.severity || log.metadata?.severity || 'Info',
    result: log.result || log.metadata?.result || 'Success',
    description: log.description || '—',
    ip_address: log.ip_address || '—',
  };
}

export function getAuditExportFilename(format: 'xlsx' | 'pdf' | 'csv', dateStr?: string): string {
  const d = dateStr || companyDateStr();
  return `workpulse_audit_logs_${d}.${format}`;
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
