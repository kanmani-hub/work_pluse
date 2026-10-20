/**
 * Admin → Departments → View Details: pure helpers (unit-tested) that turn a department row and its
 * employees into plain display text. Nothing here returns an object or array where the UI expects
 * text, so a field can never be rendered as a raw object ("Objects are not valid as a React child").
 *
 * Data:
 *   departments.description  JSON written by the Departments form: {"code","manager","desc"}; older rows
 *                            may hold plain text. The table has no separate code/manager columns.
 *   employees                id, first_name, last_name, employee_code, designation, status, office(name),
 *                            filtered by department_id (departmentService.getDepartmentEmployees).
 */
import { COMPANY_TIMEZONE } from '../../utils/companyDate';

/** Trimmed text, or null. Numbers become text; objects, arrays, booleans and blanks are never text. */
export function displayText(value: unknown): string | null {
  if (typeof value === 'string') {
    const t = value.trim();
    return t ? t : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

export interface DepartmentMeta {
  code: string | null;
  manager: string | null;
  description: string | null;
}

/** Code, manager and description stored in departments.description (JSON or legacy plain text). */
export function parseDepartmentDescription(description: unknown): DepartmentMeta {
  const raw = displayText(description);
  if (!raw) return { code: null, manager: null, description: null };
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { code: displayText(parsed.code), manager: displayText(parsed.manager), description: displayText(parsed.desc) };
    }
  } catch {
    /* not JSON: legacy plain-text description */
  }
  return { code: null, manager: null, description: raw };
}

/** "20 Oct 2026" in the company time zone; null when missing or not a valid date. */
export function formatDepartmentDate(iso: unknown): string | null {
  const s = displayText(iso);
  if (!s) return null;
  const t = new Date(s).getTime();
  if (!Number.isFinite(t)) return null;
  return new Date(t).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: COMPANY_TIMEZONE });
}

export interface DepartmentDetail {
  id: string | null;
  name: string;
  code: string | null;
  manager: string | null;
  description: string | null;
  statusLabel: 'Active' | 'Inactive';
  created: string | null;
}

/** Header fields of the details panel (same Active/Inactive rule as the departments table). */
export function toDepartmentDetail(dept: any): DepartmentDetail {
  const meta = parseDepartmentDescription(dept?.description);
  return {
    id: displayText(dept?.id),
    name: displayText(dept?.name) ?? 'Unnamed department',
    code: meta.code,
    manager: meta.manager,
    description: meta.description,
    statusLabel: dept?.is_active ? 'Active' : 'Inactive',
    created: formatDepartmentDate(dept?.created_at),
  };
}

export interface DepartmentEmployeeRow {
  key: string;
  name: string;
  employeeCode: string | null;
  designation: string | null;
  office: string | null;
  statusLabel: string;
  active: boolean;
}

const STATUS_TEXT: Record<string, string> = { ACTIVE: 'Active', INACTIVE: 'Inactive' };

/** Employee rows for the panel, sorted by name. Anything that is not an object row is skipped. */
export function toDepartmentEmployeeRows(rows: unknown): DepartmentEmployeeRow[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((r): r is Record<string, any> => !!r && typeof r === 'object' && !Array.isArray(r))
    .map((r, i) => {
      const code = displayText(r.employee_code);
      const fullName = [displayText(r.first_name), displayText(r.last_name)].filter(Boolean).join(' ');
      // PostgREST returns a to-one embed as an object; tolerate an array too
      const officeRel = Array.isArray(r.office) ? r.office[0] : r.office;
      const status = displayText(r.status);
      return {
        key: displayText(r.id) ?? `${code ?? 'row'}-${i}`,
        name: fullName || code || 'Unnamed employee',
        employeeCode: code,
        designation: displayText(r.designation),
        office: displayText(officeRel?.name),
        statusLabel: status ? (STATUS_TEXT[status.toUpperCase()] ?? status) : 'Unknown',
        active: status?.toUpperCase() === 'ACTIVE',
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
