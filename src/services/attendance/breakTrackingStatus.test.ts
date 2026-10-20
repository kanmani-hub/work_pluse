import { describe, it, expect } from 'vitest';
import {
  buildBreakReportRows, trackingFor, trackingSummary, minutesAgo, formatAge,
  TRACKING_STALE_MINUTES, type BreakReportTracking,
} from './breakReportRules';
import { LIVE_STALE_MINUTES } from '../location/liveTrackingRules';

// Admin → Break Management: compact tracking status. Synthetic data only.
const DATE = '2026-10-14';
const NOW = Date.parse('2026-10-14T11:35:00Z');            // 17:05 IST
const ist = (hhmm: string) => new Date(`${DATE}T${hhmm}:00+05:30`).toISOString();
const minsBefore = (m: number) => new Date(NOW - m * 60000).toISOString();
const fmt = (iso: string | null) => (iso ? new Date(iso).toISOString().slice(11, 16) : '—');
const input = { date: DATE, today: DATE, liveLocations: [] as any[], nowMs: NOW };
const openAttendance = { id: 'att1', employee_id: 'e1', attendance_date: DATE, clock_in_at: ist('09:00'), clock_out_at: null };
const live = (last_seen_at: any, location_status = 'INSIDE_GEOFENCE') => ({ employee_id: 'e1', last_seen_at, location_status });
const t = (over: Partial<BreakReportTracking>): BreakReportTracking => ({ state: 'LIVE', lastSeenAt: null, locationStatus: null, problem: null, ...over });

describe('staleness threshold', () => {
  it('is the documented Live Tracking threshold (15 minutes), not a separate number', () => {
    expect(TRACKING_STALE_MINUTES).toBe(LIVE_STALE_MINUTES);
    expect(TRACKING_STALE_MINUTES).toBe(15);
  });

  it('is measured from the actual last_seen_at: 15 min old is current, 16 min old is stale', () => {
    expect(trackingFor(input, openAttendance, live(minsBefore(15)), null).state).toBe('LIVE');
    expect(trackingFor(input, openAttendance, live(minsBefore(16)), null).state).toBe('STALE');
  });

  it('moves from current to stale as time passes, with no data change', () => {
    const row = live(minsBefore(10));
    expect(trackingFor(input, openAttendance, row, null).state).toBe('LIVE');
    expect(trackingFor({ ...input, nowMs: NOW + 10 * 60000 }, openAttendance, row, null).state).toBe('STALE');
  });
});

describe('missing and unreadable timestamps', () => {
  it('a location row with no last_seen_at is "not updating" without a time, never live', () => {
    const tr = trackingFor(input, openAttendance, live(null), null);
    expect(tr).toMatchObject({ state: 'STALE', lastSeenAt: null, locationStatus: 'INSIDE_GEOFENCE' });
    const s = trackingSummary(tr, NOW, fmt);
    expect(s).toMatchObject({ tone: 'stale', label: 'Not updating', at: null, ageMins: null });
    expect(s.detail).toMatch(/no readable update time/);
  });

  it('an unparseable last_seen_at is treated as missing (it used to be shown as live)', () => {
    const tr = trackingFor(input, openAttendance, live('not-a-date'), null);
    expect(tr.state).toBe('STALE');
    expect(tr.lastSeenAt).toBeNull();
  });

  it('an unreadable fix does not hide a newer location problem', () => {
    const tr = trackingFor(input, openAttendance, live('garbage'), { result: 'LOCATION_DENIED', at: minsBefore(3) });
    expect(tr.state).toBe('LOCATION_PROBLEM');
  });

  it('minutesAgo / formatAge handle missing, invalid and future times safely', () => {
    expect(minutesAgo(null, NOW)).toBeNull();
    expect(minutesAgo('nope', NOW)).toBeNull();
    expect(minutesAgo(minsBefore(42), NOW)).toBe(42);
    expect(minutesAgo(new Date(NOW + 5 * 60000).toISOString(), NOW)).toBe(0);   // device clock ahead
    expect(formatAge(null)).toBe('time not recorded');
    expect(formatAge(0)).toBe('just now');
    expect(formatAge(42)).toBe('42 min ago');
    expect(formatAge(125)).toBe('2 h 5 min ago');
    expect(formatAge(120)).toBe('2 h ago');
  });
});

