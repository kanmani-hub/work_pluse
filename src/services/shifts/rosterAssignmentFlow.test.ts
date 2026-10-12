import { describe, it, expect, vi, beforeEach } from 'vitest';
import { rosterService } from './rosterService';
import { attendanceService } from '../attendance/attendanceService';
import { salaryService } from '../payroll/salaryService';
import { auditService } from '../audit/auditService';
import { supabase } from '../../lib/supabase';
import { resolveScopedAssignmentDates } from './monthlyRosterRules';
import { companyDateStr } from '../../utils/companyDate';

vi.mock('../payroll/salaryService');
vi.mock('../audit/auditService');
vi.mock('../notifications/notificationService', () => ({
  notificationService: {
    notifyEmployee: vi.fn().mockResolvedValue({}),
  },
}));

// In-memory database mock supporting all tables: rosters, roster_assignments, shift_assignments, profiles
vi.mock('../../lib/supabase', () => {
  const db: any = { tables: {}, denyWrites: false, seq: 0, authUser: null };
  const from = (t: string) => {
    const q: any = { t, op: 'select', filters: [], payload: null, one: null, head: false, count: false, conflict: null, orderCols: [] };
    const rows = () => (db.tables[t] ||= []);
    const match = (r: any) => q.filters.every(([op, c, v]: any) => {
      if (op === 'eq') return r[c] === v;
      if (op === 'neq') return r[c] !== v;
      if (op === 'lte') return r[c] <= v;
      if (op === 'gte') return r[c] >= v;
      if (op === 'in') return Array.isArray(v) && v.includes(r[c]);
      if (op === 'is') return r[c] === v;
      return true;
    });

    const run = () => {
      if (q.op !== 'select' && db.denyWrites) {
        return { data: null, error: { code: '42501', message: `new row violates row-level security policy for table "${t}"` } };
      }
      if (q.op === 'insert') {
        const toInsert = Array.isArray(q.payload) ? q.payload : [q.payload];
        const inserted = toInsert.map((item: any) => ({ id: `${t}-${++db.seq}`, ...item }));
        rows().push(...inserted);
        return { data: q.one ? inserted[0] : inserted, error: null };
      }
      if (q.op === 'upsert') {
        const toUpsert = Array.isArray(q.payload) ? q.payload : [q.payload];
        const keys = String(q.conflict).split(',');
        const result: any[] = [];
        for (const item of toUpsert) {
          const hit = rows().find((r: any) => keys.every(k => r[k] === item[k]));
          if (hit) {
            Object.assign(hit, item);
            result.push(hit);
          } else {
            const r = { id: `${t}-${++db.seq}`, ...item };
            rows().push(r);
            result.push(r);
          }
        }
        return { data: q.one ? result[0] : result, error: null };
      }
      if (q.op === 'update') {
        const hit = rows().filter(match);
        hit.forEach((r: any) => Object.assign(r, q.payload));
        return { data: hit.map((r: any) => ({ ...r })), error: null };
      }
      // select
      let hit = rows().filter(match).map((r: any) => {
        const copy = { ...r };
        // emulate joins
        if (t === 'roster_assignments') {
          const roster = (db.tables.rosters || []).find((ros: any) => ros.id === r.roster_id);
          copy.rosters = roster ? { ...roster } : null;
          const shift = (db.tables.shift_templates || []).find((st: any) => st.id === r.shift_template_id);
          copy.shift_templates = shift ? { ...shift } : null;
        }
        return copy;
      });

      if (q.head) return { data: null, count: hit.length, error: null };
      if (q.one === 'single') return hit.length === 1 ? { data: hit[0], error: null } : { data: null, error: { message: hit.length === 0 ? 'not found' : 'multiple rows' } };
      if (q.one === 'maybe') return { data: hit[0] ?? null, error: null };
      return { data: hit, count: q.count ? hit.length : null, error: null };
    };

    const b: any = {
      select: (_c?: string, o?: any) => { if (o?.head) q.head = true; if (o?.count) q.count = true; return b; },
      insert: (p: any) => { q.op = 'insert'; q.payload = p; return b; },
      upsert: (p: any, o: any) => { q.op = 'upsert'; q.payload = p; q.conflict = o?.onConflict; return b; },
      update: (p: any) => { q.op = 'update'; q.payload = p; return b; },
      eq: (c: string, v: any) => { q.filters.push(['eq', c, v]); return b; },
      neq: (c: string, v: any) => { q.filters.push(['neq', c, v]); return b; },
      lte: (c: string, v: any) => { q.filters.push(['lte', c, v]); return b; },
      gte: (c: string, v: any) => { q.filters.push(['gte', c, v]); return b; },
      in: (c: string, v: any[]) => { q.filters.push(['in', c, v]); return b; },
      is: (c: string, v: any) => { q.filters.push(['is', c, v]); return b; },
      or: () => b,
      order: () => b,
      limit: () => b,
      single: () => { q.one = 'single'; return b; },
      maybeSingle: () => { q.one = 'maybe'; return b; },
      then: (res: any, rej: any) => Promise.resolve().then(run).then(res, rej),
    };
    return b;
  };

  const auth = {
    getUser: vi.fn().mockImplementation(() => Promise.resolve({ data: { user: db.authUser }, error: null })),
  };

  return { supabase: { from, auth, __db: db } };
});

