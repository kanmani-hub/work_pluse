import { describe, it, expect } from 'vitest';
import { 
  actorRole, 
  auditDateRange, 
  inAuditRange, 
  summarizeAuditLogs,
  auditCardRows, 
  AUDIT_CARD_FILTERS,
  filterAuditLogs,
  matchesAuditSearch,
  matchModuleFilter,
  matchSeverityFilter,
  matchResultFilter,
  matchEmployeeFilter,
  DEFAULT_AUDIT_FILTERS,
  formatAuditLogForExport,
  getAuditExportFilename,
  AUDIT_EXPORT_COLUMNS
} from './auditLogRules';
import { formatCSVContent } from '../export/exportService';

const log = (created_at: string, role: string | null, extra: any = {}) => ({
  created_at, actor_employee_id: role === null ? null : 'a1',
  employees: role === null ? null : { first_name: 'P', last_name: '', role: role === '?' ? null : { name: role } }, module: 'AUTH', ...extra,
});

describe('audit actor role (from employees.role_id → roles.name, never guessed)', () => {
  it('maps database roles and system events', () => {
    expect(actorRole(log('2026-10-09T06:00:00Z', 'ADMIN'))).toBe('Admin');
    expect(actorRole(log('2026-10-09T06:00:00Z', 'HR'))).toBe('HR');
    expect(actorRole(log('2026-10-09T06:00:00Z', 'EMPLOYEE'))).toBe('Employee');
    expect(actorRole(log('2026-10-09T06:00:00Z', null))).toBe('System');
    expect(actorRole(log('2026-10-09T06:00:00Z', '?'))).toBe('Unknown');
    expect(actorRole({ actor_employee_id: 'gone', employees: null })).toBe('Unknown');
  });
});

describe('audit date range (company timezone) applied to table and counters', () => {
  const today = '2026-10-09';
  it('ranges', () => {
    expect(auditDateRange('Today', today)).toEqual({ start: today, end: today });
    expect(auditDateRange('Yesterday', today)).toEqual({ start: '2026-10-08', end: '2026-10-08' });
    expect(auditDateRange('Last 7 Days', today)).toEqual({ start: '2026-10-03', end: today });
    expect(auditDateRange('Last 30 Days', today)).toEqual({ start: '2026-09-10', end: today });
    expect(auditDateRange('This Month', today)).toEqual({ start: '2026-10-01', end: today });
  });
  it('uses the IST date of the event (00:30 IST on 9 Oct is "Today" though UTC says 8 Oct)', () => {
    expect(inAuditRange(log('2026-10-08T19:00:00Z', 'ADMIN'), 'Today', today)).toBe(true);
    expect(inAuditRange(log('2026-10-08T12:00:00Z', 'ADMIN'), 'Today', today)).toBe(false);
    expect(inAuditRange(log('2026-09-30T12:00:00Z', 'ADMIN'), 'This Month', today)).toBe(false);
  });
  it('counters come from the date-filtered events with real roles', () => {
    const logs = [
      log('2026-10-09T06:00:00Z', 'ADMIN'),
      log('2026-10-09T07:00:00Z', 'ADMIN', { module: 'SECURITY', metadata: { severity: 'CRITICAL' } }),
      log('2026-10-08T07:00:00Z', 'HR'),
      log('2026-10-07T07:00:00Z', null),
      log('2026-09-20T07:00:00Z', 'ADMIN'),
    ];
    const inRange = logs.filter(l => inAuditRange(l, 'This Month', today));
    expect(summarizeAuditLogs(inRange, today)).toEqual({ total: 4, today: 2, admin: 2, hr: 1, security: 1, critical: 1 });
    const y = logs.filter(l => inAuditRange(l, 'Yesterday', today));
    expect(summarizeAuditLogs(y, today)).toEqual({ total: 1, today: 0, admin: 0, hr: 1, security: 0, critical: 0 });
  });
});


describe('Audit summary cards → matching log entries', () => {
  const today = '2026-10-10';
  const logs = [
    { id: '1', created_at: '2026-10-10T04:00:00Z', module: 'SECURITY', action: 'LOGIN_FAILED', actor_employee_id: 'a', employees: { first_name: 'Ad', last_name: 'Min', role: { name: 'ADMIN' } }, metadata: { severity: 'Critical' } },
    { id: '2', created_at: '2026-10-09T20:00:00Z', module: 'PAYROLL', action: 'APPROVE', actor_employee_id: 'h', employees: { first_name: 'H', last_name: 'R', role: { name: 'HR' } }, metadata: {} },
    { id: '3', created_at: '2026-10-08T05:00:00Z', module: 'LEAVE', action: 'CREATE', metadata: {} },
  ];
  it('every counter equals the number of rows its detail view lists', () => {
    const s = summarizeAuditLogs(logs, today);
    for (const k of Object.keys(AUDIT_CARD_FILTERS) as (keyof typeof AUDIT_CARD_FILTERS)[]) expect(auditCardRows(logs, today, k).length).toBe((s as any)[k]);
  });
  it('today uses the IST date (20:00Z on 9 Oct is 01:30 IST on 10 Oct)', () => {
    expect(auditCardRows(logs, today, 'today').map(r => r.__key)).toEqual(['1', '2']);
  });
  it('rows carry actor, role, module, action and severity', () => {
    expect(auditCardRows(logs, today, 'critical')[0]).toMatchObject({ actor: 'Ad Min', role: 'Admin', module: 'SECURITY', action: 'LOGIN_FAILED', severity: 'Critical' });
    expect(auditCardRows(logs, today, 'total')[2].actor).toBe('System');
  });
});

