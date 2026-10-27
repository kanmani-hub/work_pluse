import { describe, it, expect, vi } from 'vitest';
import { parseCsv, validateImport, runEmployeeImport, importSummary, IMPORT_TEMPLATE_CSV } from './employeeImportRules';

const ctx = {
  existingEmails: ['taken@example.com'],
  departments: [{ id: 'd1', name: 'Engineering' }],
  offices: [{ id: 'o1', name: 'Head Office' }],
  roles: [{ id: 'r-emp', name: 'EMPLOYEE' }, { id: 'r-hr', name: 'HR' }, { id: 'r-adm', name: 'ADMIN' }],
};
const H = 'first_name,last_name,email,joining_date,password,department,office,role,employment_type';

describe('employee CSV import rules', () => {
  it('parses quotes, commas, CRLF and a BOM', () => {
    expect(parseCsv('﻿a,"b, c","d ""q"""\r\n1,2,3\r\n\r\n')).toEqual([['a', 'b, c', 'd "q"'], ['1', '2', '3']]);
  });

  it('the template is a valid file', () => {
    const r = validateImport(IMPORT_TEMPLATE_CSV, ctx);
    expect(r.headerErrors).toEqual([]);
    expect(r.valid).toHaveLength(1);
  });

  it('reports missing required columns', () => {
    expect(validateImport('first_name,email\nA,a@example.com', ctx).headerErrors[0]).toMatch(/last_name, joining_date, password/);
  });

  it('validates each row and maps names to ids', () => {
    const csv = [H,
      'Ann,Lee,ANN@example.com,2026-11-01,Password-1,Engineering,Head Office,HR,part time',
      'Bob,,bob@example.com,2026-13-01,short,Sales,,ADMIN,Intern',
      'Cy,Doe,taken@example.com,2026-11-01,Password-1,,,,',
      'Di,Doe,ann@example.com,2026-11-01,Password-1,,,,',
    ].join('\n');
    const r = validateImport(csv, ctx);
    expect(r.valid.map((x) => x.line)).toEqual([2]);
    expect(r.valid[0].payload).toMatchObject({ email: 'ann@example.com', department_id: 'd1', office_id: 'o1', role_id: 'r-hr', employment_type: 'Part Time', status: 'ACTIVE' });
    const bob = r.invalid.find((x) => x.line === 3)!;
    expect(bob.errors.join(' ')).toMatch(/last_name is required/);
    expect(bob.errors.join(' ')).toMatch(/joining_date must be/);
    expect(bob.errors.join(' ')).toMatch(/at least 8/);
    expect(bob.errors.join(' ')).toMatch(/Unknown department/);
    expect(bob.errors.join(' ')).toMatch(/administrators are created individually/);
    expect(bob.errors.join(' ')).toMatch(/employment_type/);
    expect(r.invalid.find((x) => x.line === 4)!.errors[0]).toMatch(/already exists/);
    expect(r.invalid.find((x) => x.line === 5)!.errors[0]).toMatch(/Duplicate e-mail in this file/);
  });

  it('imports only valid rows, one by one, and reports server rejections per row', async () => {
    const r = validateImport([H, 'A,One,a@example.com,2026-11-01,Password-1,,,,', 'B,Two,b@example.com,2026-11-01,Password-1,,,,', 'C,Three,c@example.com,2026-11-01,Password-1,,,,'].join('\n'), ctx);
    const create = vi.fn()
      .mockResolvedValueOnce({ data: { id: 'n1' }, error: null })
      .mockResolvedValueOnce({ data: null, error: new Error('User already registered') })
      .mockRejectedValueOnce(new Error('Failed to fetch'));
    const progress = vi.fn();
    const res = await runEmployeeImport(r.valid, create, progress);
    expect(create).toHaveBeenCalledTimes(3);
    expect(res.created).toEqual([{ line: 2, email: 'a@example.com', id: 'n1' }]);
    expect(res.failed.map((f) => f.message)).toEqual(['User already registered', 'Failed to fetch']);
    expect(progress).toHaveBeenLastCalledWith(3, 3);
    expect(importSummary(res, 0)).toEqual({ status: 'partial', message: '1 imported, 2 rejected by the server.' });
  });

  it('summary never reports full success when rows were skipped or nothing was created', () => {
    expect(importSummary({ created: [{ line: 2, email: 'a' }], failed: [] }, 0).status).toBe('success');
    expect(importSummary({ created: [{ line: 2, email: 'a' }], failed: [] }, 2).status).toBe('partial');
    expect(importSummary({ created: [], failed: [{ line: 2, email: 'a', message: 'x' }] }, 0).status).toBe('failed');
  });
});
