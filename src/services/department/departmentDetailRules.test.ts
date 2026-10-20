import { describe, it, expect } from 'vitest';
import { displayText, parseDepartmentDescription, formatDepartmentDate, toDepartmentDetail, toDepartmentEmployeeRows } from './departmentDetailRules';

// Admin → Departments → View Details. Synthetic rows shaped like departments / employees.
const emp = (over: Record<string, any> = {}) => ({
  id: 'e1', first_name: 'Asha', last_name: 'Rao', employee_code: 'EMP001', designation: 'Engineer', status: 'ACTIVE', office: { name: 'Chennai HQ' }, ...over,
});
const isPlain = (v: unknown) => v === null || ['string', 'number', 'boolean'].includes(typeof v);

describe('displayText: never turns an object into text', () => {
  it('keeps trimmed strings and finite numbers; everything else is null', () => {
    expect(displayText('  ENG ')).toBe('ENG');
    expect(displayText(42)).toBe('42');
    for (const v of [null, undefined, '', '   ', {}, { name: 'x' }, [], ['a'], true, NaN, Infinity]) expect(displayText(v), String(v)).toBeNull();
  });
});

describe('department code, manager and description', () => {
  it('reads the JSON written by the Departments form', () => {
    expect(parseDepartmentDescription(JSON.stringify({ code: 'ENG', manager: 'Ravi Kumar', desc: 'Builds things' })))
      .toEqual({ code: 'ENG', manager: 'Ravi Kumar', description: 'Builds things' });
  });
  it('missing code / manager / description stay null (the panel shows its own empty text)', () => {
    expect(parseDepartmentDescription(JSON.stringify({ code: '', manager: null }))).toEqual({ code: null, manager: null, description: null });
    expect(parseDepartmentDescription(null)).toEqual({ code: null, manager: null, description: null });
    expect(parseDepartmentDescription(undefined)).toEqual({ code: null, manager: null, description: null });
  });
  it('legacy plain text and non-object JSON are treated as a description only', () => {
    expect(parseDepartmentDescription('Handles payroll')).toEqual({ code: null, manager: null, description: 'Handles payroll' });
    expect(parseDepartmentDescription('[1,2]')).toEqual({ code: null, manager: null, description: '[1,2]' });
    expect(parseDepartmentDescription('"quoted"')).toEqual({ code: null, manager: null, description: '"quoted"' });
  });
  it('an object stored as a JSON field value is not shown as text', () => {
    expect(parseDepartmentDescription(JSON.stringify({ code: { a: 1 }, manager: ['x'] }))).toEqual({ code: null, manager: null, description: null });
  });
});

describe('department header', () => {
  it('name, code, manager, status and created date (company time zone)', () => {
    const d = toDepartmentDetail({ id: 'd1', name: 'Engineering', description: JSON.stringify({ code: 'ENG', manager: 'Ravi' }), is_active: true, created_at: '2026-10-19T20:00:00Z', employees: [emp()] });
    expect(d).toEqual({ id: 'd1', name: 'Engineering', code: 'ENG', manager: 'Ravi', description: null, statusLabel: 'Active', created: '20 Oct 2026' });
  });
  it('inactive, missing name and an invalid date', () => {
    const d = toDepartmentDetail({ is_active: false, created_at: 'nope' });
    expect(d).toMatchObject({ name: 'Unnamed department', statusLabel: 'Inactive', created: null, code: null, manager: null });
    expect(formatDepartmentDate(undefined)).toBeNull();
  });
  it('every header value is plain text (the old panel rendered the employees array here)', () => {
    const d = toDepartmentDetail({ id: 'd1', name: 'X', employees: [emp(), emp({ id: 'e2' })], description: '{}' });
    for (const [k, v] of Object.entries(d)) expect(isPlain(v), k).toBe(true);
  });
});

describe('employees in the department', () => {
  it('several employees: names, codes, designation, office and status, sorted by name', () => {
    const rows = toDepartmentEmployeeRows([
      emp({ id: 'e2', first_name: 'Ravi', last_name: 'K', employee_code: 'EMP002', designation: null, status: 'INACTIVE', office: null }),
      emp(),
    ]);
    expect(rows).toEqual([
      { key: 'e1', name: 'Asha Rao', employeeCode: 'EMP001', designation: 'Engineer', office: 'Chennai HQ', statusLabel: 'Active', active: true },
      { key: 'e2', name: 'Ravi K', employeeCode: 'EMP002', designation: null, office: null, statusLabel: 'Inactive', active: false },
    ]);
  });
  it('no employees, or no array at all', () => {
    expect(toDepartmentEmployeeRows([])).toEqual([]);
    expect(toDepartmentEmployeeRows(null)).toEqual([]);
    expect(toDepartmentEmployeeRows({ id: 'e1' })).toEqual([]);
  });
  it('missing names / ids / status and junk entries are handled without inventing data', () => {
    const rows = toDepartmentEmployeeRows([null, 'x', [1], { employee_code: 'EMP009' }, { first_name: '  ' }, { id: 'e3', first_name: 'Zed', office: [{ name: 'Pune' }], status: 'ON_NOTICE' }]);
    expect(rows.map(r => r.name)).toEqual(['EMP009', 'Unnamed employee', 'Zed']);
    expect(rows.find(r => r.name === 'Zed')).toMatchObject({ office: 'Pune', statusLabel: 'ON_NOTICE', active: false });
    expect(rows.find(r => r.name === 'EMP009')).toMatchObject({ statusLabel: 'Unknown', employeeCode: 'EMP009' });
    expect(new Set(rows.map(r => r.key)).size).toBe(rows.length);
  });
  it('object-valued fields never reach the output as objects', () => {
    const [r] = toDepartmentEmployeeRows([emp({ first_name: { x: 1 }, last_name: 'Only', designation: { title: 'Lead' }, office: { name: { en: 'X' } } })]);
    for (const [k, v] of Object.entries(r)) expect(isPlain(v), k).toBe(true);
    expect(r).toMatchObject({ name: 'Only', designation: null, office: null });
  });
});
