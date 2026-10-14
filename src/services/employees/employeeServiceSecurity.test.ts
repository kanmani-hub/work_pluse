import { describe, it, expect, vi, beforeEach } from 'vitest';

const invoke = vi.fn();
const getSession = vi.fn();
const update = vi.fn();

vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: { getSession: (...a: any[]) => getSession(...a) },
    functions: { invoke: (...a: any[]) => invoke(...a) },
    from: (table: string) => {
      if (table !== 'employees') throw new Error('unexpected table ' + table);
      const chain: any = {
        select: () => chain,
        order: async () => ({
          data: [
            { id: '1', email: 'admin@gmail.com', role: { name: 'ADMIN' } },
            { id: '2', email: 'emp@example.com', role: { name: 'EMPLOYEE' } },
          ],
          error: null,
        }),
        eq: () => chain,
        maybeSingle: async () => ({ data: { status: 'ACTIVE' }, error: null }),
        update: (payload: any) => { update(payload); return chain; },
        single: async () => ({ data: { id: '2', status: 'INACTIVE' }, error: null }),
      };
      return chain;
    },
  },
}));
vi.mock('../audit/auditService', () => ({ auditService: { recordAuditLog: vi.fn(async () => ({})) } }));
vi.mock('../notifications/notificationService', () => ({ notificationService: { notifyEmployee: vi.fn(async () => ({})) } }));

import { employeeService, readFunctionErrorMessage } from './employeeService';

beforeEach(() => {
  invoke.mockReset();
  update.mockReset();
  getSession.mockResolvedValue({ data: { session: { access_token: 'tok' } } });
});

describe('C1: no account is special-cased by email', () => {
  it('getEmployees returns every row, including admin@gmail.com', async () => {
    const { data, error } = await employeeService.getEmployees();
    expect(error).toBeNull();
    expect(data?.map(e => e.email)).toEqual(['admin@gmail.com', 'emp@example.com']);
  });
});

describe('N2: deactivate writes the status the app checks', () => {
  it("deactivateEmployee sets status 'INACTIVE' (not 'Inactive')", async () => {
    await employeeService.deactivateEmployee('2');
    expect(update).toHaveBeenCalledWith({ status: 'INACTIVE' });
  });
});

describe('C3: delete-employee refusals reach the admin', () => {
  it('reads the reason from a non-2xx response body', async () => {
    const body = { success: false, code: 'HAS_HISTORY', error: 'This employee has records (payroll). … deactivate the employee instead.' };
    invoke.mockResolvedValue({
      data: null,
      error: { message: 'Edge Function returned a non-2xx status code', context: new Response(JSON.stringify(body), { status: 409 }) },
    });
    const r = await employeeService.deleteEmployee('2');
    expect(r.success).toBe(false);
    expect(r.error?.message).toMatch(/deactivate the employee instead/);
  });

  it('falls back to the generic message when the body is not JSON', async () => {
    const msg = await readFunctionErrorMessage({ message: 'network down', context: new Response('oops', { status: 500 }) });
    expect(msg).toBe('network down');
  });

  it('reports success only when the function says so', async () => {
    invoke.mockResolvedValue({ data: { success: true }, error: null });
    expect((await employeeService.deleteEmployee('2')).success).toBe(true);
    invoke.mockResolvedValue({ data: { success: false, error: 'Only an administrator can delete employees.' }, error: null });
    const r = await employeeService.deleteEmployee('2');
    expect(r.success).toBe(false);
    expect(r.error?.message).toMatch(/administrator/);
  });
});
