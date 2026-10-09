import { describe, it, expect } from 'vitest';
import { reportDateRange, computeAttendanceStats, averageRequiredMinutes, weekdayName } from './reportRules';

const MON_FRI = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
const emp = (id: string, dept = 'CG', role = 'EMPLOYEE', status = 'ACTIVE') => ({ id, status, role: { name: role }, departments: { name: dept } });
const att = (employee_id: string, attendance_date: string, clock = true) => ({ employee_id, attendance_date, clock_in_at: clock ? `${attendance_date}T03:30:00Z` : null });

describe('reportDateRange (company dates)', () => {
  it('Today / This Month / Last Month / This Week', () => {
    expect(reportDateRange('Today', '2026-10-09')).toEqual({ start: '2026-10-09', end: '2026-10-09' });
    expect(reportDateRange('This Month', '2026-10-09')).toEqual({ start: '2026-10-01', end: '2026-10-09' });
    expect(reportDateRange('Last Month', '2026-10-09')).toEqual({ start: '2026-09-01', end: '2026-09-30' });
    expect(reportDateRange('Last Month', '2026-03-15')).toEqual({ start: '2026-02-01', end: '2026-02-28' });
    expect(reportDateRange('Last Month', '2026-01-05')).toEqual({ start: '2025-12-01', end: '2025-12-31' });
    // 2026-10-09 is a Friday; week starts Sunday 2026-10-04
    expect(weekdayName('2026-10-09')).toBe('Friday');
    expect(reportDateRange('This Week', '2026-10-09')).toEqual({ start: '2026-10-04', end: '2026-10-09' });
  });
});

describe('computeAttendanceStats (present / expected employee-days)', () => {
  const base = { leaves: [], startDate: '2026-10-05', endDate: '2026-10-09', today: '2026-10-09', workingDays: MON_FRI };

  it('absent employees with NO attendance row lower the rate (old formula ignored them)', () => {
    const employees = [emp('a'), emp('b'), emp('c'), emp('d')];
    // Only "a" attended, every day Mon–Fri
    const attendance = ['05', '06', '07', '08', '09'].map(d => att('a', `2026-10-${d}`));
    const s = computeAttendanceStats({ ...base, employees, attendance });
    expect(s.expectedDays).toBe(20);
    expect(s.presentDays).toBe(5);
    expect(s.absentDays).toBe(15);
    expect(s.rate).toBe(25);
    // the previous formula (present rows / attendance rows) would have reported 100%
  });

  it('excludes ADMIN and inactive employees from the workforce', () => {
    const s = computeAttendanceStats({ ...base, employees: [emp('a'), emp('adm', 'IT', 'ADMIN'), emp('x', 'CG', 'EMPLOYEE', 'INACTIVE')], attendance: [att('a', '2026-10-09')] });
    expect(s.workforce).toBe(1);
    expect(s.expectedDays).toBe(5);
  });

  it('a row without clock-in is not "present"', () => {
    const s = computeAttendanceStats({ ...base, startDate: '2026-10-09', employees: [emp('a')], attendance: [att('a', '2026-10-09', false)] });
    expect(s.presentDays).toBe(0);
    expect(s.rate).toBe(0);
  });

  it('approved full-day leave is not expected; half-day leave still is', () => {
    const leaves = [
      { employee_id: 'a', start_date: '2026-10-01', end_date: '2026-10-06', is_half_day: false }, // covers Mon 5, Tue 6
      { employee_id: 'b', start_date: '2026-10-07', end_date: '2026-10-07', is_half_day: true },
    ];
    const s = computeAttendanceStats({ ...base, employees: [emp('a'), emp('b')], attendance: [], leaves });
    expect(s.leaveDays).toBe(2);
    expect(s.expectedDays).toBe(8);
  });

  it('weekly offs are not expected unless the employee actually worked', () => {
    const s = computeAttendanceStats({ ...base, startDate: '2026-10-03', endDate: '2026-10-04', employees: [emp('a'), emp('b')], attendance: [att('a', '2026-10-04')] });
    expect(s.expectedDays).toBe(1);
    expect(s.presentDays).toBe(1);
    expect(s.rate).toBe(100);
  });

  it('future dates are never counted; nothing expected → rate null (shown as —)', () => {
    const s = computeAttendanceStats({ ...base, startDate: '2026-10-10', endDate: '2026-10-31', employees: [emp('a')], attendance: [] });
    expect(s.expectedDays).toBe(0);
    expect(s.rate).toBeNull();
  });

  it('department % and daily trend use the same expected days', () => {
    const employees = [emp('a', 'CG'), emp('b', 'CG'), emp('c', 'HR')];
    const attendance = [att('a', '2026-10-09'), att('c', '2026-10-09')];
    const s = computeAttendanceStats({ ...base, startDate: '2026-10-09', employees, attendance });
    expect(s.departments).toEqual([{ dept: 'CG', val: 50 }, { dept: 'HR', val: 100 }]);
    expect(s.trend).toEqual([{ date: '2026-10-09', label: 'Fri', val: 67 }]);
  });

  it('counts present employee-days covered by approved WFH separately', () => {
    const s = computeAttendanceStats({ ...base, startDate: '2026-10-09', employees: [emp('a'), emp('b')], attendance: [att('a', '2026-10-09'), att('b', '2026-10-09')], wfh: [{ employee_id: 'b', request_date: '2026-10-09' }] });
    expect(s.presentDays).toBe(2);
    expect(s.wfhPresentDays).toBe(1);
  });
});

describe('averageRequiredMinutes (replaces the fixed "8h 00m")', () => {
  it('uses the attendance required_hours, else the shift template; ignores rows without clock-in', () => {
    const rows = [
      { clock_in_at: 'x', required_hours: 9.5 },
      { clock_in_at: 'x', required_hours: null, shift_templates: { required_hours: 8 } },
      { clock_in_at: null, required_hours: 4 },
    ];
    expect(averageRequiredMinutes(rows)).toBe(525); // (570 + 480) / 2
  });
  it('returns null (shown as Unavailable) when no attended shift has a configured value', () => {
    expect(averageRequiredMinutes([])).toBeNull();
    expect(averageRequiredMinutes([{ clock_in_at: 'x', required_hours: 0, shift_templates: null }])).toBeNull();
  });
});
