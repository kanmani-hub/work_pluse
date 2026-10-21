import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { auditService } from './auditService';
import { supabase } from '../../lib/supabase';
import { exportService } from '../export/exportService';

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      range: vi.fn().mockResolvedValue({ data: [], error: null }),
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: {}, error: null }),
        }),
      }),
    }),
  },
}));

describe('auditService error handling and batching', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const createQueryMock = () => ({
    select: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    range: vi.fn(),
    insert: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: {}, error: null }),
      }),
    }),
  });

  it('getAllAuditLogs returns error when database query fails on first batch', async () => {
    const mockError = { message: 'Database connection failed', code: 'PGRST500' };
    const queryMock = createQueryMock();
    queryMock.range.mockResolvedValue({ data: null, error: mockError });
    (supabase.from as any).mockReturnValue(queryMock);

    const result = await auditService.getAllAuditLogs(10);
    expect(result.data).toBeNull();
    expect(result.error).toEqual(mockError);
  });

  it('getAllAuditLogs returns error when database query fails on subsequent batch', async () => {
    const firstBatch = Array.from({ length: 10 }, (_, i) => ({ id: `row-${i}` }));
    const mockError = { message: 'Network timeout on batch 2', code: 'TIMEOUT' };

    let callCount = 0;
    const queryMock = createQueryMock();
    queryMock.range.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({ data: firstBatch, error: null });
      }
      return Promise.resolve({ data: null, error: mockError });
    });
    (supabase.from as any).mockReturnValue(queryMock);

    const result = await auditService.getAllAuditLogs(10);
    expect(result.data).toBeNull();
    expect(result.error).toEqual(mockError);
  });

  it('getAllAuditLogs aggregates all batches when all succeed', async () => {
    const batch1 = Array.from({ length: 5 }, (_, i) => ({ id: `b1-${i}` }));
    const batch2 = Array.from({ length: 3 }, (_, i) => ({ id: `b2-${i}` }));

    let callCount = 0;
    const queryMock = createQueryMock();
    queryMock.range.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({ data: batch1, error: null });
      }
      return Promise.resolve({ data: batch2, error: null });
    });
    (supabase.from as any).mockReturnValue(queryMock);

    const result = await auditService.getAllAuditLogs(5);
    expect(result.error).toBeNull();
    expect(result.data?.length).toBe(8);
    expect(result.data?.[0].id).toBe('b1-0');
    expect(result.data?.[7].id).toBe('b2-2');
  });
});

describe('Export Service integration for audit logs', () => {
  const sampleRows = [
    {
      id: 'e-1',
      timestamp: '20 Oct 2026, 10:00:00',
      actor: 'Admin User',
      employee_code: 'ADM001',
      role: 'Admin',
      module: 'SECURITY',
      action: 'LOGIN_SUCCESS',
      severity: 'Info',
      result: 'Success',
      description: 'Logged in successfully',
      ip_address: '127.0.0.1',
    },
  ];

  const columns = [
    { header: 'Event ID', key: 'id' },
    { header: 'Actor', key: 'actor' },
    { header: 'Role', key: 'role' },
    { header: 'Module', key: 'module' },
    { header: 'Action', key: 'action' },
    { header: 'Severity', key: 'severity' },
    { header: 'Status', key: 'result' },
  ];

  afterAll(() => {
    try {
      const fs = require('fs');
      if (fs.existsSync('test_audit.xlsx')) fs.unlinkSync('test_audit.xlsx');
    } catch {}
  });

  it('exports CSV without throwing', async () => {
    const filename = await exportService.csv(sampleRows, columns, 'test_audit.csv');
    expect(filename).toBe('test_audit.csv');
  });

  it('exports Excel without throwing', async () => {
    const filename = await exportService.excel(sampleRows, columns, 'test_audit.xlsx');
    expect(filename).toBe('test_audit.xlsx');
  });

  it('exports PDF without throwing', async () => {
    const filename = await exportService.pdf(sampleRows, columns, 'Test Title', 'test_audit.pdf', 'Test Subtitle');
    expect(filename).toBe('test_audit.pdf');
  });
});
