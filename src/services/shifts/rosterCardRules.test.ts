import { describe, it, expect } from 'vitest';
import { rosterCards } from './rosterCardRules';
import { weekRange } from './rosterDates';

const morning = { name: 'Morning', shift_type: 'MORNING', start_time: '09:00:00', end_time: '18:00:00' };
const night = { name: 'Night', shift_type: 'NIGHT', start_time: '22:00:00', end_time: '06:00:00' };
const emps = [{ id: 'a', first_name: 'A', last_name: 'One', employee_code: 'E1' }, { id: 'b', first_name: 'B', last_name: 'Two', employee_code: 'E2' }, { id: 'c', first_name: 'C', last_name: 'Three', employee_code: 'E3' }];

describe('Roster summary cards', () => {
  const dates = weekRange('2026-10-08').dates; // Mon 5 Oct – Sun 11 Oct
  const cell = (emp: string, d: string) => {
    if (emp === 'a') return d === '2026-10-11' ? { shift: null, type: 'Week Off', rostered: true } : { shift: 's1', mode: 'Office', shiftData: morning, rostered: true };
    if (emp === 'b') return d === '2026-10-06' ? { shift: 's2', mode: 'WFH', shiftData: night } : null;
    return d === '2026-10-05' ? { shift: null, type: 'Week Off', rostered: true } : null; // c: week off only
  };
  const c = rosterCards(emps, dates, cell);

  it('uses the Monday–Sunday week', () => {
    expect(dates[0]).toBe('2026-10-05'); expect(dates[6]).toBe('2026-10-11');
  });
  it('counts match rows; week offs are not working days', () => {
    expect(c.scheduled.count).toBe(2); expect(c.unassigned.count).toBe(1);
    expect(c.unassigned.rows[0]).toMatchObject({ code: 'E3', workDays: 0, weekOffs: 1 });
    expect(c.scheduled.rows[0]).toMatchObject({ code: 'E1', workDays: 6, weekOffs: 1 });
    expect(c.morning.count).toBe(6); expect(c.morning.rows.length).toBe(6);
    expect(c.night.count).toBe(1); expect(c.evening.count).toBe(0);
    expect(c.wfh.count).toBe(1);
    expect(c.wfh.rows[0]).toMatchObject({ date: '2026-10-06', shift: 'Night', timing: '22:00 – 06:00', mode: 'WFH', source: 'Default shift assignment' });
    expect(c.morning.rows[0].source).toBe('Saved roster');
  });
  it('empty roster', () => {
    const e = rosterCards([], dates, () => null);
    expect(e.scheduled.count + e.unassigned.count + e.morning.count).toBe(0);
  });
});
