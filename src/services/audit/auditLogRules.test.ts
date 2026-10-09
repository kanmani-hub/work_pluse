import { describe, it, expect } from 'vitest';
import { actorRole, auditDateRange, inAuditRange, summarizeAuditLogs } from './auditLogRules';

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
