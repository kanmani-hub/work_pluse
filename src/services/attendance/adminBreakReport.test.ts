import { describe, it, expect, vi, beforeEach } from 'vitest';
import { breakService } from './breakService';
import { summarizeBreakDay, matchesBreakFilter } from './breakSummaryRules';
import { buildBreakReportRows, matchesReportFilter, trackingLabel } from './breakReportRules';

// Admin → Break Management: what the page fetches and how it turns rows into per-employee totals.
// Synthetic data only (EMP-A / EMP-B / EMP-C), shaped like the PostgREST response of getBreakReport.
const calls: { table: string; select: string; filters: string[]; orders: string[]; limits: number[] }[] = [];
let response: { data: any; error: any } = { data: [], error: null };
let byTable: Record<string, { data: any; error: any }> = {};

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const c = { table, select: '', filters: [] as string[], orders: [] as string[], limits: [] as number[] };
      calls.push(c);
      const b: any = {
        select: (s: string) => { c.select = s.replace(/\s+/g, ' ').trim(); return b; },
        eq: (col: string, v: any) => { c.filters.push(`${col}=${v}`); return b; },
        in: (col: string) => { c.filters.push(`${col} in (...)`); return b; },
        gte: (col: string, v: any) => { c.filters.push(`${col}>=${v}`); return b; },
        lt: (col: string, v: any) => { c.filters.push(`${col}<${v}`); return b; },
        is: (col: string, v: any) => { c.filters.push(`${col} is ${v}`); return b; },
        order: (col: string) => { c.orders.push(col); return b; },
        limit: (n: number) => { c.limits.push(n); return b; },
        range: (a: number, z: number) => { c.limits.push(z - a + 1); return b; },
        then: (res: any, rej: any) => Promise.resolve(byTable[table] ?? response).then(res, rej),
      };
      return b;
    },
  },
}));
vi.mock('./attendanceService', () => ({ attendanceService: { getCurrentEmployeeId: vi.fn() } }));
vi.mock('../audit/auditService', () => ({ auditService: { recordAuditLog: vi.fn(async () => ({})) } }));
vi.mock('../notifications/notificationService', () => ({ notificationService: { notifyEmployee: vi.fn() } }));
vi.mock('../qa/qaTimeService', () => ({ qaTimeService: { isEnabled: false, getIsoString: () => new Date().toISOString(), now: () => Date.now() } }));

beforeEach(() => { calls.length = 0; response = { data: [], error: null }; byTable = {}; });

describe('getBreakReport fetches every employee for the date', () => {
  it('one attendance query filtered ONLY by attendance_date (no employee / admin filter, no limit, no single())', async () => {
    await breakService.getBreakReport('2026-10-14');
    expect(calls).toHaveLength(1);
    expect(calls[0].table).toBe('attendance');
    expect(calls[0].filters).toEqual(['attendance_date=2026-10-14']);
    expect(calls[0].limits).toEqual([]);
    expect(calls[0].select).toContain('attendance_breaks(*)');
    expect(calls[0].select).toContain('employees:employee_id(');
    // the stored payroll values are fetched so the page can show them next to the live total
    expect(calls[0].select).toContain('break_minutes');
    expect(calls[0].select).toContain('break_overrun_minutes');
  });

  it('a query error is returned as an error (the page shows "could not be loaded", not zeros)', async () => {
    response = { data: null, error: { message: 'permission denied for table attendance' } };
    const r = await breakService.getBreakReport('2026-10-14');
    expect(r.data).toBeNull();
    expect(r.error?.message).toMatch(/permission denied/);
  });
});

