import { describe, it, expect, vi } from 'vitest';
import { isChunkLoadError, reloadOnceForNewVersion } from '../../lib/chunkReload';
import { uniqueOfficeCodes, baseOfficeCode } from '../offices/officeCodes';
import { requiredHoursError } from '../shifts/shiftValidation';
import { openSessionPastShiftEnd } from '../attendance/adminAttendanceRules';
import { computeDashboardStats } from '../admin/dashboardRules';

// 2026-11-02 live-audit fixes. Synthetic data only.

describe('new deploy: stale page file reloads once instead of crashing', () => {
  it('recognises the browser messages for a missing page file', () => {
    expect(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: https://x/assets/Payroll-B0tniiy7.js'))).toBe(true);
    expect(isChunkLoadError(new TypeError("'text/html' is not a valid JavaScript MIME type."))).toBe(true);
    expect(isChunkLoadError(new Error('Importing a module script failed.'))).toBe(true);
    expect(isChunkLoadError(new Error('Cannot read properties of undefined'))).toBe(false);
  });
  it('reloads once, then not again within a minute (no reload loop)', () => {
    const store: Record<string, string> = {};
    const storage = { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; } };
    const reload = vi.fn();
    expect(reloadOnceForNewVersion(1_000_000, storage, reload)).toBe(true);
    expect(reloadOnceForNewVersion(1_030_000, storage, reload)).toBe(false);
    expect(reloadOnceForNewVersion(1_070_000, storage, reload)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });
});

describe('office codes are unique', () => {
  it('two offices whose names start alike no longer share WHITEE-L', () => {
    const codes = uniqueOfficeCodes([
      { id: '2', name: 'Whitee Lottus Digital Studio' }, { id: '1', name: 'Whitee Lottus' }, { id: '3', name: 'Ankur' }]);
    expect(codes).toEqual({ '1': 'WHITEE-L', '2': 'WHITEE-L-2', '3': 'ANKUR' });
    expect(new Set(Object.values(codes)).size).toBe(3);
  });
  it('a stored code wins; empty names get a placeholder', () => {
    expect(uniqueOfficeCodes([{ id: 'a', name: 'X', code: 'hq' }])).toEqual({ a: 'HQ' });
    expect(baseOfficeCode('  ')).toBe('OFFICE');
  });
});

describe('shift required hours must fit the shift', () => {
  it('afternoon 12:00–21:00 (540 min) with 9.5h required is refused; 10:00–19:30 with 9.5h is fine', () => {
    expect(requiredHoursError(540, 9.5)).toMatch(/longer than the shift itself \(9h\)/);
    expect(requiredHoursError(570, 9.5)).toBeNull();
    expect(requiredHoursError(600, '8')).toBeNull();
    expect(requiredHoursError(600, 0)).toMatch(/greater than 0/);
    expect(requiredHoursError(null, 9.5)).toBeNull();
  });
});

describe('"working now" is the same on Dashboard, Attendance and Live Tracking', () => {
  // 21:39 IST on 2 Nov = 16:09 UTC
  const now = Date.parse('2026-11-02T16:09:00Z');
  const general = { start_time: '10:00:00', end_time: '19:30:00', crosses_midnight: false };
  const afternoon = { start_time: '12:00:00', end_time: '21:00:00', crosses_midnight: false };
  const night = { start_time: '22:00:00', end_time: '06:00:00', crosses_midnight: true };
  const open = { attendance_date: '2026-11-02', clock_in_at: '2026-11-02T04:30:00Z', clock_out_at: null };

  it('open session after the shift end is a missing clock-out, not working', () => {
    expect(openSessionPastShiftEnd(open, general, now, '2026-11-02')).toBe(true);
    expect(openSessionPastShiftEnd(open, afternoon, now, '2026-11-02')).toBe(true);   // 21:00 < 21:39
    expect(openSessionPastShiftEnd(open, { ...afternoon, end_time: '22:00:00' }, now, '2026-11-02')).toBe(false);
    expect(openSessionPastShiftEnd({ ...open, attendance_date: '2026-11-01' }, night, now, '2026-11-02')).toBe(true);
    expect(openSessionPastShiftEnd({ ...open, clock_out_at: '2026-11-02T14:00:00Z' }, general, now, '2026-11-02')).toBe(false);
    expect(openSessionPastShiftEnd({ ...open, attendance_date: '2026-11-01' }, null, now, '2026-11-02')).toBe(true);
  });

  it('Dashboard "Working now" excludes them when the time is given', () => {
    const employees = [1, 2, 3].map(i => ({ id: `e${i}`, status: 'ACTIVE', role: { name: 'EMPLOYEE' } }));
    const attendance = [
      { employee_id: 'e1', ...open, shift_templates: general },
      { employee_id: 'e2', ...open, shift_templates: { ...afternoon, end_time: '22:30:00' } },
      { employee_id: 'e3', ...open, clock_out_at: '2026-11-02T14:00:00Z', shift_templates: general },
    ];
    const input = { employees, attendance, leaves: [], approvedWfhToday: [], today: '2026-11-02' };
    expect(computeDashboardStats({ ...input, nowMs: now })).toMatchObject({ present: 3, working: 1 });
    expect(computeDashboardStats(input).working).toBe(2); // without a time: previous behaviour
  });
});
