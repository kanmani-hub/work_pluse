import { describe, it, expect } from 'vitest';
import {
  TRACKING_STALE_MINUTES, resolveStaleMinutes, freshnessTimes, isFresh, trackingApplicability, latestProblemByEmployee,
  deriveTracking, trackingSummary, formatTrackingTime, CLOCK_DIFFERENCE_NOTE_MINUTES,
} from './trackingStatus';
import { LIVE_STALE_MINUTES } from './liveTrackingRules';
import { buildLiveTrackingRows } from './liveTrackingRules';
import { buildBreakReportRows } from '../attendance/breakReportRules';

// Shared tracking status (Break Management + Live Tracking). Synthetic data only.
const TODAY = '2026-10-14', YDAY = '2026-10-13';
const ist = (d: string, hhmm: string) => new Date(`${d}T${hhmm}:00+05:30`).toISOString();
const NOW = Date.parse(ist(TODAY, '17:05'));
const before = (m: number) => new Date(NOW - m * 60000).toISOString();
const fmt = (iso: string | null) => formatTrackingTime(iso, NOW);
const open = { clock_in_at: ist(TODAY, '09:00'), clock_out_at: null };

describe('threshold', () => {
  it('defaults to the Live Tracking value (15 min) and is configurable within 5–120', () => {
    expect(TRACKING_STALE_MINUTES).toBe(LIVE_STALE_MINUTES);
    expect(resolveStaleMinutes(undefined)).toBe(15);
    expect(resolveStaleMinutes('abc')).toBe(15);
    expect(resolveStaleMinutes(30)).toBe(30);
    expect(resolveStaleMinutes('45')).toBe(45);
    expect(resolveStaleMinutes(1)).toBe(5);
    expect(resolveStaleMinutes(999)).toBe(120);
  });

  it('is applied to the actual timestamp: 15 min is fresh, 16 min is not; a 30-min setting moves the line', () => {
    expect(isFresh(before(15), NOW)).toBe(true);
    expect(isFresh(before(16), NOW)).toBe(false);
    expect(isFresh(before(25), NOW, 30)).toBe(true);
    expect(isFresh(before(31), NOW, 30)).toBe(false);
  });

  it('missing or unreadable times are never fresh', () => {
    expect(isFresh(null, NOW)).toBe(false);
    expect(isFresh('not a date', NOW)).toBe(false);
    expect(isFresh(undefined, NaN)).toBe(false);
  });
});

describe('device time vs server time', () => {
  it('uses the earlier of last_seen_at (device) and updated_at (server)', () => {
    expect(freshnessTimes({ last_seen_at: before(3), updated_at: before(2) }).freshAt).toBe(before(3));
    expect(freshnessTimes({ last_seen_at: before(0), updated_at: before(20) }).freshAt).toBe(before(20));
    expect(freshnessTimes({ last_seen_at: null, updated_at: before(4) }).freshAt).toBe(before(4));
    expect(freshnessTimes({ last_seen_at: 'x', updated_at: null }).freshAt).toBeNull();
  });

  it('a phone clock running fast cannot keep an employee "live": the server time makes it stale', () => {
    const live = { last_seen_at: new Date(NOW + 60 * 60000).toISOString(), updated_at: before(40), location_status: 'INSIDE_GEOFENCE' };
    const t = deriveTracking({ applicable: true, loaded: true, live, problem: null, nowMs: NOW });
    expect(t.state).toBe('STALE');
  });

  it('a reading delivered late is not fresh, and the difference is explained without guessing the cause', () => {
    const live = { last_seen_at: before(40), updated_at: before(1), location_status: 'OUTSIDE_GEOFENCE' };
    const t = deriveTracking({ applicable: true, loaded: true, live, problem: null, nowMs: NOW });
    expect(t.state).toBe('STALE');
    const s = trackingSummary(t, NOW, fmt);
    expect(s.detail).toMatch(new RegExp(`differ by about 39 min`));
    expect(s.detail).toMatch(/sent late, or the device clock is off/);
    expect(CLOCK_DIFFERENCE_NOTE_MINUTES).toBe(5);
  });

  it('small differences (normal upload delay) are not mentioned', () => {
    const t = deriveTracking({ applicable: true, loaded: true, live: { last_seen_at: before(3), updated_at: before(2) }, problem: null, nowMs: NOW });
    expect(trackingSummary(t, NOW, fmt).detail).not.toMatch(/differ by/);
  });
});

