/**
 * Departments / Offices / Shifts summary cards (pure, unit-tested). Every card's number is the
 * length (or sum) of the same rows its detail view lists, so the two always reconcile.
 */
import { employeeFields } from './cardDetails';

export interface CardData { count: number; rows: Record<string, any>[] }
const pack = (rows: Record<string, any>[]): CardData => ({ count: rows.length, rows });
const memberRow = (e: any, extra: Record<string, any> = {}) => ({ __key: e?.id, ...employeeFields(e), status: e?.status || '—', ...extra });

// ── Departments ───────────────────────────────────────────────────────────────
export type DepartmentCard = 'total' | 'active' | 'employees' | 'unassigned';
/** departments: rows from departmentService (with `employees` embed); unassigned: ACTIVE employees without a department. */
export function departmentCards(departments: any[], unassigned: any[]): Record<DepartmentCard, CardData> {
  const list = departments || [];
  const deptRow = (d: any) => ({ __key: d.id, department: d.name || '—', status: d.is_active ? 'Active' : 'Inactive', employees: (d.employees || []).length });
  const members = list.flatMap(d => (d.employees || []).map((e: any) => memberRow(e, { department: d.name || '—' })));
  return {
    total: pack(list.map(deptRow)),
    active: pack(list.filter(d => d.is_active).map(deptRow)),
    employees: pack(members),
    unassigned: pack((unassigned || []).map(e => memberRow(e, { department: 'Unassigned' }))),
  };
}

// ── Offices ───────────────────────────────────────────────────────────────────
export type OfficeCard = 'total' | 'active' | 'employees' | 'geofence';
/** offices: the page's mapped offices (name, address, status, geofence, radius, members). */
export function officeCards(offices: any[]): Record<OfficeCard, CardData> {
  const list = offices || [];
  const officeRow = (o: any) => ({
    __key: o.id, office: o.name || '—', address: o.address || '—', status: o.status || '—',
    geofence: o.geofence ? `Enabled (${o.radius} m)` : 'Disabled', employees: (o.members || []).length,
  });
  return {
    total: pack(list.map(officeRow)),
    active: pack(list.filter(o => o.status === 'Active').map(officeRow)),
    employees: pack(list.flatMap(o => (o.members || []).map((e: any) => memberRow(e, { office: o.name || '—' })))),
    geofence: pack(list.filter(o => o.geofence).map(officeRow)),
  };
}

// ── Shifts ────────────────────────────────────────────────────────────────────
export type ShiftCard = 'total' | 'active' | 'employees' | 'overnight';
/** shifts: the page's mapped shifts; members: shift id → employees currently assigned (null when not loaded). */
export function shiftCards(shifts: any[], members: Record<string, any[]> | null): Record<ShiftCard, CardData> {
  const list = shifts || [];
  const shiftRow = (s: any) => ({
    __key: s.id, shift: s.name || '—', code: s.code || '—', timing: `${s.start || '—'} – ${s.end || '—'}`,
    requiredHours: s.reqHours ?? '—', breakMins: s.breakMins ?? '—', grace: s.grace ?? '—',
    overnight: s.overnight ? 'Yes' : 'No', status: s.status || '—',
  });
  const assigned = members
    ? list.flatMap(s => (members[s.id] || []).map((e: any) => memberRow(e, { shift: s.name || '—', timing: `${s.start || '—'} – ${s.end || '—'}` })))
    : [];
  return {
    total: pack(list.map(shiftRow)),
    active: pack(list.filter(s => s.status === 'Active').map(shiftRow)),
    employees: pack(assigned),
    overnight: pack(list.filter(s => s.overnight).map(shiftRow)),
  };
}
