import { describe, it, expect } from 'vitest';
import {
  mapLeaveExportRow,
  mapWfhExportRow,
  mapPermissionExportRow,
  mapOvertimeExportRow,
  LEAVE_EXPORT_COLUMNS,
  WFH_EXPORT_COLUMNS,
  PERMISSION_EXPORT_COLUMNS,
  OVERTIME_EXPORT_COLUMNS,
} from './adminExportRules';

describe('Admin Export Mapping Rules', () => {
  it('maps Leave records correctly with employee name and leave type', () => {
    // Representative UI record produced by fetchRequests in Leave.tsx
    const uiLeaveRecord = {
      id: 'leave-1',
      empId: 'EMP-101',
      name: 'Ravi Kumar',
      dept: 'Engineering',
      department_id: 'dept-1',
      type: 'Casual Leave',
      employee_id: 'emp-1',
      leave_type_id: 'lt-1',
      dates: '12 Oct - 14 Oct',
      duration: '3 Days',
      reason: 'Family function',
      status: 'APPROVED',
      appliedOn: '10 Oct 2026',
      start_date: '2026-10-12',
      end_date: '2026-10-14',
      total_days: 3,
      requested_at: '2026-10-10T09:30:00Z',
    };

    const row = mapLeaveExportRow(uiLeaveRecord);
    expect(row.employee).toBe('Ravi Kumar');
    expect(row.code).toBe('EMP-101');
    expect(row.department).toBe('Engineering');
    expect(row.leave_type).toBe('Casual Leave');
    expect(row.start_date).toBe('2026-10-12');
    expect(row.end_date).toBe('2026-10-14');
    expect(row.total_days).toBe(3);
    expect(row.status).toBe('APPROVED');
    expect(row.reason).toBe('Family function');
    expect(row.requested_at).not.toBe('-');

    // Ensure all column keys exist in mapped row
    for (const col of LEAVE_EXPORT_COLUMNS) {
      expect(row[col.key]).toBeDefined();
      expect(row[col.key]).not.toBe('-');
    }
  });

  it('maps WFH records correctly with employee name and WFH date', () => {
    // Representative UI record produced by fetchRequests in Wfh.tsx
    const uiWfhRecord = {
      id: 'wfh-1',
      employee: 'Priya Sharma',
      employeeId: 'EMP-102',
      department: 'Product',
      department_id: 'dept-2',
      date: '15 Oct 2026',
      type: 'Full Day',
      duration: '1 Day',
      reason: 'Home repairs and wifi maintenance',
      status: 'PENDING',
      submittedAt: '12 Oct 2026',
      requestDate: '2026-10-15',
      requested_at: '2026-10-12T08:00:00Z',
      reviewed_at: null,
    };

    const row = mapWfhExportRow(uiWfhRecord);
    expect(row.employee).toBe('Priya Sharma');
    expect(row.code).toBe('EMP-102');
    expect(row.department).toBe('Product');
    expect(row.request_date).toBe('2026-10-15');
    expect(row.status).toBe('PENDING');
    expect(row.reason).toBe('Home repairs and wifi maintenance');
    expect(row.requested_at).not.toBe('-');
    expect(row.reviewed_at).toBe('-'); // null reviewed_at should cleanly fallback to '-'

    for (const col of WFH_EXPORT_COLUMNS) {
      expect(row[col.key]).toBeDefined();
    }
  });

  it('maps Permission records correctly with employee name, time, and duration', () => {
    // Representative UI record produced by fetchRequests in Permission.tsx
    const uiPermRecord = {
      id: 'perm-1',
      empId: 'EMP-103',
      name: 'Anil Verma',
      dept: 'Finance',
      department_id: 'dept-3',
      date: '16 Oct 2026',
      startTime: '10:00 AM',
      endTime: '12:00 PM',
      duration: '2h 0m',
      reason: 'Doctor appointment',
      status: 'APPROVED',
      dateISO: '2026-10-16',
      startRaw: '10:00:00',
      endRaw: '12:00:00',
      minutes: 120,
      requested_at: '2026-10-15T11:00:00Z',
    };

    const row = mapPermissionExportRow(uiPermRecord);
    expect(row.employee).toBe('Anil Verma');
    expect(row.code).toBe('EMP-103');
    expect(row.department).toBe('Finance');
    expect(row.permission_date).toBe('2026-10-16');
    expect(row.start_time).toBe('10:00 AM');
    expect(row.end_time).toBe('12:00 PM');
    expect(row.duration).toBe('2h 0m');
    expect(row.status).toBe('APPROVED');
    expect(row.reason).toBe('Doctor appointment');

    for (const col of PERMISSION_EXPORT_COLUMNS) {
      expect(row[col.key]).toBeDefined();
      expect(row[col.key]).not.toBe('-');
    }
  });

  it('maps Overtime records correctly with shift and hour totals', () => {
    const rawOtRecord = {
      id: 'ot-1',
      employee: {
        first_name: 'Karan',
        last_name: 'Mehta',
        employee_code: 'EMP-104',
        departments: { name: 'Operations' },
      },
      shift: {
        name: 'General Shift',
        start_time: '09:00:00',
        end_time: '18:00:00',
      },
      attendance_date: '2026-10-18',
      requested_overtime_hours: 2.5,
      eligible_overtime_hours: 2.5,
      approved_overtime_hours: 2.0,
      status: 'APPROVED',
      reason: 'Month-end ledger balancing',
      reviewer_remarks: 'Approved 2 hours',
    };

    const row = mapOvertimeExportRow(rawOtRecord);
    expect(row.employee).toBe('Karan Mehta');
    expect(row.code).toBe('EMP-104');
    expect(row.department).toBe('Operations');
    expect(row.date).toBe('2026-10-18');
    expect(row.shift).toBe('General Shift');
    expect(row.requested_hours).toBe('2.5h');
    expect(row.eligible_hours).toBe('2.5h');
    expect(row.approved_hours).toBe('2.0h');
    expect(row.status).toBe('APPROVED');
    expect(row.reason).toBe('Month-end ledger balancing');
    expect(row.remarks).toBe('Approved 2 hours');

    for (const col of OVERTIME_EXPORT_COLUMNS) {
      expect(row[col.key]).toBeDefined();
    }
  });
});
