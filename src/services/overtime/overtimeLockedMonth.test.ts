import { describe, it, expect, vi, beforeEach } from 'vitest';
import { overtimeService } from './overtimeService';
import { attendanceService } from '../attendance/attendanceService';
import { auditService } from '../audit/auditService';
import { notificationService } from '../notifications/notificationService';
import { supabase } from '../../lib/supabase';

vi.mock('../attendance/attendanceService');
vi.mock('../audit/auditService');
vi.mock('../notifications/notificationService');
// Minimal table stand-in: overtime_requests + payroll; records every update.
vi.mock('../../lib/supabase', () => {
  const db: any = { tables: { overtime_requests: [], payroll: [] }, updates: [], payrollReadError: null };
  const from = (t: string) => {
    const q: any = { t, op: 'select', filters: [], payload: null, one: null };
    const run = () => {
      if (t === 'payroll' && db.payrollReadError) return { data: null, error: db.payrollReadError };
      const rows = db.tables[t] || [];
      const hit = rows.filter((r: any) => q.filters.every(([c, v]: any) => r[c] === v));
      if (q.op === 'update') { hit.forEach((r: any) => Object.assign(r, q.payload)); db.updates.push({ t, payload: q.payload }); return { data: hit.map((r: any) => ({ id: r.id })), error: null }; }
      if (q.one) return { data: hit[0] ? { ...hit[0] } : null, error: null };
      return { data: hit.map((r: any) => ({ ...r })), error: null };
    };
    const b: any = {
      select: () => b, update: (p: any) => { q.op = 'update'; q.payload = p; return b; },
      eq: (c: string, v: any) => { q.filters.push([c, v]); return b; },
      maybeSingle: () => { q.one = 'maybe'; return b; }, single: () => { q.one = 'single'; return b; },
      then: (res: any, rej: any) => Promise.resolve().then(run).then(res, rej),
    };
    return b;
  };
  return { supabase: { from, __db: db } };
});

const db = (supabase as any).__db;
const req = { id: 'ot1', employee_id: 'e1', work_date: '2026-09-29', status: 'PENDING', requested_overtime_hours: 2, eligible_overtime_hours: 2, approved_overtime_hours: null };

beforeEach(() => {
  vi.clearAllMocks();
  (attendanceService.getCurrentEmployeeId as any).mockResolvedValue('admin1');
  (auditService.recordAuditLog as any).mockResolvedValue({ data: null, error: null });
  (notificationService.notifyEmployee as any).mockResolvedValue({ data: null, error: null, skipped: false });
  db.tables = { overtime_requests: [{ ...req }], payroll: [] };
  db.updates = []; db.payrollReadError = null;
});

describe('overtime cannot be approved for a month whose payroll is locked', () => {
  for (const status of ['APPROVED', 'PAYMENT_PENDING', 'PAID', 'CLOSED']) {
    it(`blocked when September payroll is ${status}`, async () => {
      db.tables.payroll = [{ employee_id: 'e1', payroll_year: 2026, payroll_month: 9, status }];
      const r = await overtimeService.reviewRequest('ot1', 'APPROVED', 2);
      expect(r.error?.message).toMatch('overtime for that month can no longer be approved');
      expect(db.updates.length).toBe(0);
      expect(db.tables.overtime_requests[0].status).toBe('PENDING');
    });
  }

  it('allowed while the payroll is not locked (UNDER_REVIEW) or not generated yet', async () => {
    db.tables.payroll = [{ employee_id: 'e1', payroll_year: 2026, payroll_month: 9, status: 'UNDER_REVIEW' }];
    expect((await overtimeService.reviewRequest('ot1', 'APPROVED', 1.5)).error).toBeNull();
    expect(db.tables.overtime_requests[0].status).toBe('APPROVED');
    db.tables = { overtime_requests: [{ ...req }], payroll: [] };
    expect((await overtimeService.reviewRequest('ot1', 'APPROVED', 2)).error).toBeNull();
  });

  it('another month being locked does not block it', async () => {
    db.tables.payroll = [{ employee_id: 'e1', payroll_year: 2026, payroll_month: 8, status: 'PAID' }];
    expect((await overtimeService.reviewRequest('ot1', 'APPROVED', 2)).error).toBeNull();
  });

  it('rejecting is still allowed for a locked month', async () => {
    db.tables.payroll = [{ employee_id: 'e1', payroll_year: 2026, payroll_month: 9, status: 'PAID' }];
    expect((await overtimeService.reviewRequest('ot1', 'REJECTED', null, 'Not needed')).error).toBeNull();
    expect(db.tables.overtime_requests[0].status).toBe('REJECTED');
  });

  it('if the payroll status cannot be checked, the approval is not saved', async () => {
    db.payrollReadError = { message: 'offline' };
    const r = await overtimeService.reviewRequest('ot1', 'APPROVED', 2);
    expect(r.error?.message).toBe("Could not check this month's payroll status, so the overtime was not approved. Please try again.");
    expect(db.updates.length).toBe(0);
  });
});