describe('Audit search matching (comprehensive field mapping)', () => {
  const sampleLog = {
    id: 'e1000000-0000-0000-0000-000000000001',
    action: 'BREAK_STARTED',
    module: 'ATTENDANCE',
    description: 'Employee John Doe started a REGULAR break',
    created_at: '2026-10-10T10:00:00Z',
    actor_employee_id: 'a1000000-0000-0000-0000-000000000001',
    employees: {
      id: 'a1000000-0000-0000-0000-000000000001',
      first_name: 'John',
      last_name: 'Doe',
      employee_code: 'EMP001',
      role: { name: 'EMPLOYEE' },
    },
    ip_address: '192.168.1.100',
    source: 'WEB',
    metadata: {
      break_type: 'REGULAR',
      target_employee_code: 'EMP001',
      target_employee_id: 'a1000000-0000-0000-0000-000000000001',
    },
    old_values: { status: 'CLOCKED_IN' },
    new_values: { status: 'ON_BREAK' },
  };

  it('matches known action', () => {
    expect(matchesAuditSearch(sampleLog, 'BREAK_STARTED')).toBe(true);
    expect(matchesAuditSearch(sampleLog, 'break_started')).toBe(true);
    expect(matchesAuditSearch(sampleLog, 'BREAK')).toBe(true);
  });

  it('matches actor name and employee code', () => {
    expect(matchesAuditSearch(sampleLog, 'John')).toBe(true);
    expect(matchesAuditSearch(sampleLog, 'Doe')).toBe(true);
    expect(matchesAuditSearch(sampleLog, 'John Doe')).toBe(true);
    expect(matchesAuditSearch(sampleLog, 'EMP001')).toBe(true);
    expect(matchesAuditSearch(sampleLog, 'emp001')).toBe(true);
  });

  it('matches UUID or prefix', () => {
    expect(matchesAuditSearch(sampleLog, 'e1000000')).toBe(true);
    expect(matchesAuditSearch(sampleLog, 'a1000000')).toBe(true);
  });

  it('matches module, description, and source/IP', () => {
    expect(matchesAuditSearch(sampleLog, 'ATTENDANCE')).toBe(true);
    expect(matchesAuditSearch(sampleLog, 'regular break')).toBe(true);
    expect(matchesAuditSearch(sampleLog, '192.168.1')).toBe(true);
    expect(matchesAuditSearch(sampleLog, 'web')).toBe(true);
  });

  it('matches old/new values and metadata', () => {
    expect(matchesAuditSearch(sampleLog, 'CLOCKED_IN')).toBe(true);
    expect(matchesAuditSearch(sampleLog, 'ON_BREAK')).toBe(true);
  });

  it('matches default severity (Info) and result (Success) when unspecified in log', () => {
    expect(matchesAuditSearch(sampleLog, 'Info')).toBe(true);
    expect(matchesAuditSearch(sampleLog, 'Success')).toBe(true);
  });

  it('returns false for unrelated search query', () => {
    expect(matchesAuditSearch(sampleLog, 'NONEXISTENT_QUERY')).toBe(false);
  });

  it('matches System when no actor', () => {
    const sysLog = { id: 's1', action: 'CRON_SYNC', module: 'SYSTEM', actor_employee_id: null, employees: null };
    expect(matchesAuditSearch(sysLog, 'system')).toBe(true);
  });
});