describe('when tracking applies (and why not)', () => {
  it('open attendance today → tracked; otherwise an explicit reason', () => {
    expect(trackingApplicability(open, TODAY, TODAY)).toBe(true);
    expect(trackingApplicability({ ...open, clock_out_at: ist(TODAY, '18:00') }, TODAY, TODAY)).toBe('CLOCKED_OUT');
    expect(trackingApplicability(null, TODAY, TODAY)).toBe('NO_ATTENDANCE');
    expect(trackingApplicability({ clock_in_at: null }, TODAY, TODAY)).toBe('NOT_CLOCKED_IN');
    expect(trackingApplicability(null, YDAY, TODAY)).toBe('PAST_DATE');
  });

  it('an overnight shift from yesterday that is still open after midnight is tracked; a normal one is not', () => {
    const overnight = { clock_in_at: ist(YDAY, '22:00'), clock_out_at: null, shift_template: { crosses_midnight: true } };
    expect(trackingApplicability(overnight, YDAY, TODAY)).toBe(true);
    expect(trackingApplicability({ ...overnight, shift_template: { crosses_midnight: false } }, YDAY, TODAY)).toBe('PAST_DATE');
    expect(trackingApplicability(overnight, '2026-10-12', TODAY)).toBe('PAST_DATE');
  });

  it('not-tracked rows say why instead of showing a dash', () => {
    const labels = (['NO_ATTENDANCE', 'NOT_CLOCKED_IN', 'CLOCKED_OUT', 'PAST_DATE'] as const)
      .map(r => trackingSummary(deriveTracking({ applicable: r, loaded: true, live: null, problem: null, nowMs: NOW }), NOW, fmt).label);
    expect(labels).toEqual(['Not clocked in', 'Not clocked in', 'Clocked out', 'Past date']);
    expect(labels.every(l => l !== '—' && l.length > 3)).toBe(true);
  });
});

describe('company time zone and day boundary', () => {
  it('times are shown in IST; the date is added when it is not today', () => {
    expect(formatTrackingTime(ist(TODAY, '14:55'), NOW)).toBe('02:55 PM');
    expect(formatTrackingTime(ist(YDAY, '14:55'), NOW)).toBe('13 Oct, 02:55 PM');
    expect(formatTrackingTime(null, NOW)).toBe('—');
    expect(formatTrackingTime('garbage', NOW)).toBe('—');
  });

  it('00:30 IST is "today" even though it is still the previous day in UTC', () => {
    const justAfterMidnight = '2026-10-13T19:00:00.000Z';   // 14 Oct 00:30 IST
    const justBefore = '2026-10-13T18:00:00.000Z';          // 13 Oct 23:30 IST
    expect(formatTrackingTime(justAfterMidnight, NOW)).toBe('12:30 AM');
    expect(formatTrackingTime(justBefore, NOW)).toBe('13 Oct, 11:30 PM');
  });

  it('a stale location from yesterday is labelled with its date (no silent "02:55 PM")', () => {
    const t = deriveTracking({ applicable: true, loaded: true, live: { last_seen_at: ist(YDAY, '14:55'), location_status: 'INSIDE_GEOFENCE' }, problem: null, nowMs: NOW });
    expect(t.state).toBe('STALE');
    expect(trackingSummary(t, NOW, fmt).detail).toMatch(/Last update 13 Oct, 02:55 PM/);
  });
});

describe('failed location checks', () => {
  it('keeps the newest failed check per employee, with the device message', () => {
    const m = latestProblemByEmployee([
      { employee_id: 'e1', result: 'LOCATION_UNAVAILABLE', verified_at: before(10), failure_reason: 'Position unavailable' },
      { employee_id: 'e1', result: 'LOCATION_DENIED', verified_at: before(2), failure_reason: 'User denied Geolocation' },
      { employee_id: 'e1', result: 'INSIDE', verified_at: before(1) },
    ]);
    expect(m.get('e1')).toEqual({ result: 'LOCATION_DENIED', at: before(2), reason: 'User denied Geolocation' });
  });

  it('permission denied, timeout and unavailable are distinct; a timeout is not called "GPS off"', () => {
    const p = (result: string, reason: string | null) => trackingSummary(
      deriveTracking({ applicable: true, loaded: true, live: { last_seen_at: before(30), location_status: 'INSIDE_GEOFENCE' }, problem: { result, at: before(2), reason }, nowMs: NOW }), NOW, fmt);
    expect(p('LOCATION_DENIED', 'User denied Geolocation')).toMatchObject({ tone: 'permission', label: 'Location off' });
    const timeout = p('LOCATION_UNAVAILABLE', 'Timeout expired');
    expect(timeout).toMatchObject({ tone: 'unavailable', label: 'Timed out' });
    expect(timeout.detail).toMatch(/does not by itself mean location is switched off/);
    expect(p('LOCATION_UNAVAILABLE', 'Position unavailable')).toMatchObject({ label: 'Unavailable' });
    expect(p('LOW_ACCURACY', null)).toMatchObject({ label: 'Low accuracy' });
  });

  it('an older failed check does not hide a newer good fix', () => {
    const t = deriveTracking({ applicable: true, loaded: true, live: { last_seen_at: before(1) }, problem: { result: 'LOCATION_DENIED', at: before(5) }, nowMs: NOW });
    expect(t.state).toBe('LIVE');
  });

  it('no location record, and live locations that could not be loaded, are different states', () => {
    expect(deriveTracking({ applicable: true, loaded: true, live: null, problem: null, nowMs: NOW }).state).toBe('NO_DATA');
    expect(deriveTracking({ applicable: true, loaded: false, live: null, problem: null, nowMs: NOW }).state).toBe('UNKNOWN');
  });
});

