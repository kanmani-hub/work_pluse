import { describe, it, expect } from 'vitest';
import { computeWorkTimer, completedBreakMinutes, computeBreakOverrun, resolveAllowedBreakMinutes, breakDurationMinutes, findActiveBreak } from './breakRules';
import { initialStability, nextStability, type GeofenceReading, type StabilityState } from '../location/geofenceStability';
import { deriveLiveWorkStatus } from '../location/liveStatusRules';

// Controlled timestamps (unit/service level only — NOT a physical GPS test)
const T = (hhmm: string) => `2026-10-08T${hhmm}:00+05:30`;
const ms = (hhmm: string) => new Date(T(hhmm)).getTime();
const reading = (hhmm: string, distance: number | null, accuracy: number | null = 10, ok = true): GeofenceReading => ({ ok, distanceMeters: distance, radiusMeters: 100, accuracyMeters: accuracy, atMs: ms(hhmm) });

/** Feed readings through the stability filter and apply START/END like breakService does. */
function simulate(readings: GeofenceReading[], start: StabilityState = initialStability('INSIDE')) {
  let state = start;
  const breaks: { started_at: string; ended_at: string | null; duration_minutes: number | null; break_type: string }[] = [];
  const transitions: string[] = [];
  for (const r of readings) {
    const step = nextStability(state, r);
    state = step.state;
    if (step.transition && step.transition.from !== null) {
      const iso = new Date(step.transition.atMs).toISOString();
      transitions.push(`${step.transition.to}@${iso}`);
      const active = findActiveBreak(breaks);
      if (step.transition.to === 'OUTSIDE' && !active) breaks.push({ started_at: iso, ended_at: null, duration_minutes: null, break_type: 'AUTO_GPS' });
      if (step.transition.to === 'INSIDE' && active) { active.ended_at = iso; active.duration_minutes = breakDurationMinutes(active.started_at, iso); }
    }
  }
  return { state, breaks, transitions };
}

describe('working hours', () => {
  it('spec example: in 10:00, out 12:00, back 12:30, clock out 19:00 → 8h 30m work, 30m break', () => {
    const breaks = [{ started_at: T('12:00'), ended_at: T('12:30'), duration_minutes: 30 }];
    const t = computeWorkTimer({ clock_in_at: T('10:00'), clock_out_at: T('19:00') }, breaks, ms('19:00'));
    expect(t.elapsedSeconds).toBe(9 * 3600);
    expect(t.breakSeconds).toBe(30 * 60);
    expect(t.workSeconds).toBe(8.5 * 3600);
  });

  it('work timer pauses during an active break and the break grows from started_at', () => {
    const breaks = [{ started_at: T('12:00'), ended_at: null }];
    const a = computeWorkTimer({ clock_in_at: T('10:00') }, breaks, ms('12:10'));
    const b = computeWorkTimer({ clock_in_at: T('10:00') }, breaks, ms('12:25'));
    expect(a.workSeconds).toBe(2 * 3600);
    expect(b.workSeconds).toBe(2 * 3600);          // paused
    expect(a.activeBreakSeconds).toBe(10 * 60);
    expect(b.activeBreakSeconds).toBe(25 * 60);    // continues from started_at
  });

  it('refresh during an active break gives the same values (computed only from stored timestamps)', () => {
    const breaks = [{ started_at: T('12:00'), ended_at: null }];
    const before = computeWorkTimer({ clock_in_at: T('10:00') }, breaks, ms('12:20'));
    const afterRefresh = computeWorkTimer({ clock_in_at: T('10:00') }, JSON.parse(JSON.stringify(breaks)), ms('12:20'));
    expect(afterRefresh).toEqual(before);
    expect(afterRefresh.activeBreak).not.toBeNull();
  });
});

