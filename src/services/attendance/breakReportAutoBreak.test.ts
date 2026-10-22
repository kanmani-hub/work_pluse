import { describe, it, expect } from 'vitest';
import { buildBreakReportRows, reportStatusLabel, serverTrackingFor } from './breakReportRules';

// Admin → Break Management: server tracking state (employee_tracking_state) and automatic-break
// source / reason on each attendance row. Synthetic data only.
const NOW = Date.parse('2026-10-21T10:00:00Z');
const today = '2026-10-21';
const att = (id: string, emp: string, breaks: any[] = [], extra: any = {}) => ({
  id, employee_id: emp, attendance_date: today, clock_in_at: '2026-10-21T04:00:00Z', clock_out_at: null, status: 'WORKING',
  break_minutes: 0, break_overrun_minutes: 0, shift_template: { name: 'Day', break_duration_minutes: 60 },
  employees: { first_name: 'A', last_name: emp, employee_code: emp }, attendance_breaks: breaks, ...extra,
});
const rows = (attendanceRows: any[], trackingStates: any[] | null) => buildBreakReportRows({
  date: today, today, attendanceRows, employees: [], liveLocations: [], locationProblems: [], breakEndEvents: [],
  trackingStates, settingBreakMins: 60, nowMs: NOW,
});

describe('server tracking state on Break Management rows', () => {
  it('is matched by attendance id (a state from another attendance is not shown)', () => {
    const states = [{ employee_id: 'e1', attendance_id: 'old-att', state: 'STALE' }, { employee_id: 'e2', attendance_id: 'a2', state: 'TRACKING_OK' }];
    expect(serverTrackingFor(states, 'a1')).toBeNull();
    expect(serverTrackingFor(states, 'a2')?.state).toBe('TRACKING_OK');
    expect(serverTrackingFor(null, 'a2')).toBeNull();
  });

  it('"No Breaks Recorded" is not shown on its own while tracking is interrupted', () => {
    const [r1, r2, r3] = rows(
      [att('a1', 'e1'), att('a2', 'e2'), att('a3', 'e3')],
      [{ attendance_id: 'a1', state: 'STALE' }, { attendance_id: 'a2', state: 'TRACKING_OK' }, { attendance_id: 'a3', state: 'WAITING_FOR_FIX' }],
    );
    expect(r1.status).toBe('NO_BREAKS');
    expect(r1.trackingInterrupted).toBe(true);
    expect(reportStatusLabel(r1)).toBe('No breaks · tracking interrupted');
    expect(r2.trackingInterrupted).toBe(false);
    expect(reportStatusLabel(r2)).toBe('No Breaks Recorded');
    expect(r3.trackingInterrupted).toBe(true);
  });

  it('a GPS timeout is shown as a waiting state but a clocked-out day is never "interrupted"', () => {
    const [r1, r2] = rows(
      [att('a1', 'e1'), att('a2', 'e2', [], { clock_out_at: '2026-10-21T09:00:00Z', status: 'PRESENT' })],
      [{ attendance_id: 'a1', state: 'GPS_TIMEOUT' }, { attendance_id: 'a2', state: 'STALE' }],
    );
    expect(r1.trackingInterrupted).toBe(true);
    expect(r2.trackingInterrupted).toBe(false);
  });

  it('tracking states not loaded → no server state, nothing invented', () => {
    const [r1] = rows([att('a1', 'e1')], null);
    expect(r1.serverTracking).toBeNull();
    expect(r1.trackingInterrupted).toBe(false);
  });

  it('sessions keep source, reason and end reason for the details panel', () => {
    const [r1] = rows([att('a1', 'e1', [
      { id: 'b1', break_type: 'AUTO_TRACKING', source: 'SYSTEM', reason: 'LOCATION_PERMISSION_DENIED', started_at: '2026-10-21T05:00:00Z', ended_at: '2026-10-21T05:20:00Z', duration_minutes: 20, ended_reason: 'TRACKING_RESTORED' },
      { id: 'b2', break_type: 'REGULAR', source: 'EMPLOYEE', reason: null, started_at: '2026-10-21T09:30:00Z', ended_at: null, duration_minutes: null },
    ])], []);
    const s = r1.summary!.sessions;
    expect(s[0]).toMatchObject({ source: 'SYSTEM', reason: 'LOCATION_PERMISSION_DENIED', ended_reason: 'TRACKING_RESTORED', minutes: 20 });
    expect(s[1]).toMatchObject({ source: 'EMPLOYEE', state: 'ACTIVE' });
    expect(r1.status).toBe('ON_BREAK');
    // automatic and manual minutes count the same way (confirmed payroll policy)
    expect(r1.summary!.completedMins).toBe(20);
  });
});
