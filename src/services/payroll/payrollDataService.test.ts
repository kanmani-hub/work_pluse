import { describe, it, expect, vi, beforeEach } from 'vitest';
import { payrollDataService, rosterDaysFromAssignments } from './payrollDataService';
import { supabase } from '../../lib/supabase';

// Every table returns an empty list except the ones configured in __db; any table can fail.
// Filters are not applied (fixtures hold only matching rows); calls are recorded per table.
vi.mock('../../lib/supabase', () => {
  const db: any = { rows: {}, failTables: [], calls: {} };
  const from = (t: string) => {
    let single = false;
    const calls: any[] = (db.calls[t] ||= []);
    const b: any = new Proxy({}, {
      get: (_o, k) => {
        if (k === 'then') return (res: any, rej: any) => Promise.resolve()
          .then(() => {
            if (db.failTables.includes(t)) return { data: null, error: { message: `${t} unavailable` } };
            const rows = db.rows[t] || [];
            return { data: single ? (rows[0] ?? null) : rows, error: null };
          })
          .then(res, rej);
        return (...args: any[]) => { calls.push([k, ...args]); if (k === 'maybeSingle' || k === 'single') single = true; return b; };
      },
    });
    return b;
  };
  return { supabase: { from, __db: db } };
});
const db = (supabase as any).__db;

beforeEach(() => { db.rows = { employees: [{ joining_date: '2024-01-01' }] }; db.failTables = []; db.calls = {}; });

const MON_SAT = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const APP = { workingDays: MON_SAT, breakDurationMins: 75, publicHolidays: [] as any[] };

describe('approved overtime for payroll (data service)', () => {
  it('counts only APPROVED requests (the query filters by status; the rule ignores others too)', async () => {
    db.rows.overtime_requests = [
      { status: 'APPROVED', approved_overtime_hours: 1.5 },
      { status: 'PENDING', approved_overtime_hours: null },
      { status: 'REJECTED', approved_overtime_hours: 3 },
    ];
    expect(await payrollDataService._fetchApprovedOvertime('e1', '2026-10-01T00:00:00.000Z', '2026-10-31T23:59:59.000Z')).toEqual({ minutes: 90, error: null });
  });

  it('a failed lookup returns an error (never a silent 0)', async () => {
    db.failTables = ['overtime_requests'];
    const r = await payrollDataService._fetchApprovedOvertime('e1', '2026-10-01', '2026-10-31');
    expect(r.minutes).toBe(0);
    expect(r.error?.message).toBe('Approved overtime could not be loaded: overtime_requests unavailable');
  });

  it('the payroll summary flags overtime as unavailable instead of showing 0 as if real', async () => {
    db.failTables = ['overtime_requests'];
    db.rows.attendance = [{ status: 'COMPLETED', overtime_minutes: 120, attendance_date: '2026-10-05' }];
    const d = await payrollDataService.getEmployeePayrollData('e1', 2026, 10, APP);
    expect(d.approvedOvertimeError).toBe('Approved overtime could not be loaded: overtime_requests unavailable');
    expect(d.attendance.recordedOvertimeMinutes).toBe(120);
  });

  it('summary with a successful lookup: approved minutes only, recorded minutes kept for information', async () => {
    db.rows.attendance = [{ status: 'COMPLETED', overtime_minutes: 120, attendance_date: '2026-10-05' }];
    db.rows.overtime_requests = [{ status: 'APPROVED', approved_overtime_hours: 0.5 }];
    const d = await payrollDataService.getEmployeePayrollData('e1', 2026, 10, APP);
    expect(d.approvedOvertimeError).toBeNull();
    expect(d.attendance.totalOvertimeMinutes).toBe(30);
    expect(d.attendance.recordedOvertimeMinutes).toBe(120);
  });
});

