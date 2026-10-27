import { describe, it, expect } from 'vitest';
import { buildRequestReport, buildWorkingHours, workedMinutes } from './requestReportRules';

const emp = { first_name: 'Eli', last_name: 'Emp', employee_code: 'E1', departments: { name: 'Ops' } };

describe('report tabs computed from records (B-09)', () => {
  it('leave: counts by status and approved days from stored total_days', () => {
    const r = buildRequestReport('Leave', [
      { id: '1', employees: emp, start_date: '2026-10-01', end_date: '2026-10-02', total_days: 2, status: 'APPROVED', leave_types: { name: 'Casual' } },
      { id: '2', employees: emp, start_date: '2026-10-05', end_date: '2026-10-05', total_days: 0.5, is_half_day: true, half_day_type: 'SECOND_HALF', status: 'APPROVED', leave_types: { name: 'Sick' } },
      { id: '3', employees: emp, start_date: '2026-10-09', end_date: '2026-10-09', total_days: 1, status: 'REJECTED' },
    ]);
    expect(r.approvedAmount).toBe(2.5);
    expect(r.byStatus).toMatchObject({ APPROVED: 2, REJECTED: 1, PENDING: 0, CANCELLED: 0 });
    expect(r.rows[1]).toMatchObject({ date: '2026-10-05', detail: 'Sick (second half)', department: 'Ops' });
    expect(r.rows[0].date).toBe('2026-10-01 → 2026-10-02');
  });
  it('permission minutes and WFH days', () => {
    expect(buildRequestReport('Permission', [{ id: 'p', employees: emp, permission_date: '2026-10-03', start_time: '10:00:00', end_time: '11:30:00', duration_minutes: 90, status: 'APPROVED' }]).approvedAmount).toBe(90);
    const w = buildRequestReport('WFH', [{ id: 'w', employees: emp, request_date: '2026-10-04', status: 'APPROVED' }, { id: 'x', employees: null, request_date: '2026-10-05', status: 'PENDING' }]);
    expect(w.approvedAmount).toBe(1);
    expect(w.rows[1].employee).toBe('Unknown');
  });
  it('empty results', () => {
    expect(buildRequestReport('Leave', null)).toMatchObject({ rows: [], approvedAmount: 0 });
    expect(buildWorkingHours(undefined)).toEqual([]);
  });
  it('worked minutes: stored worked_hours first, otherwise clock-out − clock-in − breaks; open days separate', () => {
    expect(workedMinutes({ worked_hours: 7.5 })).toBe(450);
    expect(workedMinutes({ clock_in_at: '2026-10-01T03:30:00Z', clock_out_at: '2026-10-01T12:30:00Z', break_minutes: 60 })).toBe(480);
    expect(workedMinutes({ clock_in_at: '2026-10-01T03:30:00Z', clock_out_at: null })).toBeNull();
    const rows = buildWorkingHours([
      { employee_id: 'e1', employees: emp, clock_in_at: 'x', worked_hours: 8, break_minutes: 30 },
      { employee_id: 'e1', employees: emp, clock_in_at: '2026-10-02T03:30:00Z', clock_out_at: '2026-10-02T09:30:00Z', break_minutes: 0 },
      { employee_id: 'e1', employees: emp, clock_in_at: '2026-10-03T03:30:00Z', clock_out_at: null },
      { employee_id: 'e2', employees: null, clock_in_at: null },
    ]);
    expect(rows).toEqual([{ employeeId: 'e1', employee: 'Eli Emp', code: 'E1', department: 'Ops', days: 2, openDays: 1, workedMinutes: 840, breakMinutes: 30, avgMinutes: 420 }]);
  });
});
