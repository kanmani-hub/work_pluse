/**
 * Shifts page: how many employees are CURRENTLY assigned to each shift template.
 * Same rule as Admin → Attendance (shiftForDate): an employee's current shift is their latest
 * shift_assignments row with effective_date <= today and (end_date is null or >= today).
 * Only ACTIVE employees are counted; ended, future, and superseded assignments are ignored,
 * and each employee is counted once. Day-level roster overrides are not counted here.
 */
export function currentShiftByEmployee(assignments: any[], today: string): Map<string, string> {
  const best = new Map<string, { date: string; sid: string }>();
  for (const a of assignments || []) {
    if (!a?.employee_id || !a.shift_template_id || !a.effective_date) continue;
    if (a.effective_date > today) continue;
    if (a.end_date && a.end_date < today) continue;
    const cur = best.get(a.employee_id);
    if (!cur || a.effective_date > cur.date) best.set(a.employee_id, { date: a.effective_date, sid: a.shift_template_id });
  }
  return new Map([...best.entries()].map(([emp, v]) => [emp, v.sid]));
}

/** Same rule as countAssignedEmployeesByShift, returning the employees themselves (for detail views). */
export function assignedEmployeesByShift(assignments: any[], employees: any[], today: string): Record<string, any[]> {
  const active = new Map((employees || []).filter(e => String(e?.status || '').toUpperCase() === 'ACTIVE').map(e => [e.id, e]));
  const out: Record<string, any[]> = {};
  for (const [emp, sid] of currentShiftByEmployee(assignments, today)) {
    const e = active.get(emp);
    if (!e) continue;
    (out[sid] = out[sid] || []).push(e);
  }
  return out;
}

export function countAssignedEmployeesByShift(assignments: any[], employees: any[], today: string): Record<string, number> {
  const active = new Set((employees || []).filter(e => String(e?.status || '').toUpperCase() === 'ACTIVE').map(e => e.id));
  const counts: Record<string, number> = {};
  for (const [emp, sid] of currentShiftByEmployee(assignments, today)) {
    if (!active.has(emp)) continue;
    counts[sid] = (counts[sid] || 0) + 1;
  }
  return counts;
}

export interface ResolvedShiftResult {
  shift: any | null;
  isWeekOff: boolean;
  source: 'ROSTER' | 'PERMANENT' | 'NONE';
  rosterAssignmentId?: string | null;
  shiftAssignmentId?: string | null;
  workMode?: 'OFFICE' | 'WFH';
}

/**
 * Resolves an employee's assigned shift for a specific date:
 * 1. A PUBLISHED roster assignment (roster_assignments joined to rosters) takes highest priority.
 *    - day_type = 'WEEK_OFF' -> isWeekOff: true, shift: null
 *    - day_type = 'WORK' -> assigned shift template, workMode ('OFFICE' | 'WFH')
 *    - DRAFT rosters are not published yet and do NOT take effect for employee self-service.
 * 2. If no published roster entry exists for that date, fall back to permanent assignment
 *    (shift_assignments with effective_date <= date and end_date null or >= date, latest effective_date).
 * 3. If neither exists, returns null shift and source: 'NONE'.
 */
export function resolveEmployeeShiftForDate(params: {
  employeeId: string;
  date: string;
  rosterAssignments?: any[] | null;
  defaultAssignments?: any[] | null;
}): ResolvedShiftResult {
  const { employeeId, date, rosterAssignments, defaultAssignments } = params;

  if (rosterAssignments && Array.isArray(rosterAssignments)) {
    const published = rosterAssignments.find(r =>
      r?.employee_id === employeeId &&
      String(r.assignment_date || '').slice(0, 10) === date &&
      String(r.rosters?.status || r.roster?.status || '').toUpperCase() === 'PUBLISHED'
    );

    if (published) {
      const isWeekOff = String(published.day_type || 'WORK').toUpperCase() === 'WEEK_OFF';
      if (isWeekOff) {
        return {
          shift: null,
          isWeekOff: true,
          source: 'ROSTER',
          rosterAssignmentId: published.id,
          workMode: 'OFFICE',
        };
      }
      const shift = published.shift_templates || published.shift_template || null;
      const workMode = String(published.work_mode || 'OFFICE').toUpperCase() === 'WFH' ? 'WFH' : 'OFFICE';
      return {
        shift,
        isWeekOff: false,
        source: 'ROSTER',
        rosterAssignmentId: published.id,
        workMode,
      };
    }
  }

  if (defaultAssignments && Array.isArray(defaultAssignments)) {
    const candidates = defaultAssignments
      .filter(a =>
        a?.employee_id === employeeId &&
        a.effective_date <= date &&
        (!a.end_date || a.end_date >= date)
      )
      .sort((a, b) => (a.effective_date < b.effective_date ? 1 : a.effective_date > b.effective_date ? -1 : 0));

    const best = candidates[0];
    if (best) {
      const shift = best.shift_templates || best.shift_template || null;
      return {
        shift,
        isWeekOff: false,
        source: 'PERMANENT',
        shiftAssignmentId: best.id,
        workMode: 'OFFICE',
      };
    }
  }

  return {
    shift: null,
    isWeekOff: false,
    source: 'NONE',
  };
}