describe('Module filter tolerance and aliases', () => {
  it('matches exact module', () => {
    expect(matchModuleFilter('ATTENDANCE', 'ATTENDANCE')).toBe(true);
    expect(matchModuleFilter('attendance', 'Attendance')).toBe(true);
    expect(matchModuleFilter('PAYROLL', 'PAYROLL')).toBe(true);
  });

  it('matches aliases', () => {
    expect(matchModuleFilter('AUTH', 'AUTHENTICATION')).toBe(true);
    expect(matchModuleFilter('AUTHENTICATION', 'AUTH')).toBe(true);
    expect(matchModuleFilter('ATTENDANCE_BREAKS', 'ATTENDANCE')).toBe(true);
    expect(matchModuleFilter('BREAKS', 'ATTENDANCE')).toBe(true);
    expect(matchModuleFilter('EMPLOYEE', 'EMPLOYEES')).toBe(true);
    expect(matchModuleFilter('EMPLOYEES', 'EMPLOYEE')).toBe(true);
    expect(matchModuleFilter('SETUP', 'SHIFTS')).toBe(true);
    expect(matchModuleFilter('SETUP', 'ROSTER')).toBe(true);
    expect(matchModuleFilter('OVERTIME', 'OT')).toBe(true);
    expect(matchModuleFilter('WFH', 'WORK_FROM_HOME')).toBe(true);
  });

  it('returns true when filter is All or empty', () => {
    expect(matchModuleFilter('ATTENDANCE', 'All')).toBe(true);
    expect(matchModuleFilter('ATTENDANCE', '')).toBe(true);
  });

  it('returns false for mismatched modules', () => {
    expect(matchModuleFilter('PAYROLL', 'ATTENDANCE')).toBe(false);
    expect(matchModuleFilter('AUTH', 'SECURITY')).toBe(false);
  });
});

describe('Severity and Result matching with defaults', () => {
  it('defaults undefined severity to Info', () => {
    expect(matchSeverityFilter(undefined, 'Info')).toBe(true);
    expect(matchSeverityFilter('', 'Info')).toBe(true);
    expect(matchSeverityFilter('Critical', 'Critical')).toBe(true);
    expect(matchSeverityFilter(undefined, 'Critical')).toBe(false);
  });

  it('defaults undefined result to Success', () => {
    expect(matchResultFilter(undefined, 'Success')).toBe(true);
    expect(matchResultFilter('', 'Success')).toBe(true);
    expect(matchResultFilter('Failed', 'Failed')).toBe(true);
    expect(matchResultFilter('FAILURE', 'Failed')).toBe(true);
    expect(matchResultFilter(undefined, 'Failed')).toBe(false);
  });
});

describe('Employee filter matching (actor, target, codes, system)', () => {
  const empLog = {
    id: 'log-1',
    actor_employee_id: 'emp-uuid-123',
    employees: {
      id: 'emp-uuid-123',
      first_name: 'Alice',
      last_name: 'Smith',
      employee_code: 'EMP-100',
    },
    metadata: {
      target_employee_id: 'emp-uuid-456',
      target_employee_code: 'EMP-200',
    },
  };

  it('matches by actor employee code', () => {
    expect(matchEmployeeFilter(empLog, 'EMP-100')).toBe(true);
    expect(matchEmployeeFilter(empLog, 'emp-100')).toBe(true);
  });

  it('matches by actor employee UUID', () => {
    expect(matchEmployeeFilter(empLog, 'emp-uuid-123')).toBe(true);
  });

  it('matches by actor name', () => {
    expect(matchEmployeeFilter(empLog, 'Alice Smith')).toBe(true);
    expect(matchEmployeeFilter(empLog, 'alice')).toBe(true);
  });

  it('matches target employee in metadata', () => {
    expect(matchEmployeeFilter(empLog, 'EMP-200')).toBe(true);
    expect(matchEmployeeFilter(empLog, 'emp-uuid-456')).toBe(true);
  });

  it('matches System when actor is absent', () => {
    const sysLog = { id: 's1', actor_employee_id: null, employees: null };
    expect(matchEmployeeFilter(sysLog, 'System')).toBe(true);
    expect(matchEmployeeFilter(empLog, 'System')).toBe(false);
  });

  it('returns true when filter is All', () => {
    expect(matchEmployeeFilter(empLog, 'All')).toBe(true);
  });

  it('returns false for unrelated employee', () => {
    expect(matchEmployeeFilter(empLog, 'EMP-999')).toBe(false);
  });
});

