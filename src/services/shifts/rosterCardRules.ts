/**
 * Shift Roster summary cards (pure, unit-tested). Same counting as the roster grid: for each
 * visible employee and each day of the selected Monday–Sunday week, the effective cell is
 * looked at (saved roster entry → default shift assignment). Opening details never saves or
 * publishes anything.
 *  - Scheduled / Unassigned: employees with at least one / no working-shift day in the week.
 *  - Morning / Evening / Night / WFH: employee-days (one row per employee per day).
 */
import { employeeFields } from '../common/cardDetails';

export type RosterCard = 'scheduled' | 'morning' | 'evening' | 'night' | 'wfh' | 'unassigned';
export interface RosterCardData { count: number; rows: Record<string, any>[] }

const hhmm = (t?: string | null) => (t ? String(t).substring(0, 5) : '—');

export function rosterCards(
  employees: any[],
  dates: string[],
  getCell: (employeeId: string, date: string) => any,
): Record<RosterCard, RosterCardData> {
  const out: Record<RosterCard, Record<string, any>[]> = { scheduled: [], morning: [], evening: [], night: [], wfh: [], unassigned: [] };
  for (const emp of employees || []) {
    const who = { ...employeeFields(emp) };
    let workDays = 0, weekOffs = 0;
    for (const date of dates) {
      const cell = getCell(emp.id, date);
      if (cell?.type === 'Week Off') weekOffs++;
      if (!cell || !cell.shift) continue;
      workDays++;
      const s = cell.shiftData || {};
      const row = {
        __key: `${emp.id}:${date}`, ...who, date, shift: s.name || '—', timing: `${hhmm(s.start_time)} – ${hhmm(s.end_time)}`,
        mode: cell.mode || 'Office', source: cell.rostered ? 'Saved roster' : 'Default shift assignment',
      };
      if (s.shift_type === 'MORNING') out.morning.push(row);
      if (s.shift_type === 'EVENING') out.evening.push(row);
      if (s.shift_type === 'NIGHT') out.night.push(row);
      if (cell.mode === 'WFH') out.wfh.push(row);
    }
    if (workDays > 0) out.scheduled.push({ __key: emp.id, ...who, workDays, weekOffs });
    else out.unassigned.push({ __key: emp.id, ...who, workDays, weekOffs });
  }
  const pack = (rows: Record<string, any>[]) => ({ count: rows.length, rows });
  return {
    scheduled: pack(out.scheduled), morning: pack(out.morning), evening: pack(out.evening),
    night: pack(out.night), wfh: pack(out.wfh), unassigned: pack(out.unassigned),
  };
}