const db = (supabase as any).__db;

describe('Complete Assignment-to-Calendar-to-Employee Synchronization Flow', () => {
  const testAdminId = 'emp-admin-1';
  const testEmpId = 'emp-016'; // Hemanth
  const testShift = {
    id: 'st-general',
    name: 'General Shift',
    start_time: '10:00:00',
    end_time: '19:30:00',
    required_hours: 8.5,
  };

  const workCell = {
    dayType: 'WORK' as const,
    shiftTemplateId: 'st-general',
    workMode: 'OFFICE' as const,
  };

  const wfhCell = {
    dayType: 'WORK' as const,
    shiftTemplateId: 'st-general',
    workMode: 'WFH' as const,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    db.tables = {
      rosters: [],
      roster_assignments: [],
      shift_templates: [testShift],
      shift_assignments: [],
      profiles: [{ auth_user_id: 'auth-user-016', employee_id: testEmpId }],
    };
    db.denyWrites = false;
    db.seq = 0;
    db.authUser = { id: 'auth-user-016', email: 'employee@company.com' };
    (salaryService.getCurrentEmployeeId as any).mockResolvedValue(testAdminId);
    (auditService.recordAuditLog as any).mockResolvedValue(undefined);
  });

  // 1. Assigning one date
  it('1. assigns shift to one specific date only when scope is DATE', async () => {
    const res = await rosterService.saveScopedAssignments({
      employeeId: testEmpId,
      targetDate: '2026-10-12',
      cell: workCell,
      scope: 'DATE',
    });

    expect(res.error).toBeNull();
    expect(res.data?.updatedDates).toEqual(['2026-10-12']);
    expect(res.data?.count).toBe(1);

    const saved = db.tables.roster_assignments;
    expect(saved).toHaveLength(1);
    expect(saved[0].assignment_date).toBe('2026-10-12');
    expect(saved[0].shift_template_id).toBe('st-general');
    expect(saved[0].work_mode).toBe('OFFICE');
  });

  // 2. Assigning a full week
  it('2. assigns shift across the entire week (Mon-Sat), preserving weekly offs (Sunday)', async () => {
    const res = await rosterService.saveScopedAssignments({
      employeeId: testEmpId,
      targetDate: '2026-10-12', // Monday
      cell: workCell,
      scope: 'WEEK',
      weeklyOffDays: ['Sunday'],
    });

    expect(res.error).toBeNull();
    // Monday (12th) to Saturday (17th) updated, Sunday (18th) preserved as weekly off
    expect(res.data?.updatedDates).toEqual([
      '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17'
    ]);
    expect(res.data?.skippedDates).toEqual([
      { date: '2026-10-18', reason: 'WEEK_OFF' }
    ]);
    expect(res.data?.count).toBe(6);
  });

  // 3. Assigning a full month
  it('3. assigns shift across the entire month, populating all calendar dates in scope', async () => {
    const res = await rosterService.saveScopedAssignments({
      employeeId: testEmpId,
      targetDate: '2026-10-12',
      cell: workCell,
      scope: 'MONTH',
      weeklyOffDays: ['Sunday'],
    });

    expect(res.error).toBeNull();
    // October 2026 has 31 days. Sundays: Oct 4, 11, 18, 25 (4 Sundays)
    // 31 - 4 = 27 working days assigned
    expect(res.data?.count).toBe(27);
    expect(res.data?.skippedDates).toHaveLength(4);
    expect(res.data?.skippedDates.map((s: any) => s.date)).toEqual([
      '2026-10-04', '2026-10-11', '2026-10-18', '2026-10-25'
    ]);
  });

  // 4. Correct handling of weekly offs, public holidays, approved leaves, and intentional exceptions
  it('4. preserves weekly offs, public holidays, approved leaves, and date exceptions', async () => {
    const res = await rosterService.saveScopedAssignments({
      employeeId: testEmpId,
      targetDate: '2026-10-12',
      cell: workCell,
      scope: 'MONTH',
      weeklyOffDays: ['Saturday', 'Sunday'],
      holidays: ['2026-10-02'], // Gandhi Jayanti
      approvedLeaves: [{ start_date: '2026-10-15', end_date: '2026-10-16' }], // 2 days leave
      preserveExceptions: true,
      existingAssignments: {
        '2026-10-20': { shift: 'st-special', day_type: 'WORK', is_exception: true },
      },
    });

    expect(res.error).toBeNull();
    const skipped = res.data?.skippedDates || [];
    
    // Check holiday skipped
    expect(skipped.some((s: any) => s.date === '2026-10-02' && s.reason === 'HOLIDAY')).toBe(true);
    // Check leaves skipped
    expect(skipped.some((s: any) => s.date === '2026-10-15' && s.reason === 'LEAVE')).toBe(true);
    expect(skipped.some((s: any) => s.date === '2026-10-16' && s.reason === 'LEAVE')).toBe(true);
    // Check intentional exception skipped
    expect(skipped.some((s: any) => s.date === '2026-10-20' && s.reason === 'EXCEPTION')).toBe(true);
  });

  // 5. Shift changes within the selected scope
  it('5. changes shift and work mode within scope without overwriting other weeks', async () => {
    // Week 1 (Oct 12 to 18) assigned to General Shift
    await rosterService.saveScopedAssignments({
      employeeId: testEmpId,
      targetDate: '2026-10-12',
      cell: workCell,
      scope: 'WEEK',
      weeklyOffDays: ['Sunday'],
    });

    // Week 2 (Oct 19 to 25) assigned to WFH
    await rosterService.saveScopedAssignments({
      employeeId: testEmpId,
      targetDate: '2026-10-19',
      cell: wfhCell,
      scope: 'WEEK',
      weeklyOffDays: ['Sunday'],
    });

    const entries = db.tables.roster_assignments;
    const oct12 = entries.find((e: any) => e.assignment_date === '2026-10-12');
    const oct19 = entries.find((e: any) => e.assignment_date === '2026-10-19');

    expect(oct12.work_mode).toBe('OFFICE');
    expect(oct19.work_mode).toBe('WFH');
  });

  // 6. Duplicate prevention and persistence
  it('6. prevents duplicate records using onConflict upsert when reassigning the same date', async () => {
    // Initial assign
    await rosterService.saveScopedAssignments({
      employeeId: testEmpId,
      targetDate: '2026-10-12',
      cell: workCell,
      scope: 'DATE',
    });

    expect(db.tables.roster_assignments).toHaveLength(1);

    // Reassign same date to WFH
    await rosterService.saveScopedAssignments({
      employeeId: testEmpId,
      targetDate: '2026-10-12',
      cell: wfhCell,
      scope: 'DATE',
    });

    // Still only 1 record, updated in-place
    expect(db.tables.roster_assignments).toHaveLength(1);
    expect(db.tables.roster_assignments[0].work_mode).toBe('WFH');
  });

  // 7. Calendar display after reload (persisted records retrieved)
  it('7. returns saved roster entries across the range so calendar displays persisted data', async () => {
    await rosterService.saveScopedAssignments({
      employeeId: testEmpId,
      targetDate: '2026-10-12',
      cell: workCell,
      scope: 'WEEK',
      weeklyOffDays: ['Sunday'],
    });

    // Simulate page reload: calling getRosters loads the persisted data
    const list = await rosterService.getRosters('2026-10-12', '2026-10-18');
    expect(list.error).toBeNull();
    expect(list.rosters).toHaveLength(1);
    expect(list.assignments).toHaveLength(6);
  });

  // 8. Employee dashboard synchronization
  it('8. synchronizes with employee module via getMyScheduleForRange and getMyShiftForDate', async () => {
    // 1. Assign week
    await rosterService.saveScopedAssignments({
      employeeId: testEmpId,
      targetDate: '2026-10-12',
      cell: workCell,
      scope: 'WEEK',
      weeklyOffDays: ['Sunday'],
    });

    // 2. Publish roster
    const rosterId = db.tables.rosters[0].id;
    await rosterService.publish(rosterId);

    // 3. Employee queries their schedule
    const sched = await attendanceService.getMyScheduleForRange('2026-10-12', '2026-10-18');
    expect(sched.error).toBeNull();
    expect(sched.data['2026-10-12']).toBeDefined();
    expect(sched.data['2026-10-12'].workMode).toBe('OFFICE');
    expect(sched.data['2026-10-12'].shift.name).toBe('General Shift');

    // 4. Employee checks shift for date
    const shiftForDay = await attendanceService.getMyShiftForDate('2026-10-12');
    expect(shiftForDay.error).toBeNull();
    expect(shiftForDay.source).toBe('ROSTER');
    expect(shiftForDay.data.name).toBe('General Shift');
    expect(shiftForDay.data.work_mode).toBe('OFFICE');
  });

  // 9. Draft versus published behavior
  it('9. ensures DRAFT roster shifts are not exposed to employee until published', async () => {
    // Assign week (stays in DRAFT)
    await rosterService.saveScopedAssignments({
      employeeId: testEmpId,
      targetDate: '2026-10-12',
      cell: workCell,
      scope: 'WEEK',
      weeklyOffDays: ['Sunday'],
    });

    // Before publishing, employee schedule returns empty for roster entries
    const draftSched = await attendanceService.getMyScheduleForRange('2026-10-12', '2026-10-18');
    expect(Object.keys(draftSched.data)).toHaveLength(0);

    // After publishing, employee schedule reflects all assignments
    await rosterService.publish(db.tables.rosters[0].id);
    const pubSched = await attendanceService.getMyScheduleForRange('2026-10-12', '2026-10-18');
    expect(Object.keys(pubSched.data)).toHaveLength(6);
  });

  // 10. Timezone and month-boundary handling
  it('10. handles calendar boundaries and company timezone consistently without drift', () => {
    // Pure string date validation in Asia/Kolkata
    const today = companyDateStr();
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // Test month boundaries for month scope:
    const octRange = resolveScopedAssignmentDates({
      targetDate: '2026-10-31',
      scope: 'MONTH',
      cell: workCell,
    });
    expect(octRange.scopeRange.start).toBe('2026-10-01');
    expect(octRange.scopeRange.end).toBe('2026-10-31');
    // Does not include November 1
    expect(octRange.datesToUpdate).not.toContain('2026-11-01');

    // Leap year boundary check
    const leapRange = resolveScopedAssignmentDates({
      targetDate: '2024-02-01',
      scope: 'MONTH',
      cell: workCell,
    });
    expect(leapRange.scopeRange.end).toBe('2024-02-29');
  });

  // 11. Employee access restrictions
  it('11. prevents employees from querying schedule when unauthenticated', async () => {
    db.authUser = null; // simulate logged out user
    const res = await attendanceService.getMyScheduleForRange('2026-10-12', '2026-10-18');
    expect(res.error?.message).toBe('Unauthorized');
  });

  // 12. Month-scope auto-assignment and immediate sync to employee module
  it('12. auto-assigns across entire month by default and synchronizes immediately with employee module', async () => {
    // Admin assigns shift with MONTH scope and autoPublish: true (default from Admin Roster)
    const saveRes = await rosterService.saveScopedAssignments({
      employeeId: testEmpId,
      targetDate: '2026-10-12',
      cell: workCell,
      scope: 'MONTH',
      weeklyOffDays: ['Sunday'],
      autoPublish: true,
    });

    expect(saveRes.error).toBeNull();
    expect(saveRes.data?.count).toBe(27); // 31 days in October - 4 Sundays = 27 working days
    expect(saveRes.data?.rostersUpdated.length).toBeGreaterThanOrEqual(4);

    // All rosters created are PUBLISHED immediately
    for (const r of db.tables.rosters) {
      expect(r.status).toBe('PUBLISHED');
    }

    // Employee module immediately sees the shift on Oct 12 without manual publish step
    const empShift = await attendanceService.getMyShiftForDate('2026-10-12');
    expect(empShift.error).toBeNull();
    expect(empShift.source).toBe('ROSTER');
    expect(empShift.data.name).toBe('General Shift');
    expect(empShift.data.work_mode).toBe('OFFICE');

    // Employee module schedule across the entire month has all 27 working days assigned
    const monthSched = await attendanceService.getMyScheduleForRange('2026-10-01', '2026-10-31');
    expect(monthSched.error).toBeNull();
    expect(Object.keys(monthSched.data)).toHaveLength(27);
    expect(monthSched.data['2026-10-12'].shift.name).toBe('General Shift');
    expect(monthSched.data['2026-10-31'].shift.name).toBe('General Shift');
  });
});