describe('distinct states: current, stale, permission off, unavailable, no data, not loaded', () => {
  it('current: label, time, age and last known location', () => {
    const s = trackingSummary(t({ state: 'LIVE', lastSeenAt: minsBefore(2), locationStatus: 'INSIDE_GEOFENCE' }), NOW, fmt);
    expect(s).toMatchObject({ tone: 'current', label: 'Live', ageMins: 2, location: 'Inside office' });
    expect(s.detail).toMatch(/Location is updating/);
  });

  it('stale: says how long, the last known side, and does not claim the GPS is broken', () => {
    const s = trackingSummary(t({ state: 'STALE', lastSeenAt: minsBefore(40), locationStatus: 'OUTSIDE_GEOFENCE' }), NOW, fmt);
    expect(s).toMatchObject({ tone: 'stale', label: 'Not updating', ageMins: 40, location: 'Outside office' });
    expect(s.detail).toMatch(/more than 15 minutes/);
    expect(s.detail).toMatch(/reason is not known/);
    expect(s.detail).not.toMatch(/GPS is (broken|off)\b/);
  });

  it('permission denied is its own state ("Location off"), separate from unavailable', () => {
    const denied = trackingSummary(t({ state: 'LOCATION_PROBLEM', lastSeenAt: minsBefore(30), locationStatus: 'INSIDE_GEOFENCE', problem: { result: 'LOCATION_DENIED', at: minsBefore(5) } }), NOW, fmt);
    expect(denied).toMatchObject({ tone: 'permission', label: 'Location off', ageMins: 5 });
    expect(denied.detail).toMatch(/permission was denied/);
    expect(denied.detail).toMatch(/Last valid location/);
    const unavailable = trackingSummary(t({ state: 'LOCATION_PROBLEM', problem: { result: 'LOCATION_UNAVAILABLE', at: minsBefore(3) } }), NOW, fmt);
    expect(unavailable).toMatchObject({ tone: 'unavailable', label: 'Unavailable', location: 'Unknown' });
    expect(unavailable.detail).toMatch(/No valid location before that/);
    expect(trackingSummary(t({ state: 'LOCATION_PROBLEM', problem: { result: 'LOW_ACCURACY', at: minsBefore(1) } }), NOW, fmt).label).toBe('Low accuracy');
  });

  it('a problem with no readable time is still shown, without inventing one', () => {
    const s = trackingSummary(t({ state: 'LOCATION_PROBLEM', problem: { result: 'ERROR', at: '' } }), NOW, fmt);
    expect(s).toMatchObject({ tone: 'unavailable', at: null, ageMins: null });
    expect(s.detail).toMatch(/an unrecorded time/);
  });

  it('no data, not loaded and not applicable are distinct and never show a location', () => {
    expect(trackingSummary(t({ state: 'NO_DATA' }), NOW, fmt)).toMatchObject({ tone: 'no-data', label: 'No location', location: 'Unknown' });
    expect(trackingSummary(t({ state: 'UNKNOWN' }), NOW, fmt)).toMatchObject({ tone: 'unknown', label: 'Not loaded' });
    expect(trackingSummary(t({ state: 'NOT_APPLICABLE' }), NOW, fmt).tone).toBe('not-applicable');
  });

  it('every tone has its own wording (state is never conveyed by colour alone)', () => {
    const labels = [
      trackingSummary(t({ state: 'LIVE', lastSeenAt: minsBefore(1) }), NOW, fmt).label,
      trackingSummary(t({ state: 'STALE', lastSeenAt: minsBefore(30) }), NOW, fmt).label,
      trackingSummary(t({ state: 'LOCATION_PROBLEM', problem: { result: 'LOCATION_DENIED', at: minsBefore(1) } }), NOW, fmt).label,
      trackingSummary(t({ state: 'LOCATION_PROBLEM', problem: { result: 'LOCATION_UNAVAILABLE', at: minsBefore(1) } }), NOW, fmt).label,
      trackingSummary(t({ state: 'NO_DATA' }), NOW, fmt).label,
      trackingSummary(t({ state: 'UNKNOWN' }), NOW, fmt).label,
    ];
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe('report rows keep the same break numbers (display change only)', () => {
  it('break totals, excess and stored values are unchanged by the tracking state', () => {
    const att = { ...openAttendance, break_minutes: 0, shift_template: { name: 'General', break_duration_minutes: 60 }, employees: { first_name: 'A' },
      attendance_breaks: [{ id: 'b1', started_at: ist('16:00'), ended_at: null }] };
    const base = { date: DATE, today: DATE, nowMs: NOW, settingBreakMins: 60, attendanceRows: [att], employees: [], locationProblems: [] as any[] };
    const fresh = buildBreakReportRows({ ...base, liveLocations: [live(minsBefore(1))] })[0];
    const missing = buildBreakReportRows({ ...base, liveLocations: [live(null)] })[0];
    expect(fresh.summary).toMatchObject({ totalMins: 65, allowedMins: 60, excessMins: 5, activeCount: 1 });
    expect(missing.summary).toEqual(fresh.summary);
    expect(missing.storedBreakMins).toBe(fresh.storedBreakMins);
    expect([fresh.tracking.state, missing.tracking.state]).toEqual(['LIVE', 'STALE']);
  });
});