describe('payroll day classification from the database (synthetic rows)', () => {
  // September 2026: Tue 1 … Wed 30; Sundays 6, 13, 20, 27 → 26 Mon–Sat working days. Fully in the past.
  const SEP = ['2026-09-01T00:00:00.000Z', '2026-09-30T23:59:59.000Z'] as const;
  const workedAll = (except: string[]) => {
    const rows: any[] = [];
    for (let d = 1; d <= 30; d++) {
      const date = `2026-09-${String(d).padStart(2, '0')}`;
      if (new Date(`${date}T12:00:00Z`).getUTCDay() === 0 || except.includes(date)) continue;
      rows.push({ attendance_date: date, status: 'COMPLETED', clock_in_at: `${date}T03:30:00Z` });
    }
    return rows;
  };

  it('LATE is a worked day; a day with no row is an absence; leave, holiday and Sunday are excluded', async () => {
    db.rows.attendance = [
      ...workedAll(['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11']),
      { attendance_date: '2026-09-07', status: 'LATE', clock_in_at: '2026-09-07T04:00:00Z', late_minutes: 30 },
      { attendance_date: '2026-09-11', status: 'HALF_DAY', clock_in_at: '2026-09-11T03:30:00Z', is_half_day: true, early_logout_minutes: 240 },
      // 2026-09-08: no row at all → absent; 09-09: approved casual leave; 09-10: public holiday
    ];
    db.rows.leave_requests = [{ start_date: '2026-09-09', end_date: '2026-09-09', is_half_day: false, status: 'APPROVED', leave_types: { code: 'CL', name: 'Casual Leave' } }];
    const r = await payrollDataService._fetchPayrollDays('e1', SEP[0], SEP[1], { ...APP, publicHolidays: [{ date: '2026-09-10', name: 'Synthetic Day' }] }, '2026-10-09');
    expect(r.error).toBeNull();
    // Policy 2026-10-09: the short day (HALF_DAY) is flagged for review instead of an automatic half-day deduction
    expect(r.attendance).toMatchObject({ workingDays: 25, presentDays: 23, absentDays: 1, halfDays: 0, lopDays: 1, holidayDays: 1, weeklyOffDays: 4, totalLateMinutes: 30, lateLogins: 1, earlyLogouts: 1 });
    expect(r.attendance.reviewItems?.map(i => [i.date, i.type])).toEqual([['2026-09-11', 'SHORT_DAY']]);
    const applied = await payrollDataService._fetchPayrollDays('e1', SEP[0], SEP[1], { ...APP, publicHolidays: [{ date: '2026-09-10', name: 'Synthetic Day' }] }, '2026-10-09', { '2026-09-11|SHORT_DAY': 'APPLY' });
    expect(applied.attendance).toMatchObject({ halfDays: 1, reviewItems: [] });
    expect(r.leave).toEqual({ approvedLeave: 1, lopLeave: 0, totalLeaveDays: 1 });
  });

  it('approved Loss-of-Pay leave is LOP once (not also an absence)', async () => {
    db.rows.attendance = workedAll(['2026-09-15']);
    db.rows.leave_requests = [{ start_date: '2026-09-15', end_date: '2026-09-15', is_half_day: false, status: 'APPROVED', leave_types: { code: 'LOP', name: 'Loss of Pay' } }];
    const r = await payrollDataService._fetchPayrollDays('e1', SEP[0], SEP[1], APP, '2026-10-09');
    expect(r.attendance).toMatchObject({ absentDays: 0, lopDays: 1 });
    expect(r.leave).toEqual({ approvedLeave: 0, lopLeave: 1, totalLeaveDays: 1 });
  });

  it('days before joining_date are not absences', async () => {
    db.rows.employees = [{ joining_date: '2026-09-28' }];
    db.rows.attendance = [];
    const r = await payrollDataService._fetchPayrollDays('e1', SEP[0], SEP[1], APP, '2026-10-09');
    expect(r.attendance).toMatchObject({ workingDays: 3, absentDays: 3, lopDays: 3 }); // Mon 28, Tue 29, Wed 30
  });

  it('queries use plain dates and the request_date column for WFH', async () => {
    db.rows.wfh_requests = [{ request_date: '2026-09-02', status: 'APPROVED' }, { request_date: '2026-09-03', status: 'APPROVED' }];
    expect(await payrollDataService._fetchWfh('e1', SEP[0], SEP[1])).toEqual({ wfhDays: 2, error: null });
    expect(db.calls.wfh_requests).toEqual([['select', 'request_date, status'], ['eq', 'employee_id', 'e1'], ['eq', 'status', 'APPROVED'], ['gte', 'request_date', '2026-09-01'], ['lte', 'request_date', '2026-09-30']]);
    await payrollDataService._fetchPayrollDays('e1', SEP[0], SEP[1], APP, '2026-10-09');
    expect(db.calls.attendance.slice(1)).toEqual([['eq', 'employee_id', 'e1'], ['gte', 'attendance_date', '2026-09-01'], ['lte', 'attendance_date', '2026-09-30']]);
  });

  for (const table of ['attendance', 'leave_requests', 'employees']) {
    it(`a failed ${table} query returns an error, never zero absences`, async () => {
      db.failTables = [table];
      const r = await payrollDataService._fetchPayrollDays('e1', SEP[0], SEP[1], APP, '2026-10-09');
      expect(r.error?.message).toMatch(`${table} unavailable`);
      expect(r.days).toEqual([]);
    });
  }

  it('a missing employee record is an error', async () => {
    db.rows.employees = [];
    const r = await payrollDataService._fetchPayrollDays('e1', SEP[0], SEP[1], APP, '2026-10-09');
    expect(r.error?.message).toBe('Employee record could not be loaded for payroll.');
  });

  it('no configured working days is an error (never "nobody is absent")', async () => {
    const r = await payrollDataService._fetchPayrollDays('e1', SEP[0], SEP[1], { workingDays: [] }, '2026-10-09');
    expect(r.error?.message).toMatch('Company working days are not configured');
  });

  it('failed WFH / permission queries return errors', async () => {
    db.failTables = ['wfh_requests', 'permission_requests'];
    expect((await payrollDataService._fetchWfh('e1', SEP[0], SEP[1])).error?.message).toBe('Approved WFH could not be loaded: wfh_requests unavailable');
    expect((await payrollDataService._fetchPermissions('e1', SEP[0], SEP[1])).error?.message).toBe('Approved permissions could not be loaded: permission_requests unavailable');
  });

  it('the payroll detail summary flags a failed attendance lookup instead of showing zeros as real', async () => {
    db.failTables = ['attendance'];
    const d = await payrollDataService.getEmployeePayrollData('e1', 2026, 9, APP);
    expect(d.dataError).toMatch('Attendance could not be loaded: attendance unavailable');
  });
});

