/**
 * Reports: pure rules for the Overview metrics (no database access, unit-tested).
 *
 * Attendance rate = present employee-days / expected employee-days, using the same
 * definitions as Admin → Attendance:
 *  - Workforce: ACTIVE employees whose role is not ADMIN.
 *  - Present: an attendance record with a clock-in (clock_in_at set).
 *  - Expected: every workforce employee on every configured working day in the range up to
 *    today (company timezone), minus days covered by an approved FULL-day leave. A day the
 *    employee actually worked (even a weekly off) counts as expected and present.
 *  - Absent employee-days = expected - present.
 * Future dates are never counted. The previous formula (present rows / attendance rows)
 * ignored employees with no attendance record, so absences never lowered the rate.
 */
import { normalizeRole } from '../../lib/roles';
import { scheduledWorkMinutes } from '../attendance/employeeDashboardRules';

export type ReportRange = 'Today' | 'This Week' | 'This Month' | 'Last Month' | string;

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function weekdayName(date: string): string {
  return DAY_NAMES[new Date(`${date}T12:00:00Z`).getUTCDay()];
}

/** Date range (YYYY-MM-DD, company dates) for a Reports range filter. */
export function reportDateRange(range: ReportRange, today: string): { start: string; end: string } {
  const [y, m] = today.split('-').map(Number);
  switch (range) {
    case 'Today': return { start: today, end: today };
    case 'This Week': {
      // Week starts on Sunday (unchanged from the previous behaviour of this page).
      const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
      return { start: addDays(today, -dow), end: today };
    }
    case 'Last Month': {
      const firstThis = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-01`;
      const end = addDays(firstThis, -1);
      return { start: `${end.slice(0, 7)}-01`, end };
    }
    case 'This Month':
    default:
      return { start: `${today.slice(0, 7)}-01`, end: today };
  }
}

export const isWorkforceEmployee = (e: any) =>
  String(e?.status || '').toUpperCase() === 'ACTIVE' && normalizeRole(typeof e?.role === 'string' ? e.role : e?.role?.name) !== 'ADMIN';

export interface AttendanceStatsInput {
  employees: any[];      // { id, status, role:{name}|string, departments:{name} }
  attendance: any[];     // { employee_id, attendance_date, clock_in_at }
  leaves: any[];         // APPROVED: { employee_id, start_date, end_date, is_half_day }
  wfh?: any[];           // APPROVED: { employee_id, request_date }
  startDate: string;
  endDate: string;
  today: string;
  workingDays: string[]; // e.g. ['Monday', ...] from app settings
}

export interface AttendanceStats {
  workforce: number;
  expectedDays: number;
  presentDays: number;
  leaveDays: number;
  absentDays: number;
  wfhPresentDays: number; // present employee-days covered by an approved WFH request
  rate: number | null;   // 0..100, null when nothing was expected
  trend: { date: string; label: string; val: number }[];
  departments: { dept: string; val: number }[];
  /** Employee-days behind the numbers above (for card detail views): PRESENT / ABSENT are the expected days, LEAVE the full-day leave days */
  days: { employee_id: string; date: string; outcome: 'PRESENT' | 'ABSENT' | 'LEAVE'; wfh: boolean }[];
}

export function computeAttendanceStats(input: AttendanceStatsInput): AttendanceStats {
  const workforce = input.employees.filter(isWorkforceEmployee);
  const working = new Set((input.workingDays || []).map(d => d.toLowerCase()));
  const last = input.endDate < input.today ? input.endDate : input.today;

  const present = new Set<string>();
  for (const a of input.attendance || []) {
    if (a?.clock_in_at && a.employee_id && a.attendance_date) present.add(`${a.employee_id}|${String(a.attendance_date).slice(0, 10)}`);
  }
  const fullLeave = (empId: string, date: string) => (input.leaves || []).some(l =>
    l.employee_id === empId && !l.is_half_day && l.start_date <= date && l.end_date >= date);

  const wfhDays = new Set((input.wfh || []).map(w => `${w.employee_id}|${String(w.request_date).slice(0, 10)}`));
  let expectedDays = 0, presentDays = 0, leaveDays = 0, wfhPresentDays = 0;
  const daily: Record<string, { expected: number; present: number }> = {};
  const dept: Record<string, { expected: number; present: number }> = {};
  const days: AttendanceStats['days'] = [];

  for (let date = input.startDate; date <= last; date = addDays(date, 1)) {
    const isWorkingDay = working.has(weekdayName(date).toLowerCase());
    for (const e of workforce) {
      const wasPresent = present.has(`${e.id}|${date}`);
      let expected = false;
      if (wasPresent) expected = true;
      else if (isWorkingDay) {
        if (fullLeave(e.id, date)) { leaveDays++; days.push({ employee_id: e.id, date, outcome: 'LEAVE', wfh: false }); }
        else expected = true;
      }
      if (!expected) continue;
      expectedDays++;
      if (wasPresent) presentDays++;
      if (wasPresent && wfhDays.has(`${e.id}|${date}`)) wfhPresentDays++;
      days.push({ employee_id: e.id, date, outcome: wasPresent ? 'PRESENT' : 'ABSENT', wfh: wasPresent && wfhDays.has(`${e.id}|${date}`) });
      (daily[date] ||= { expected: 0, present: 0 }).expected++;
      if (wasPresent) daily[date].present++;
      const dn = e?.departments?.name || 'Unassigned';
      (dept[dn] ||= { expected: 0, present: 0 }).expected++;
      if (wasPresent) dept[dn].present++;
    }
  }

  const pct = (p: number, t: number) => (t > 0 ? Math.round((p / t) * 1000) / 10 : 0);
  const trend = Object.keys(daily).sort().slice(-5).map(date => ({
    date, label: weekdayName(date).slice(0, 3), val: Math.round(pct(daily[date].present, daily[date].expected)),
  }));
  const departments = Object.keys(dept).sort().map(d => ({ dept: d, val: Math.round(pct(dept[d].present, dept[d].expected)) }));

  return {
    workforce: workforce.length,
    expectedDays, presentDays, leaveDays,
    absentDays: Math.max(0, expectedDays - presentDays),
    wfhPresentDays,
    rate: expectedDays > 0 ? pct(presentDays, expectedDays) : null,
    trend, departments, days,
  };
}

/**
 * Average required (scheduled) minutes per attended shift in the range: the attendance
 * row's own required_hours when set, otherwise its shift template. null = unknown.
 */
export function averageRequiredMinutes(rows: any[]): number | null {
  let total = 0, n = 0;
  for (const r of rows || []) {
    if (!r?.clock_in_at) continue;
    const own = typeof r.required_hours === 'number' ? r.required_hours : parseFloat(r.required_hours);
    const mins = own > 0 ? Math.round(own * 60) : scheduledWorkMinutes(r.shift_templates || null);
    if (mins && mins > 0) { total += mins; n++; }
  }
  return n > 0 ? Math.round(total / n) : null;
}
