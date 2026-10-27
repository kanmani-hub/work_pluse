import { describe, it, expect, vi } from 'vitest';
import { assignShiftToEmployees, assignmentSummary, validateAssignment } from './shiftAssignmentBatch';

describe('shift assignment batch (Admin → Shifts → Assign)', () => {
  it('validates input before sending anything', () => {
    expect(validateAssignment([], 's1', '2026-10-22')).toMatch(/at least one employee/);
    expect(validateAssignment(['e1'], '', '2026-10-22')).toMatch(/shift/);
    expect(validateAssignment(['e1'], 's1', '22/10/2026')).toMatch(/date/);
    expect(validateAssignment(['e1'], 's1', '2026-10-22')).toBeNull();
  });

  it('reports success only when every assignment was saved', async () => {
    const assign = vi.fn().mockResolvedValue({ error: null });
    const o = await assignShiftToEmployees(['e1', 'e2', 'e1'], 's1', '2026-10-22', assign);
    expect(assign).toHaveBeenCalledTimes(2);   // duplicates (double selection) sent once
    expect(o).toEqual({ succeeded: ['e1', 'e2'], failed: [] });
    expect(assignmentSummary(o)).toEqual({ ok: true, message: 'Shift assigned to 2 employees.' });
  });

  it('a database rejection or network error is reported per employee, never as success', async () => {
    const assign = vi.fn()
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: { message: 'new row violates row-level security policy' } })
      .mockRejectedValueOnce(new Error('Failed to fetch'));
    const o = await assignShiftToEmployees(['e1', 'e2', 'e3'], 's1', '2026-10-22', assign);
    expect(o.succeeded).toEqual(['e1']);
    expect(o.failed.map((f) => f.employeeId)).toEqual(['e2', 'e3']);
    expect(o.failed[1].message).toBe('Failed to fetch');
    const s = assignmentSummary(o);
    expect(s.ok).toBe(false);
    expect(s.message).toMatch(/Saved for 1, failed for 2/);
  });

  it('all failed → no success message', async () => {
    const o = await assignShiftToEmployees(['e1'], 's1', '2026-10-22', async () => ({ error: new Error('x') }));
    expect(assignmentSummary(o)).toEqual({ ok: false, message: 'No assignment was saved (1 failed).' });
  });
});
