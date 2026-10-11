/**
 * Admin → Employees form rules (pure, unit-tested).
 */
import { companyDateStr } from '../../utils/companyDate';

/** Employee status as the app compares it ('ACTIVE' / 'INACTIVE' …). Older rows saved as 'Inactive' read as INACTIVE. */
export function normalizeEmployeeStatus(status: string | null | undefined): string {
  return String(status || '').trim().toUpperCase();
}

export const isInactiveEmployee = (status: string | null | undefined) => normalizeEmployeeStatus(status) === 'INACTIVE';

/**
 * Whether saving the employee form should write a new salary structure.
 * Only when a valid amount was entered and it differs from the salary loaded for the employee
 * (no new salary record just because the employee's other details were edited).
 */
export function salaryNeedsUpdate(loaded: number | null | undefined, entered: unknown): boolean {
  if (entered === undefined || entered === null || String(entered).trim() === '') return false;
  const value = Number(entered);
  if (!Number.isFinite(value) || value < 0) return false;
  if (loaded === null || loaded === undefined) return true;
  return Number(loaded) !== value;
}

/** Fresh form values for the Assign Shift window (company date, nothing carried over). */
export const assignShiftDefaults = (now: Date = new Date()) => ({ shift_id: '', effective_date: companyDateStr(now) });

/** Fresh form values for the Assign Office window: the employee's own current office. */
export const assignOfficeDefaults = (emp: { office_id?: string | null } | null | undefined) => ({ office_id: emp?.office_id || '' });
