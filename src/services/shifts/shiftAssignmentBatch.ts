/**
 * Assign one shift to several employees, one request per employee, and report exactly what was saved.
 * Used by Admin → Shifts → Assign (replaces the old screen that showed "Shift assigned successfully"
 * without saving anything). A partial result is never reported as a full success.
 */
export interface AssignOutcome {
  succeeded: string[];
  failed: { employeeId: string; message: string }[];
}

export type AssignOne = (employeeId: string, shiftTemplateId: string, effectiveDate: string) =>
  Promise<{ error: any }>;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function validateAssignment(employeeIds: string[], shiftTemplateId: string | null | undefined, effectiveDate: string): string | null {
  if (!shiftTemplateId) return 'Choose a shift.';
  if (!effectiveDate || !DATE_RE.test(effectiveDate) || Number.isNaN(Date.parse(`${effectiveDate}T00:00:00Z`))) return 'Choose a valid effective date.';
  if (!employeeIds.length) return 'Select at least one employee.';
  return null;
}

export async function assignShiftToEmployees(
  employeeIds: string[], shiftTemplateId: string, effectiveDate: string, assignOne: AssignOne,
): Promise<AssignOutcome> {
  const unique = [...new Set(employeeIds)];
  const out: AssignOutcome = { succeeded: [], failed: [] };
  for (const id of unique) {
    try {
      const { error } = await assignOne(id, shiftTemplateId, effectiveDate);
      if (error) out.failed.push({ employeeId: id, message: error.message || String(error) });
      else out.succeeded.push(id);
    } catch (e: any) {
      out.failed.push({ employeeId: id, message: e?.message || 'Request failed' });
    }
  }
  return out;
}

export function assignmentSummary(o: AssignOutcome): { ok: boolean; message: string } {
  if (!o.failed.length) return { ok: true, message: `Shift assigned to ${o.succeeded.length} employee${o.succeeded.length === 1 ? '' : 's'}.` };
  if (!o.succeeded.length) return { ok: false, message: `No assignment was saved (${o.failed.length} failed).` };
  return { ok: false, message: `Saved for ${o.succeeded.length}, failed for ${o.failed.length}. The failed employees are still selected; fix the problem and try again.` };
}
