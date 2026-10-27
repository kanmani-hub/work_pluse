import { describe, it, expect, vi, beforeEach } from 'vitest';

// Regression tests for the audit-log integration with migration 20261022090300_audit_log_integrity.sql
const insert = vi.fn();
const select = vi.fn();
vi.mock('../../lib/supabase', () => ({
  supabase: { from: vi.fn(() => ({ insert: (row: any) => { insert(row); return Object.assign(Promise.resolve(insertResult), { select }); } })) },
}));
let actor: string | null = 'emp-1';
vi.mock('../payroll/salaryService', () => ({ salaryService: { getCurrentEmployeeId: vi.fn(async () => actor) } }));
let insertResult: any = { error: null };

import { auditService } from './auditService';

describe('auditService.recordAuditLog (audit integrity)', () => {
  beforeEach(() => { insert.mockClear(); select.mockClear(); actor = 'emp-1'; insertResult = { error: null }; });

  it('writes the entry in the signed-in employee\'s own name, without reading it back', async () => {
    const res = await auditService.recordAuditLog({ action: 'LEAVE_CANCELLED', module: 'LEAVE', entity_id: 'x' });
    expect(res.error).toBeNull();
    expect(insert).toHaveBeenCalledTimes(1);
    const row = insert.mock.calls[0][0];
    expect(row.actor_employee_id).toBe('emp-1');
    expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(row).not.toHaveProperty('created_at');   // database time only
    expect(select).not.toHaveBeenCalled();            // employees may not read audit_logs (RLS)
    expect(res.data?.id).toBe(row.id);
  });

  it('does not send an entry when no employee is signed in, and reports it', async () => {
    actor = null;
    const res = await auditService.recordAuditLog({ action: 'X', module: 'AUTH' });
    expect(insert).not.toHaveBeenCalled();
    expect(res.error).toBeInstanceOf(Error);
    expect(res.data).toBeNull();
  });

  it('never sends a SYSTEM source from the browser', async () => {
    await auditService.recordAuditLog({ action: 'X', module: 'AUTH', source: 'SYSTEM' });
    expect(insert.mock.calls[0][0].source).toBe('WEB');
    await auditService.recordAuditLog({ action: 'X', module: 'AUTH', source: 'ADMIN' });
    expect(insert.mock.calls[1][0].source).toBe('ADMIN');
  });

  it('returns the database refusal instead of reporting success', async () => {
    insertResult = { error: { code: '42501', message: 'new row violates row-level security policy' } };
    const res = await auditService.recordAuditLog({ action: 'X', module: 'AUTH' });
    expect((res.error as any)?.code).toBe('42501');
    expect(res.data).toBeNull();
  });
});
