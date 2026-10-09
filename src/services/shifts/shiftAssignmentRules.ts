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

export function countAssignedEmployeesByShift(assignments: any[], employees: any[], today: string): Record<string, number> {
  const active = new Set((employees || []).filter(e => String(e?.status || '').toUpperCase() === 'ACTIVE').map(e => e.id));
  const counts: Record<string, number> = {};
  for (const [emp, sid] of currentShiftByEmployee(assignments, today)) {
    if (!active.has(emp)) continue;
    counts[sid] = (counts[sid] || 0) + 1;
  }
  return counts;
}