describe('Rule 2: roster schedule from the database (synthetic rows)', () => {
  // September 2026: Sun 6, 13, 20, 27. Roster "R1" (PUBLISHED) covers Sep 14–20 for this employee.
  const R1 = { status: 'PUBLISHED', start_date: '2026-09-14', end_date: '2026-09-20' };
  const assign = (d: string, rosters: any = R1, roster_id = 'R1', day_type = 'WORK') => ({ assignment_date: d, roster_id, rosters, day_type });
  const off = (d: string) => assign(d, R1, 'R1', 'WEEK_OFF');

  // Owner decision 2026-10-09: weekly offs are SAVED per date (day_type WEEK_OFF); nothing is inferred from gaps
  it('saved WORK entries are WORK, saved WEEK_OFF entries are OFF, unsaved dates fall back to the company days', () => {
    const m = rosterDaysFromAssignments([assign('2026-09-14'), assign('2026-09-15'), off('2026-09-16'), assign('2026-09-20')], '2026-09-01', '2026-09-30');
    expect(m['2026-09-14']).toBe('WORK');
    expect(m['2026-09-20']).toBe('WORK');    // Sunday, rostered to work
    expect(m['2026-09-16']).toBe('OFF');     // Wednesday, saved as Week Off
    expect(m['2026-09-17']).toBeUndefined(); // inside the roster but nothing saved → company working days
    expect(m['2026-09-21']).toBeUndefined(); // outside the roster → company working days
    expect(Object.keys(m).length).toBe(4);
  });

  it('rows saved before the day_type column existed count as WORK; WORK wins over WEEK_OFF for the same date', () => {
    expect(rosterDaysFromAssignments([{ assignment_date: '2026-09-14', roster_id: 'R1', rosters: R1 }], '2026-09-01', '2026-09-30')).toEqual({ '2026-09-14': 'WORK' });
    expect(rosterDaysFromAssignments([off('2026-09-14'), assign('2026-09-14', R1, 'R9')], '2026-09-01', '2026-09-30')).toEqual({ '2026-09-14': 'WORK' });
  });

  it('DRAFT and ARCHIVED rosters are ignored (company working days apply)', () => {
    expect(rosterDaysFromAssignments([assign('2026-09-14', { ...R1, status: 'DRAFT' }), assign('2026-09-15', { ...R1, status: 'ARCHIVED' }, 'R2')], '2026-09-01', '2026-09-30')).toEqual({});
  });

  it('only entries inside the payroll period are used', () => {
    const R = { status: 'PUBLISHED', start_date: '2026-09-28', end_date: '2026-10-04' };
    const m = rosterDaysFromAssignments([assign('2026-09-30', R), assign('2026-10-01', R), { ...assign('2026-10-02', R), day_type: 'WEEK_OFF' }], '2026-09-01', '2026-09-30');
    expect(m).toEqual({ '2026-09-30': 'WORK' });
  });

  it('payroll uses the roster: rostered Sunday without clock-in = absent, roster off Wednesday = not absent', async () => {
    db.rows.attendance = [];
    db.rows.roster_assignments = [assign('2026-09-14'), assign('2026-09-15'), off('2026-09-16'), assign('2026-09-17'), assign('2026-09-18'), assign('2026-09-19'), assign('2026-09-20')];
    const r = await payrollDataService._fetchPayrollDays('e1', '2026-09-14', '2026-09-20', APP, '2026-10-09');
    expect(r.error).toBeNull();
    expect(r.attendance).toMatchObject({ workingDays: 6, absentDays: 6, weeklyOffDays: 1, rosterDays: 7 });
    expect(r.days.find(d => d.date === '2026-09-16')).toMatchObject({ kind: 'WEEKLY_OFF', scheduleSource: 'ROSTER' });
    expect(r.days.find(d => d.date === '2026-09-20')).toMatchObject({ kind: 'ABSENT', scheduleSource: 'ROSTER' });
    expect(db.calls.roster_assignments).toEqual([['select', '*, rosters(status, start_date, end_date)'], ['eq', 'employee_id', 'e1'], ['gte', 'assignment_date', '2026-09-14'], ['lte', 'assignment_date', '2026-09-20']]);
  });

  it('no roster rows → company working days fallback (Mon–Sat)', async () => {
    db.rows.attendance = [];
    const r = await payrollDataService._fetchPayrollDays('e1', '2026-09-14', '2026-09-20', APP, '2026-10-09');
    expect(r.attendance).toMatchObject({ workingDays: 6, absentDays: 6, weeklyOffDays: 1, rosterDays: 0 });
    expect(r.days.find(d => d.date === '2026-09-20')).toMatchObject({ kind: 'WEEKLY_OFF', scheduleSource: 'COMPANY' });
  });

  it('a failed roster lookup is an error, never "assume the company schedule / absent"', async () => {
    db.failTables = ['roster_assignments'];
    const r = await payrollDataService._fetchPayrollDays('e1', '2026-09-14', '2026-09-20', APP, '2026-10-09');
    expect(r.error?.message).toBe('Roster could not be loaded: roster_assignments unavailable');
    expect(r.days).toEqual([]);
  });

  it('half_day_type is read from leave so two half-day leaves cover the whole day', async () => {
    db.rows.attendance = [];
    db.rows.leave_requests = [
      { start_date: '2026-09-15', end_date: '2026-09-15', is_half_day: true, half_day_type: 'FIRST_HALF', status: 'APPROVED', leave_types: { code: 'CL', name: 'Casual Leave' } },
      { start_date: '2026-09-15', end_date: '2026-09-15', is_half_day: true, half_day_type: 'SECOND_HALF', status: 'APPROVED', leave_types: { code: 'CL', name: 'Casual Leave' } },
    ];
    const r = await payrollDataService._fetchPayrollDays('e1', '2026-09-15', '2026-09-15', APP, '2026-10-09');
    expect(r.attendance).toMatchObject({ absentDays: 0, lopDays: 0, reviewItems: [] });
    expect(r.leave.approvedLeave).toBe(1);
    expect(db.calls.leave_requests[0]).toEqual(['select', 'start_date, end_date, is_half_day, half_day_type, status, leave_types(name, code)']);
  });
});