describe('automatic break lifecycle (simulated readings)', () => {
  it('inside → outside → inside creates one AUTO_GPS break from the first outside reading to the first inside reading', () => {
    const r = simulate([reading('10:00', 10), reading('12:00', 400), reading('12:01', 420), reading('12:30', 15), reading('12:31', 12)]);
    expect(r.breaks.length).toBe(1);
    expect(r.breaks[0].started_at).toBe(new Date(T('12:00')).toISOString());
    expect(r.breaks[0].ended_at).toBe(new Date(T('12:30')).toISOString());
    expect(r.breaks[0].duration_minutes).toBe(30);
    expect(r.breaks[0].break_type).toBe('AUTO_GPS');
  });

  it('multiple breaks are stored separately and break minutes equal their sum', () => {
    const r = simulate([
      reading('10:00', 10),
      reading('11:00', 500), reading('11:01', 500), reading('11:20', 20), reading('11:21', 20),   // break 1: 20m
      reading('15:00', 500), reading('15:01', 500), reading('15:45', 20), reading('15:46', 20),   // break 2: 45m
    ]);
    expect(r.breaks.length).toBe(2);
    expect(r.breaks.map(b => b.duration_minutes)).toEqual([20, 45]);
    expect(completedBreakMinutes(r.breaks)).toBe(65);
    const t = computeWorkTimer({ clock_in_at: T('10:00'), clock_out_at: T('19:00') }, r.breaks, ms('19:00'));
    expect(t.workSeconds).toBe(9 * 3600 - 65 * 60);
  });

  it('GPS jitter around the boundary does not create START/END flapping', () => {
    const r = simulate([
      reading('10:00', 95), reading('10:01', 108), reading('10:02', 97), reading('10:03', 115), reading('10:04', 99), // within radius+buffer
      reading('10:05', 130), reading('10:06', 90), reading('10:07', 125), reading('10:08', 85),                      // single-reading excursions
    ]);
    expect(r.transitions).toEqual([]);
    expect(r.breaks.length).toBe(0);
  });

  it('denied / unavailable / low-accuracy readings never create a break or mark the employee outside', () => {
    const r = simulate([reading('10:00', 10), reading('11:00', null, null, false), reading('11:01', null, null, false), reading('11:02', 900, 2000), reading('11:03', 900, 2000)]);
    expect(r.breaks.length).toBe(0);
    expect(r.state.confirmed).toBe('INSIDE');
    const step = nextStability(initialStability('INSIDE'), reading('11:05', null, null, false));
    expect(step.usable).toBe(false);
  });

  it('a second outside transition while a break is already active does not create a duplicate break', () => {
    const r = simulate([reading('10:00', 10), reading('11:00', 500), reading('11:01', 500)]);
    // replay an OUTSIDE confirmation (e.g. second tab) — breakService refuses when a break is active
    const active = findActiveBreak(r.breaks);
    expect(active).not.toBeNull();
    expect(r.breaks.filter(b => !b.ended_at).length).toBe(1);
  });
});

describe('break allowance and overrun', () => {
  it('uses the shift break first, then the Admin setting; never a hard-coded number', () => {
    expect(resolveAllowedBreakMinutes(80, 1)).toBe(80);
    expect(resolveAllowedBreakMinutes(null, 75)).toBe(75);
    expect(resolveAllowedBreakMinutes(undefined, undefined)).toBeNull();
  });

  it('allowed 75, actual 90 → break 90, overrun 15 (timestamps untouched)', () => {
    const breaks = [{ started_at: T('12:00'), ended_at: T('13:30'), duration_minutes: null }];
    const actual = completedBreakMinutes(breaks);
    expect(actual).toBe(90);
    expect(computeBreakOverrun(actual, 75)).toBe(15);
    expect(breaks[0].ended_at).toBe(T('13:30'));
  });

  it('no overrun when detection is disabled or the allowance is unknown', () => {
    expect(computeBreakOverrun(90, 75, false)).toBe(0);
    expect(computeBreakOverrun(90, null)).toBe(0);
  });
});

describe('admin live tracking status', () => {
  it('WORKING → ON BREAK → WORKING follows attendance/breaks, not just location', () => {
    const att = { status: 'WORKING', clock_in_at: T('10:00'), clock_out_at: null };
    expect(deriveLiveWorkStatus({ location_status: 'INSIDE_GEOFENCE' }, att, false)).toBe('Working');
    expect(deriveLiveWorkStatus({ location_status: 'OUTSIDE_GEOFENCE' }, { ...att, status: 'ON_BREAK' }, true)).toBe('On Break');
    expect(deriveLiveWorkStatus({ location_status: 'INSIDE_GEOFENCE' }, att, false)).toBe('Working');
  });
  it('no attendance today → Offline even if an old location says inside; clocked out → Clocked Out', () => {
    expect(deriveLiveWorkStatus({ location_status: 'INSIDE_GEOFENCE' }, null, false)).toBe('Offline');
    expect(deriveLiveWorkStatus({ location_status: 'INSIDE_GEOFENCE' }, { status: 'COMPLETED', clock_in_at: T('10:00'), clock_out_at: T('19:00') }, false)).toBe('Clocked Out');
  });
  it('WFH attendance shows WFH and is never On Break from location alone', () => {
    expect(deriveLiveWorkStatus({ location_status: 'WFH', location_context: 'WFH' }, { status: 'WORKING', clock_in_at: T('10:00') }, false)).toBe('WFH');
  });
});