describe('the page totals come from each employee\'s own break rows', () => {
  // 14 Oct 2026, 17:05 IST
  const NOW = Date.parse('2026-10-14T11:35:00Z');
  const ist = (hhmm: string) => new Date(`2026-10-14T${hhmm}:00+05:30`).toISOString();
  const day = (id: string, breaks: any[], allowance: number | null) => ({
    id, attendance_date: '2026-10-14', clock_in_at: ist('09:00'), clock_out_at: null,
    shift_template: { break_duration_minutes: allowance }, attendance_breaks: breaks,
  });

  it('reproduces the screenshot pattern: A open 265 min of 80 → 185 excess, B 50 min within, C nothing recorded', () => {
    const A = day('A', [{ id: 'a1', break_type: 'AUTO_GPS', started_at: ist('12:40'), ended_at: null }], 80);
    const B = day('B', [{ id: 'b1', break_type: 'AUTO_GPS', started_at: ist('13:00'), ended_at: ist('13:50'), duration_minutes: 50 }], 80);
    const C = day('C', [], 80);
    const [a, b, c] = [A, B, C].map(x => summarizeBreakDay(x, null, NOW));
    expect(a).toMatchObject({ totalMins: 265, activeMins: 265, allowedMins: 80, excessMins: 185, status: 'ON_BREAK', activeCount: 1 });
    expect(a.sessions).toHaveLength(1);
    expect(b).toMatchObject({ totalMins: 50, excessMins: 0, status: 'WITHIN' });
    expect(c).toMatchObject({ totalMins: 0, status: 'NO_BREAKS' });
    expect(c.sessions).toHaveLength(0);
  });

  it('an open break keeps growing with the clock (it is not a stored value)', () => {
    const A = day('A', [{ id: 'a1', break_type: 'AUTO_GPS', started_at: ist('12:40'), ended_at: null }], 80);
    expect(summarizeBreakDay(A, null, NOW).totalMins).toBe(265);
    expect(summarizeBreakDay(A, null, NOW + 30 * 60_000).totalMins).toBe(295);
  });

  it('"0 min / No Breaks Recorded" only when the break list was returned empty', () => {
    expect(summarizeBreakDay(day('C', [], 80), null, NOW).status).toBe('NO_BREAKS');
  });

  it('break list missing from the response → UNVERIFIED (not "No Breaks Recorded")', () => {
    for (const missing of [undefined, null]) {
      const s = summarizeBreakDay({ ...day('C', [], 80), attendance_breaks: missing } as any, null, NOW);
      expect(s).toMatchObject({ status: 'UNVERIFIED', breaksUnavailable: true, totalMins: 0, excessMins: null });
      expect(s.notes[0]).toMatch(/not returned/);
    }
  });

  it('a break attached to a different attendance day is not shown on this date', () => {
    // the page groups by attendance row; a break belongs to the attendance whose id it carries
    const today = day('T', [], 80);
    expect(summarizeBreakDay(today, null, NOW).totalMins).toBe(0);
  });

  it('allowance comes from the shift, else the setting; none configured → excess unknown (—)', () => {
    const noShift = { ...day('X', [{ id: 'x', started_at: ist('13:00'), ended_at: ist('14:00') }], null) };
    expect(summarizeBreakDay(noShift, 80, NOW)).toMatchObject({ allowedMins: 80, excessMins: 0 });
    expect(summarizeBreakDay(noShift, null, NOW)).toMatchObject({ allowedMins: null, excessMins: null, status: 'UNVERIFIED' });
  });

  it('status filter: "Within Limit" also lists employees with no breaks', () => {
    expect(matchesBreakFilter('NO_BREAKS', 'WITHIN')).toBe(true);
    expect(matchesBreakFilter('NO_BREAKS', 'NO_BREAKS')).toBe(true);
    expect(matchesBreakFilter('ON_BREAK', 'WITHIN')).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// Report rows: every relevant employee, live vs stored minutes, tracking freshness
// ---------------------------------------------------------------------------------------------
describe('getBreakReportContext loads employees and tracking, each part with its own error', () => {
  it('today: employees, live locations and failed location checks for the IST day', async () => {
    byTable = {
      employees: { data: [{ id: 'e1' }], error: null },
      employee_live_locations: { data: [{ employee_id: 'e1' }], error: null },
      location_verification_events: { data: [], error: null },
    };
    const r = await breakService.getBreakReportContext('2026-10-14', true);
    expect(r.errors).toEqual([]);
    expect(r.employees).toHaveLength(1);
    expect(r.liveLocations).toHaveLength(1);
    const ev = calls.find(c => c.table === 'location_verification_events')!;
    expect(ev.filters).toContain('verified_at>=2026-10-13T18:30:00.000Z'); // 00:00 IST
    expect(ev.filters).toContain('result in (...)');
  });

  it('past date: tracking is not loaded (not applicable), only employees', async () => {
    const r = await breakService.getBreakReportContext('2026-10-10', false);
    expect(calls.map(c => c.table)).toEqual(['employees', 'attendance_events']);
    expect(r.liveLocations).toBeNull();
    const ev = calls.find(c => c.table === 'attendance_events')!;
    // 00:00 IST on the date, up to 2 days later (overnight shifts end the next day)
    expect(ev.filters).toEqual(['event_type=BREAK_END', 'event_at>=2026-10-09T18:30:00.000Z', 'event_at<2026-10-11T18:30:00.000Z']);
  });

  it('a failed part is reported and returned as null (never as an empty list)', async () => {
    byTable = {
      employees: { data: null, error: { message: 'permission denied for table employees' } },
      employee_live_locations: { data: null, error: { message: 'timeout' } },
      location_verification_events: { data: [], error: null },
    };
    const r = await breakService.getBreakReportContext('2026-10-14', true);
    expect(r.employees).toBeNull();
    expect(r.liveLocations).toBeNull();
    expect(r.errors).toHaveLength(2);
    expect(r.errors[0]).toMatch(/employees without attendance are not listed/);
  });
});

describe('buildBreakReportRows: the 14-10-2026 screenshot, with everyone listed', () => {
  const DATE = '2026-10-14';
  const NOW = Date.parse('2026-10-14T11:35:00Z');           // 17:05 IST
  const ist = (hhmm: string, d = DATE) => new Date(`${d}T${hhmm}:00+05:30`).toISOString();
  const emp = (id: string, extra: any = {}) => ({ id, employee_code: id.toUpperCase(), first_name: id, last_name: 'X', status: 'ACTIVE', role: { name: 'Employee' }, ...extra });
  const attRow = (id: string, empId: string, breaks: any, extra: any = {}) => ({
    id, employee_id: empId, attendance_date: DATE, clock_in_at: ist('09:00'), clock_out_at: null, break_minutes: 0, break_overrun_minutes: 0,
    shift_template: { name: 'General Shift', break_duration_minutes: 80 }, employees: emp(empId), attendance_breaks: breaks, ...extra,
  });
  const live = (empId: string, lastSeenIst: string, status = 'INSIDE_GEOFENCE') => ({ employee_id: empId, location_status: status, last_seen_at: ist(lastSeenIst) });

  const base = () => ({
    date: DATE, today: DATE, nowMs: NOW, settingBreakMins: 60,
    attendanceRows: [
      // A: Anish-like — AUTO_GPS break open since 12:40, phone stopped reporting at 12:41
      attRow('attA', 'empA', [{ id: 'a1', break_type: 'AUTO_GPS', started_at: ist('12:40'), ended_at: null }]),
      // B: Hemanath-like — one completed 50-minute break, stored total already written
      attRow('attB', 'empB', [{ id: 'b1', break_type: 'AUTO_GPS', started_at: ist('13:00'), ended_at: ist('13:50'), duration_minutes: 50 }], { break_minutes: 50 }),
      // C: clocked in, no break rows, phone reporting
      attRow('attC', 'empC', []),
      // D: two completed sessions, 45 + 50 = 95 > 80
      attRow('attD', 'empD', [
        { id: 'd1', break_type: 'REGULAR', started_at: ist('11:00'), ended_at: ist('11:45'), duration_minutes: 45 },
        { id: 'd2', break_type: 'AUTO_GPS', started_at: ist('14:00'), ended_at: ist('14:50'), duration_minutes: 50 },
      ], { break_minutes: 95, break_overrun_minutes: 15 }),
    ],
    employees: [emp('empA'), emp('empB'), emp('empC'), emp('empD'), emp('empE'), emp('empF', { status: 'INACTIVE' }), emp('adm', { role: { name: 'Admin' } }), emp('empNew', { joining_date: '2026-10-20' })],
    liveLocations: [live('empA', '12:41', 'OUTSIDE_GEOFENCE'), live('empB', '17:04'), live('empC', '17:04'), live('empD', '17:03')] as any[],
    locationProblems: [] as any[],
  });

  it('A 265 live / 80 allowed / 185 excess, in progress; stored payroll value still 0 and marked as updating at break end', () => {
    const a = buildBreakReportRows(base()).find(r => r.employeeId === 'empA')!;
    expect(a.status).toBe('ON_BREAK');
    expect(a.summary).toMatchObject({ totalMins: 265, allowedMins: 80, excessMins: 185, activeCount: 1 });
    expect(a.summary!.sessions).toHaveLength(1);
    expect(a).toMatchObject({ firstStartAt: ist('12:40'), lastEndAt: null, storedBreakMins: 0, storedDiffers: false });
  });

  it("A's phone stopped reporting at 12:41 → tracking STALE, last known outside (never invented as a return)", () => {
    const a = buildBreakReportRows(base()).find(r => r.employeeId === 'empA')!;
    expect(a.tracking).toMatchObject({ state: 'STALE', lastSeenAt: ist('12:41'), locationStatus: 'OUTSIDE_GEOFENCE' });
    const label = trackingLabel(a.tracking, iso => (iso ? new Date(iso).toISOString().slice(11, 16) : '—'));
    expect(label).toMatch(/^No update since 07:11/);   // 12:41 IST = 07:11Z
    expect(label).toMatch(/outside office/);
  });

  it('B completed 50 min within 80, stored 50 matches; C clocked in with no breaks; D two sessions 95 → 15 excess', () => {
    const rows = buildBreakReportRows(base());
    const by = (id: string) => rows.find(r => r.employeeId === id)!;
    expect(by('empB')).toMatchObject({ status: 'WITHIN', storedBreakMins: 50, storedDiffers: false, firstStartAt: ist('13:00'), lastEndAt: ist('13:50') });
    expect(by('empB').summary).toMatchObject({ totalMins: 50, excessMins: 0 });
    expect(by('empB').tracking.state).toBe('LIVE');
    expect(by('empC')).toMatchObject({ status: 'NO_BREAKS', storedBreakMins: 0 });
    expect(by('empC').summary!.totalMins).toBe(0);
    expect(by('empD').summary).toMatchObject({ totalMins: 95, excessMins: 15 });
    expect(by('empD')).toMatchObject({ status: 'EXCESS', firstStartAt: ist('11:00'), lastEndAt: ist('14:50') });
  });

  it('every active non-admin employee is listed: E (no attendance) appears; inactive, admin and not-yet-joined do not', () => {
    const rows = buildBreakReportRows(base());
    expect(rows.map(r => r.employeeId)).toEqual(['empA', 'empB', 'empC', 'empD', 'empE']);
    const e = rows.find(r => r.employeeId === 'empE')!;
    expect(e).toMatchObject({ status: 'NO_ATTENDANCE', attendanceId: null, summary: null, storedBreakMins: null });
    expect(e.tracking.state).toBe('NOT_APPLICABLE');
  });

  it('each row uses its own employee and attendance (no cross-over)', () => {
    const rows = buildBreakReportRows(base());
    rows.filter(r => r.attendanceId).forEach(r => {
      expect(r.attendance.employee_id).toBe(r.employeeId);
      expect(r.employee.id).toBe(r.employeeId);
      r.summary!.sessions.forEach(s => expect(s.id?.[0]).toBe(r.employeeId.slice(-1).toLowerCase()));
    });
  });

  it('the open break keeps growing on screen while the stored value does not change', () => {
    const later = buildBreakReportRows({ ...base(), nowMs: NOW + 30 * 60_000 }).find(r => r.employeeId === 'empA')!;
    expect(later.summary!.totalMins).toBe(295);
    expect(later.storedBreakMins).toBe(0);
  });

  it('stored total that disagrees with completed sessions is flagged (nothing open or invalid)', () => {
    const input = base();
    input.attendanceRows[1].break_minutes = 20; // e.g. totals write failed earlier
    const b = buildBreakReportRows(input).find(r => r.employeeId === 'empB')!;
    expect(b.storedDiffers).toBe(true);
  });

  it('break list missing for one row → that row is UNVERIFIED, others unaffected', () => {
    const input = base();
    (input.attendanceRows[2] as any).attendance_breaks = undefined;
    const rows = buildBreakReportRows(input);
    expect(rows.find(r => r.employeeId === 'empC')).toMatchObject({ status: 'UNVERIFIED' });
    expect(rows.find(r => r.employeeId === 'empC')!.summary!.breaksUnavailable).toBe(true);
    expect(rows.find(r => r.employeeId === 'empB')!.status).toBe('WITHIN');
  });

  it('employee list could not be loaded → attendance rows still shown, no invented "No Attendance" rows', () => {
    const rows = buildBreakReportRows({ ...base(), employees: null });
    expect(rows.map(r => r.employeeId)).toEqual(['empA', 'empB', 'empC', 'empD']);
  });

  it('tracking: location problem newer than the last fix, no data, and could-not-load are distinct', () => {
    const input = base();
    input.locationProblems = [{ employee_id: 'empA', result: 'LOCATION_DENIED', verified_at: ist('12:45') }, { employee_id: 'empA', result: 'LOCATION_UNAVAILABLE', verified_at: ist('12:43') }];
    input.liveLocations = input.liveLocations.filter(l => l.employee_id !== 'empC');
    const rows = buildBreakReportRows(input);
    const a = rows.find(r => r.employeeId === 'empA')!;
    expect(a.tracking).toMatchObject({ state: 'LOCATION_PROBLEM', problem: { result: 'LOCATION_DENIED', at: ist('12:45') } });
    expect(trackingLabel(a.tracking, () => 'T')).toBe('Location permission denied at T · last valid location T');
    expect(rows.find(r => r.employeeId === 'empC')!.tracking.state).toBe('NO_DATA');
    const unknown = buildBreakReportRows({ ...base(), liveLocations: null }).find(r => r.employeeId === 'empA')!;
    expect(unknown.tracking.state).toBe('UNKNOWN');
  });

  it('a problem OLDER than the last good fix does not hide a live location', () => {
    const input = base();
    input.locationProblems = [{ employee_id: 'empB', result: 'LOCATION_UNAVAILABLE', verified_at: ist('16:00') }];
    expect(buildBreakReportRows(input).find(r => r.employeeId === 'empB')!.tracking.state).toBe('LIVE');
  });

  it('tracking is not applicable on a past date or after clock-out', () => {
    const past = buildBreakReportRows({ ...base(), today: '2026-10-15' });
    expect(past.every(r => r.tracking.state === 'NOT_APPLICABLE')).toBe(true);
    const input = base();
    input.attendanceRows[1].clock_out_at = ist('17:00');
    expect(buildBreakReportRows(input).find(r => r.employeeId === 'empB')!.tracking.state).toBe('NOT_APPLICABLE');
  });

  it('timezone boundary: a break taken late on 13-10 IST belongs to the 13th attendance and is not counted on 14-10', () => {
    // 13-10 23:30–23:50 IST = 13-10 18:00–18:20Z; the page asks for attendance_date = 2026-10-14, so
    // only 14th attendance rows (and their own breaks) are in the input.
    const lateBreak = { id: 'x', started_at: ist('23:30', '2026-10-13'), ended_at: ist('23:50', '2026-10-13'), break_type: 'REGULAR' };
    const day13 = attRow('att13', 'empC', [lateBreak], { attendance_date: '2026-10-13', clock_in_at: ist('15:00', '2026-10-13'), clock_out_at: ist('23:59', '2026-10-13') });
    const s = summarizeBreakDay(day13, 60, NOW);
    expect(s.totalMins).toBe(20);
    const rows14 = buildBreakReportRows(base());
    expect(rows14.find(r => r.employeeId === 'empC')!.summary!.totalMins).toBe(0);
  });

  it('filters: No Attendance only under All / No Attendance; Within Limit keeps No Breaks', () => {
    expect(matchesReportFilter('NO_ATTENDANCE', 'ALL')).toBe(true);
    expect(matchesReportFilter('NO_ATTENDANCE', 'NO_ATTENDANCE')).toBe(true);
    expect(matchesReportFilter('NO_ATTENDANCE', 'WITHIN')).toBe(false);
    expect(matchesReportFilter('NO_ATTENDANCE', 'NO_BREAKS')).toBe(false);
    expect(matchesReportFilter('NO_BREAKS', 'NO_ATTENDANCE')).toBe(false);
    expect(matchesReportFilter('NO_BREAKS', 'WITHIN')).toBe(true);
    expect(matchesReportFilter('ON_BREAK', 'ON_BREAK')).toBe(true);
  });
});

describe('context: break-end details and the API row limit', () => {
  it('break-end events failing → reported, returned as null (gap flags unknown, not "none")', async () => {
    byTable = { attendance_events: { data: null, error: { message: 'timeout' } } };
    const r = await breakService.getBreakReportContext('2026-10-14', false);
    expect(r.breakEndEvents).toBeNull();
    expect(r.errors.join(' ')).toMatch(/returns after a tracking gap are not flagged/);
  });
  it('1000 employees returned → warned as possibly truncated', async () => {
    byTable = { employees: { data: Array.from({ length: 1000 }, (_, i) => ({ id: `e${i}` })), error: null } };
    const r = await breakService.getBreakReportContext('2026-10-14', false);
    expect(r.errors.join(' ')).toMatch(/1000-row API limit/);
  });
});

describe('14-10-2026 synthetic scenario: real, missing, stale and incomplete data kept apart', () => {
  const DATE = '2026-10-14';
  const NOW = Date.parse('2026-10-14T11:35:00Z');           // 17:05 IST
  const ist = (hhmm: string) => new Date(`${DATE}T${hhmm}:00+05:30`).toISOString();
  const emp = (id: string) => ({ id, employee_code: id, first_name: id, last_name: 'T', status: 'ACTIVE', role: { name: 'Employee' } });
  const att = (id: string, empId: string, breaks: any, extra: any = {}) => ({
    id, employee_id: empId, attendance_date: DATE, clock_in_at: ist('09:00'), clock_out_at: null, break_minutes: 0, break_overrun_minutes: 0,
    shift_template: { name: 'General Shift', break_duration_minutes: 80 }, employees: emp(empId), attendance_breaks: breaks, ...extra,
  });
  const input = () => ({
    date: DATE, today: DATE, nowMs: NOW, settingBreakMins: 60,
    attendanceRows: [
      att('a-anish', 'ANISH', [{ id: 'br-anish', break_type: 'AUTO_GPS', started_at: ist('12:40'), ended_at: null }]),
      att('a-hema', 'HEMANATH', [{ id: 'br-hema', break_type: 'AUTO_GPS', started_at: ist('13:00'), ended_at: ist('13:50'), duration_minutes: 50 }], { break_minutes: 50 }),
      att('a-gps', 'GPSOFF', [{ id: 'br-gps', break_type: 'AUTO_GPS', started_at: ist('16:20'), ended_at: null }]),
      att('a-gap', 'GAPRET', [{ id: 'br-gap', break_type: 'AUTO_GPS', started_at: ist('11:00'), ended_at: ist('14:30'), duration_minutes: 210 }], { break_minutes: 210, break_overrun_minutes: 130 }),
      att('a-none1', 'NOBRK1', []),
      att('a-none2', 'NOBRK2', []),
      att('a-unver', 'UNVER', undefined),
    ],
    employees: ['ANISH', 'HEMANATH', 'GPSOFF', 'GAPRET', 'NOBRK1', 'NOBRK2', 'UNVER', 'ABSENT1', 'ABSENT2'].map(emp),
    liveLocations: [
      { employee_id: 'ANISH', location_status: 'OUTSIDE_GEOFENCE', last_seen_at: ist('12:41') },
      { employee_id: 'HEMANATH', location_status: 'INSIDE_GEOFENCE', last_seen_at: ist('17:04') },
      { employee_id: 'GPSOFF', location_status: 'OUTSIDE_GEOFENCE', last_seen_at: ist('16:30') },
      { employee_id: 'GAPRET', location_status: 'INSIDE_GEOFENCE', last_seen_at: ist('17:03') },
      { employee_id: 'NOBRK1', location_status: 'INSIDE_GEOFENCE', last_seen_at: ist('17:04') },
    ] as any[],
    locationProblems: [{ employee_id: 'GPSOFF', result: 'LOCATION_UNAVAILABLE', verified_at: ist('16:31') }] as any[],
    breakEndEvents: [{ attendance_id: 'a-gap', event_at: ist('14:30'), metadata: { break_id: 'br-gap', tracking_gap: true, last_seen_before_return: ist('11:01') } }] as any[],
  });
  const rows = () => buildBreakReportRows(input());
  const by = (id: string) => rows().find(r => r.employeeId === id)!;

  it('every employee is listed exactly once (7 with attendance + 2 without)', () => {
    expect(rows().map(r => r.employeeId)).toEqual(['ANISH', 'HEMANATH', 'GPSOFF', 'GAPRET', 'NOBRK1', 'NOBRK2', 'UNVER', 'ABSENT1', 'ABSENT2']);
  });
  it('Anish: active 265 / allowed 80 / excess 185, stored still 0, tracking stale since 12:41', () => {
    expect(by('ANISH')).toMatchObject({ status: 'ON_BREAK', storedBreakMins: 0, firstStartAt: ist('12:40'), lastEndAt: null });
    expect(by('ANISH').summary).toMatchObject({ totalMins: 265, activeMins: 265, completedMins: 0, allowedMins: 80, excessMins: 185 });
    expect(by('ANISH').tracking.state).toBe('STALE');
  });
  it('Hemanath: completed 50, within limit, stored 50 matches', () => {
    expect(by('HEMANATH')).toMatchObject({ status: 'WITHIN', storedBreakMins: 50, storedDiffers: false });
    expect(by('HEMANATH').summary).toMatchObject({ completedMins: 50, totalMins: 50, excessMins: 0 });
  });
  it('GPS off during an open break: break stays active (45 min, growing), tracking shows the GPS problem and last valid fix', () => {
    expect(by('GPSOFF').status).toBe('ON_BREAK');
    expect(by('GPSOFF').summary!.totalMins).toBe(45);
    expect(by('GPSOFF').tracking).toMatchObject({ state: 'LOCATION_PROBLEM', lastSeenAt: ist('16:30'), problem: { result: 'LOCATION_UNAVAILABLE' } });
    expect(trackingLabel(by('GPSOFF').tracking, iso => iso ?? '—')).toMatch(/Location unavailable .* last valid location /);
  });
  it('return after a tracking gap: completed break kept, flagged with the last location before the return', () => {
    expect(by('GAPRET')).toMatchObject({ status: 'EXCESS', gapReturns: { 'br-gap': ist('11:01') } });
    expect(by('GAPRET').summary).toMatchObject({ completedMins: 210, excessMins: 130 });
  });
  it('no break records vs no attendance vs break data not returned are three different states', () => {
    expect(by('NOBRK1').status).toBe('NO_BREAKS');
    expect(by('NOBRK2').status).toBe('NO_BREAKS');
    expect(by('NOBRK2').tracking.state).toBe('NO_DATA');           // clocked in, phone never reported
    expect(by('ABSENT1')).toMatchObject({ status: 'NO_ATTENDANCE', summary: null });
    expect(by('UNVER').status).toBe('UNVERIFIED');
    expect(by('UNVER').summary!.breaksUnavailable).toBe(true);
    expect(by('UNVER').summary!.excessMins).toBeNull();            // never a verified 0
  });
  it('break-end details unavailable → no gap flag is invented', () => {
    const r = buildBreakReportRows({ ...input(), breakEndEvents: null }).find(x => x.employeeId === 'GAPRET')!;
    expect(r.gapReturns).toEqual({});
  });
});