describe('Saved settings and schedules drive the result (no hardcoded calendar)', () => {
  // Week Mon 14 – Sun 20 Sep 2026, nobody clocked in (synthetic). Changing ONLY saved data changes the outcome.
  const WEEK = ['2026-09-14', '2026-09-20'] as const;
  const run = (app: any) => payrollDataService._fetchPayrollDays('e1', WEEK[0], WEEK[1], app, '2026-10-09');
  const MON_FRI = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  const R1 = { status: 'PUBLISHED', start_date: '2026-09-14', end_date: '2026-09-20' };
  beforeEach(() => { db.rows.attendance = []; });

  it('company working days Mon–Sat → 6 absences; Mon–Fri → 5; Sun–Thu → 5 with Saturday and Friday off', async () => {
    expect((await run(APP)).attendance).toMatchObject({ absentDays: 6, weeklyOffDays: 1 });
    expect((await run({ ...APP, workingDays: MON_FRI })).attendance).toMatchObject({ absentDays: 5, weeklyOffDays: 2 });
    const sunThu = await run({ ...APP, workingDays: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday'] });
    expect(sunThu.attendance).toMatchObject({ absentDays: 5, weeklyOffDays: 2 });
    expect(sunThu.days.find(d => d.date === '2026-09-20')?.kind).toBe('ABSENT');     // Sunday is a working day here
    expect(sunThu.days.find(d => d.date === '2026-09-18')?.kind).toBe('WEEKLY_OFF'); // Friday is not
  });

  it('adding a public holiday in Settings removes that day from absences', async () => {
    const r = await run({ ...APP, publicHolidays: [{ date: '2026-09-16', name: 'Synthetic holiday' }] });
    expect(r.attendance).toMatchObject({ absentDays: 5, holidayDays: 1 });
  });

  it('publishing a roster changes the schedule; the same roster as DRAFT does not', async () => {
    const rows = (status: string) => [
      { assignment_date: '2026-09-15', roster_id: 'R1', rosters: { ...R1, status }, day_type: 'WEEK_OFF' },
      { assignment_date: '2026-09-20', roster_id: 'R1', rosters: { ...R1, status }, day_type: 'WORK', shift_template_id: 's1' },
    ];
    db.rows.roster_assignments = rows('DRAFT');
    const draft = await run(APP);
    expect(draft.attendance).toMatchObject({ absentDays: 6, rosterDays: 0 });
    db.rows.roster_assignments = rows('PUBLISHED');
    const published = await run(APP);
    // Tue 15 becomes the employee's weekly off; Sun 20 becomes a working day (absent without clock-in)
    expect(published.attendance).toMatchObject({ absentDays: 6, weeklyOffDays: 1, rosterDays: 2 });
    expect(published.days.find(d => d.date === '2026-09-15')).toMatchObject({ kind: 'WEEKLY_OFF', scheduleSource: 'ROSTER' });
    expect(published.days.find(d => d.date === '2026-09-20')).toMatchObject({ kind: 'ABSENT', scheduleSource: 'ROSTER' });
  });

  it('no saved working days → payroll refuses (never assumes a calendar)', async () => {
    expect((await run({ ...APP, workingDays: [] })).error?.message).toMatch('Company working days are not configured');
    expect((await run({ ...APP, workingDays: undefined })).error?.message).toMatch('Company working days are not configured');
  });
});