describe('Filter combinations, empty results, and clearing filters', () => {
  const today = '2026-10-10';
  const logs = [
    {
      id: '1',
      created_at: '2026-10-10T04:00:00Z',
      module: 'ATTENDANCE',
      action: 'BREAK_STARTED',
      actor_employee_id: 'emp-1',
      employees: { id: 'emp-1', first_name: 'Alice', last_name: 'Smith', employee_code: 'EMP001', role: { name: 'EMPLOYEE' } },
      severity: 'Info',
      result: 'Success',
      description: 'Break started',
    },
    {
      id: '2',
      created_at: '2026-10-10T05:00:00Z',
      module: 'PAYROLL',
      action: 'PAYROLL_APPROVED',
      actor_employee_id: 'admin-1',
      employees: { id: 'admin-1', first_name: 'Admin', last_name: 'User', employee_code: 'ADM001', role: { name: 'ADMIN' } },
      severity: 'High',
      result: 'Success',
      description: 'Payroll approved for EMP001',
      metadata: { target_employee_code: 'EMP001' },
    },
    {
      id: '3',
      created_at: '2026-10-09T08:00:00Z',
      module: 'SECURITY',
      action: 'LOGIN_FAILED',
      actor_employee_id: null,
      employees: null,
      severity: 'Critical',
      result: 'Failed',
      description: 'Repeated failed login attempt',
    },
  ];

  it('filter combination matching single row', () => {
    const filters = {
      dateRange: 'This Month',
      employee: 'EMP001',
      module: 'ATTENDANCE',
      role: 'Employee',
      action: 'All',
      severity: 'Info',
      result: 'Success',
      search: '',
    };
    const res = filterAuditLogs(logs, filters, today);
    expect(res.length).toBe(1);
    expect(res[0].id).toBe('1');
  });

  it('returns empty array when filter combination has no matches', () => {
    // EMP001 has no Security events
    const filters = {
      dateRange: 'This Month',
      employee: 'EMP001',
      module: 'SECURITY',
      role: 'All',
      action: 'All',
      severity: 'All',
      result: 'All',
      search: '',
    };
    const res = filterAuditLogs(logs, filters, today);
    expect(res).toEqual([]);
  });

  it('clearing filters restores all records in date range', () => {
    // 1. First run with restrictive filter returning empty
    const restrictiveFilters = {
      dateRange: 'This Month',
      employee: 'EMP001',
      module: 'SECURITY',
      role: 'All',
      action: 'All',
      severity: 'All',
      result: 'All',
      search: 'nonexistent',
    };
    expect(filterAuditLogs(logs, restrictiveFilters, today)).toEqual([]);

    // 2. Clear all filters to DEFAULT_AUDIT_FILTERS
    const clearedFilters = {
      ...DEFAULT_AUDIT_FILTERS,
      dateRange: 'This Month',
    };
    const restored = filterAuditLogs(logs, clearedFilters, today);
    expect(restored.length).toBe(3);
    expect(restored.map(r => r.id)).toEqual(['1', '2', '3']);
  });
});

describe('Audit export formatting and columns', () => {
  it('formatAuditLogForExport populates all AUDIT_EXPORT_COLUMNS', () => {
    const raw = {
      id: 'uuid-export-1',
      created_at: '2026-10-10T10:00:00Z',
      module: 'ATTENDANCE',
      action: 'CLOCK_IN',
      actor_employee_id: 'emp-1',
      employees: { first_name: 'Bob', last_name: 'Jones', employee_code: 'EMP-99', role: { name: 'EMPLOYEE' } },
      severity: 'Info',
      result: 'Success',
      description: 'Clocked in at Office A',
      ip_address: '10.0.0.1',
    };
    const formatted = formatAuditLogForExport(raw);
    expect(formatted.id).toBe('uuid-export-1');
    expect(formatted.actor).toBe('Bob Jones');
    expect(formatted.employee_code).toBe('EMP-99');
    expect(formatted.role).toBe('Employee');
    expect(formatted.module).toBe('ATTENDANCE');
    expect(formatted.action).toBe('CLOCK_IN');
    expect(formatted.severity).toBe('Info');
    expect(formatted.result).toBe('Success');
    expect(formatted.description).toBe('Clocked in at Office A');
    expect(formatted.ip_address).toBe('10.0.0.1');

    for (const col of AUDIT_EXPORT_COLUMNS) {
      expect(formatted).toHaveProperty(col.key);
    }
  });

  it('getAuditExportFilename formats correct filenames', () => {
    expect(getAuditExportFilename('xlsx', '2026-10-20')).toBe('workpulse_audit_logs_2026-10-20.xlsx');
    expect(getAuditExportFilename('pdf', '2026-10-20')).toBe('workpulse_audit_logs_2026-10-20.pdf');
    expect(getAuditExportFilename('csv', '2026-10-20')).toBe('workpulse_audit_logs_2026-10-20.csv');
  });

  it('formatCSVContent creates sanitized CSV with UTF-8 BOM', () => {
    const rows = [
      { id: '1', action: '=cmd|/c calc', description: '+Dangerous Formula', actor: 'Alice' },
    ];
    const columns = [
      { header: 'ID', key: 'id' },
      { header: 'Action', key: 'action' },
      { header: 'Description', key: 'description' },
      { header: 'Actor', key: 'actor' },
    ];
    const csv = formatCSVContent(rows, columns);
    // BOM prefix
    expect(csv.startsWith('\uFEFF')).toBe(true);
    // Formulas sanitized with prepended single quote
    expect(csv.includes("`'=cmd|/c calc`".replace(/`/g, ''))).toBe(true);
    expect(csv.includes("`'+Dangerous Formula`".replace(/`/g, ''))).toBe(true);
  });
});
