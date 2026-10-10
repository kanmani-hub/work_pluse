import { describe, it, expect } from 'vitest';
import { computeAttendanceStats } from './reportRules';
import { reportCardRecords, departmentSummary } from './reportCardRules';

const emp = (id: string, dept = 'CG') => ({ id, status: 'ACTIVE', role: { name: 'EMPLOYEE' }, first_name: 'E', last_name: id, employee_code: 'C' + id, departments: { name: dept } });
const employees = [emp('a'), emp('b'), emp('c', 'HR')];
const who = (id: string, dept = 'CG') => ({ first_name: 'E', last_name: id, employee_code: 'C' + id, departments: { name: dept } });
const attendance = [
  { id: 1, employee_id: 'a', attendance_date: '2026-10-08', clock_in_at: '2026-10-08T03:45:00Z', clock_out_at: '2026-10-08T12:30:00Z', worked_hours: 8.5, late_minutes: 15, status: 'COMPLETED', employees: who('a'), shift_templates: { start_time: '09:00:00' } },
  { id: 2, employee_id: 'a', attendance_date: '2026-10-09', clock_in_at: '2026-10-09T03:30:00Z', clock_out_at: null, worked_hours: null, late_minutes: 0, status: 'WORKING', employees: who('a') },
  { id: 3, employee_id: 'c', attendance_date: '2026-10-09', clock_in_at: '2026-10-09T03:30:00Z', clock_out_at: '2026-10-09T11:30:00Z', worked_hours: 7.5, late_minutes: 0, status: 'COMPLETED', employees: who('c', 'HR') },
];
const leaves = [{ employee_id: 'b', start_date: '2026-10-09', end_date: '2026-10-09', is_half_day: false, leave_types: { name: 'Sick' }, employees: who('b') }];
const wfh = [{ employee_id: 'c', request_date: '2026-10-09', employees: who('c', 'HR') }];
const payroll = [{ id: 'p1', employee_id: 'a', status: 'PAID', gross_salary: 30000, total_deductions: 1000, net_salary: 29000, employees: who('a') }];

describe('Reports cards → records', () => {
  const stats = computeAttendanceStats({ employees, attendance, leaves, wfh, startDate: '2026-10-08', endDate: '2026-10-09', today: '2026-10-09', workingDays: ['Thursday', 'Friday'] });
  const r = reportCardRecords({ employees, attendance, wfh, leaves, payroll, days: stats.days });

  it('Present / Attendance Rate rows equal the stats numbers', () => {
    expect(r.present.count).toBe(stats.presentDays);
    expect(r.attendanceRate.count).toBe(stats.expectedDays);
    expect(r.attendanceRate.rows.filter(x => x.outcome === 'Absent').length).toBe(stats.absentDays);
    expect(r.present.rows.find(x => x.code === 'Cc')?.outcome).toBe('Present (WFH)');
    expect(stats.days.filter(d => d.outcome === 'LEAVE').length).toBe(stats.leaveDays);
  });
  it('Late rows show shift start, clock-in (IST) and late minutes', () => {
    expect(r.late.count).toBe(1);
    expect(r.late.rows[0]).toMatchObject({ code: 'Ca', shiftStart: '09:00', clockIn: '09:15', lateMinutes: 15 });
  });
  it('Avg hours uses only records with stored worked hours (missing clock-out is left out)', () => {
    expect(r.avgHours.count).toBe(2);
    expect(r.avgHours.rows.map(x => x.workedHours)).toEqual(['8h 30m', '7h 30m']);
  });
  it('WFH / leave / payroll rows mirror their inputs', () => {
    expect(r.wfh.count).toBe(1); expect(r.onLeave.rows[0]).toMatchObject({ leaveType: 'Sick', code: 'Cb' });
    expect(r.payroll.rows.reduce((s, x) => s + x.net, 0)).toBe(29000);
    expect(r.totalEmployees.count).toBe(3);
  });
  it('department drill-down uses the same records (no placeholder zeros)', () => {
    const d = departmentSummary(r, 'CG')!;
    expect(d.employees).toBe(2); expect(d.avgWorkingMinutes).toBe(510); expect(d.payrollNet).toBe(29000);
    expect(departmentSummary(r, 'HR')!.payrollRecords).toBe(0);
    expect(departmentSummary(undefined, 'CG')).toBe(null);
  });
});
