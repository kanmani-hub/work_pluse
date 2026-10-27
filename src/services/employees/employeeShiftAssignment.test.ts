import { describe, it, expect, vi, beforeEach } from 'vitest';
import { employeeService } from './employeeService';
import { supabase } from '../../lib/supabase';
import { companyDateStr } from '../../utils/companyDate';

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
  },
}));

vi.mock('../audit/auditService', () => ({
  auditService: {
    recordAuditLog: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock('../notifications/notificationService', () => ({
  notificationService: {
    notifyEmployee: vi.fn().mockResolvedValue({}),
  },
}));

describe('employeeService.assignShift', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('inserts new assignment with default companyDateStr when effectiveDate is omitted', async () => {
    const today = companyDateStr();
    let insertedPayload: any = null;

    const fromMock = vi.fn().mockImplementation((table: string) => {
      if (table === 'shift_assignments') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
              }),
            }),
          }),
          insert: vi.fn().mockImplementation((payload: any) => {
            insertedPayload = payload;
            return {
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: { id: 'asgn-new' }, error: null }),
              }),
            };
          }),
        };
      }
      if (table === 'shift_templates') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: { name: 'Morning', start_time: '09:00', end_time: '18:00' } }),
            }),
          }),
        };
      }
      return {};
    });

    (supabase.from as any) = fromMock;

    const result = await employeeService.assignShift('emp-123', 'shift-456');

    expect(result.error).toBeNull();
    expect(insertedPayload).toMatchObject({
      employee_id: 'emp-123',
      shift_template_id: 'shift-456',
      effective_date: today,
      assignment_type: 'PERMANENT',
    });
  });

  it('updates existing assignment when one exists on the given effective_date', async () => {
    let updatedPayload: any = null;
    let updatedEqId: string | null = null;

    const fromMock = vi.fn().mockImplementation((table: string) => {
      if (table === 'shift_assignments') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'asgn-existing' }, error: null }),
              }),
            }),
          }),
          update: vi.fn().mockImplementation((payload: any) => {
            updatedPayload = payload;
            return {
              eq: vi.fn().mockImplementation((field: string, id: string) => {
                updatedEqId = id;
                // the service reads the changed rows back to confirm the update was stored
                return { select: vi.fn().mockResolvedValue({ data: [{ id }], error: null }) };
              }),
            };
          }),
        };
      }
      if (table === 'shift_templates') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: { name: 'Night', start_time: '21:00', end_time: '05:00' } }),
            }),
          }),
        };
      }
      return {};
    });

    (supabase.from as any) = fromMock;

    const result = await employeeService.assignShift('emp-123', 'shift-789', '2026-10-15');

    expect(result.error).toBeNull();
    expect(updatedPayload).toEqual({ shift_template_id: 'shift-789' });
    expect(updatedEqId).toBe('asgn-existing');
  });

  it('handles empty string effectiveDate by falling back to companyDateStr', async () => {
    const today = companyDateStr();
    let checkedDate: string | null = null;

    const fromMock = vi.fn().mockImplementation((table: string) => {
      if (table === 'shift_assignments') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockImplementation((_field: string, date: string) => {
                checkedDate = date;
                return {
                  maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                };
              }),
            }),
          }),
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { id: 'asgn-new' }, error: null }),
            }),
          }),
        };
      }
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: null }),
          }),
        }),
      };
    });

    (supabase.from as any) = fromMock;

    await employeeService.assignShift('emp-123', 'shift-456', '');
    expect(checkedDate).toBe(today);
  });

  it('reports an error when the update changed no row (refused by RLS), never success', async () => {
    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'shift_assignments') {
        return {
          select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'asgn-existing' }, error: null }) }) }) }),
          update: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ select: vi.fn().mockResolvedValue({ data: [], error: null }) }) }),
        };
      }
      return { select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ maybeSingle: vi.fn().mockResolvedValue({ data: null }) }) }) };
    });
    const res: any = await employeeService.assignShift('emp-1', 'shift-1', '2026-11-01');
    expect(res.error).toBeInstanceOf(Error);
    expect(res.error.message).toMatch(/not saved/);
  });

  it('returns the lookup error instead of guessing when the existing assignment cannot be read', async () => {
    (supabase.from as any).mockImplementation(() => ({
      select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: { message: 'timeout' } }) }) }) }),
    }));
    const res: any = await employeeService.assignShift('emp-1', 'shift-1', '2026-11-01');
    expect(res.error).toEqual({ message: 'timeout' });
  });
});