describe('Break Management and Live Tracking agree', () => {
  const employees = ['e1', 'e2', 'e3', 'e4', 'e5'].map(id => ({ id, employee_code: id.toUpperCase(), first_name: id, last_name: 'X', status: 'ACTIVE', role: { name: 'Employee' }, offices: null }));
  const attendance = employees.map(e => ({
    id: `a-${e.id}`, employee_id: e.id, attendance_date: TODAY, status: 'WORKING', clock_in_at: ist(TODAY, '09:00'), clock_out_at: e.id === 'e5' ? ist(TODAY, '16:00') : null,
    shift_template: { name: 'General', break_duration_minutes: 60, crosses_midnight: false, start_time: '09:00:00', end_time: '18:00:00' }, employees: e, attendance_breaks: [],
  }));
  const liveLocations = [
    { id: 'l1', employee_id: 'e1', last_seen_at: before(2), updated_at: before(2), location_status: 'INSIDE_GEOFENCE' },
    { id: 'l2', employee_id: 'e2', last_seen_at: before(40), updated_at: before(40), location_status: 'OUTSIDE_GEOFENCE' },
    { id: 'l3', employee_id: 'e3', last_seen_at: before(30), updated_at: before(30), location_status: 'INSIDE_GEOFENCE' },
    { id: 'l5', employee_id: 'e5', last_seen_at: before(70), updated_at: before(70), location_status: 'INSIDE_GEOFENCE' },
  ];
  const locationProblems = [{ employee_id: 'e3', result: 'LOCATION_DENIED', verified_at: before(5), failure_reason: 'denied' }];

  it('same employee, same data → same state and wording on both pages', () => {
    const breakRows = buildBreakReportRows({ date: TODAY, today: TODAY, nowMs: NOW, settingBreakMins: 60, attendanceRows: attendance, employees, liveLocations, locationProblems });
    const liveRows = buildLiveTrackingRows({ today: TODAY, yesterday: YDAY, employees, liveLocations, attendance, breaks: [], wfhToday: [], shiftAssignments: [], locationProblems }, NOW);
    for (const id of ['e1', 'e2', 'e3', 'e4', 'e5']) {
      const b = breakRows.find(r => r.employeeId === id)!.tracking;
      const l = liveRows.find((r: any) => r.employeeId === id)!.tracking;
      expect(l.state, id).toBe(b.state);
      expect(trackingSummary(l, NOW, fmt).label, id).toBe(trackingSummary(b, NOW, fmt).label);
    }
    const state = (id: string) => breakRows.find(r => r.employeeId === id)!.tracking.state;
    expect(['e1', 'e2', 'e3', 'e4', 'e5'].map(state)).toEqual(['LIVE', 'STALE', 'LOCATION_PROBLEM', 'NO_DATA', 'NOT_APPLICABLE']);
  });

  it('the same configured threshold applies on both pages', () => {
    const breakRows = buildBreakReportRows({ date: TODAY, today: TODAY, nowMs: NOW, settingBreakMins: 60, attendanceRows: attendance, employees, liveLocations, locationProblems: [], staleMinutes: 45 });
    const liveRows = buildLiveTrackingRows({ today: TODAY, yesterday: YDAY, employees, liveLocations, attendance, breaks: [], wfhToday: [], shiftAssignments: [], locationProblems: [], staleMinutes: 45 }, NOW);
    expect(breakRows.find(r => r.employeeId === 'e2')!.tracking.state).toBe('LIVE');
    expect(liveRows.find((r: any) => r.employeeId === 'e2')!.tracking.state).toBe('LIVE');
  });
});
