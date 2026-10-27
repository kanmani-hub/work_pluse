/**
 * Pure mapping rules for Admin exports (Leave, WFH, Permission, Overtime).
 * Maps displayed UI records or raw records to human-readable rows with no blank/missing columns.
 */

export interface ExportColumn {
  header: string;
  key: string;
  width?: number;
}

export const LEAVE_EXPORT_COLUMNS: ExportColumn[] = [
  { header: 'Employee', key: 'employee', width: 22 },
  { header: 'Employee ID', key: 'code', width: 14 },
  { header: 'Department', key: 'department', width: 18 },
  { header: 'Leave Type', key: 'leave_type', width: 16 },
  { header: 'Start Date', key: 'start_date', width: 14 },
  { header: 'End Date', key: 'end_date', width: 14 },
  { header: 'Days', key: 'total_days', width: 10 },
  { header: 'Status', key: 'status', width: 14 },
  { header: 'Reason', key: 'reason', width: 30 },
  { header: 'Requested At', key: 'requested_at', width: 16 },
];

export function mapLeaveExportRow(r: any): Record<string, any> {
  const employeeName =
    r.name && r.name !== 'Unknown'
      ? r.name
      : r.employees
      ? `${r.employees.first_name || ''} ${r.employees.last_name || ''}`.trim()
      : r.employee || '-';

  const leaveTypeName = r.type && r.type !== '-' ? r.type : r.leave_types?.name || r.leave_type || '-';
  const employeeCode = r.empId && r.empId !== '-' ? r.empId : r.employees?.employee_code || r.code || '-';
  const departmentName = r.dept && r.dept !== '-' ? r.dept : r.employees?.departments?.name || r.department || '-';

  const requestedAtFormatted = r.requested_at
    ? new Date(r.requested_at).toLocaleDateString('en-IN')
    : r.appliedOn || '-';

  return {
    employee: employeeName || '-',
    code: employeeCode || '-',
    department: departmentName || '-',
    leave_type: leaveTypeName || '-',
    start_date: r.start_date || (r.dates ? r.dates.split(' - ')[0] : '-'),
    end_date: r.end_date || (r.dates ? r.dates.split(' - ')[1] || r.dates : '-'),
    total_days: r.total_days != null ? r.total_days : (r.duration ? r.duration.replace(/ Days?/i, '') : '-'),
    status: r.status || '-',
    reason: r.reason || '-',
    requested_at: requestedAtFormatted,
  };
}

export const WFH_EXPORT_COLUMNS: ExportColumn[] = [
  { header: 'Employee', key: 'employee', width: 22 },
  { header: 'Employee ID', key: 'code', width: 14 },
  { header: 'Department', key: 'department', width: 18 },
  { header: 'WFH Date', key: 'request_date', width: 14 },
  { header: 'Status', key: 'status', width: 14 },
  { header: 'Reason', key: 'reason', width: 30 },
  { header: 'Requested At', key: 'requested_at', width: 16 },
  { header: 'Reviewed At', key: 'reviewed_at', width: 16 },
];

export function mapWfhExportRow(r: any): Record<string, any> {
  const employeeName =
    r.employee && r.employee !== 'Unknown'
      ? r.employee
      : r.employees
      ? `${r.employees.first_name || ''} ${r.employees.last_name || ''}`.trim()
      : r.name || '-';

  const employeeCode = r.employeeId && r.employeeId !== '-' ? r.employeeId : r.employees?.employee_code || r.code || '-';
  const departmentName = r.department && r.department !== '-' ? r.department : r.employees?.departments?.name || r.dept || '-';

  const wfhDate = r.requestDate || r.request_date || r.date || '-';
  const requestedAtFormatted = r.requested_at
    ? new Date(r.requested_at).toLocaleDateString('en-IN')
    : r.submittedAt || '-';
  const reviewedAtFormatted = r.reviewed_at
    ? new Date(r.reviewed_at).toLocaleDateString('en-IN')
    : '-';

  return {
    employee: employeeName || '-',
    code: employeeCode || '-',
    department: departmentName || '-',
    request_date: wfhDate,
    status: r.status || '-',
    reason: r.reason || '-',
    requested_at: requestedAtFormatted,
    reviewed_at: reviewedAtFormatted,
  };
}

export const PERMISSION_EXPORT_COLUMNS: ExportColumn[] = [
  { header: 'Employee', key: 'employee', width: 22 },
  { header: 'Employee ID', key: 'code', width: 14 },
  { header: 'Department', key: 'department', width: 18 },
  { header: 'Date', key: 'permission_date', width: 14 },
  { header: 'Start Time', key: 'start_time', width: 12 },
  { header: 'End Time', key: 'end_time', width: 12 },
  { header: 'Duration', key: 'duration', width: 14 },
  { header: 'Status', key: 'status', width: 14 },
  { header: 'Reason', key: 'reason', width: 30 },
];

export function mapPermissionExportRow(r: any): Record<string, any> {
  const employeeName =
    r.name && r.name !== 'Unknown'
      ? r.name
      : r.employees
      ? `${r.employees.first_name || ''} ${r.employees.last_name || ''}`.trim()
      : r.employee || '-';

  const employeeCode = r.empId && r.empId !== '-' ? r.empId : r.employees?.employee_code || r.code || '-';
  const departmentName = r.dept && r.dept !== '-' ? r.dept : r.employees?.departments?.name || r.department || '-';

  const permissionDate = r.dateISO || r.permission_date || r.date || '-';
  const startTime = r.startTime || r.startRaw || r.start_time || '-';
  const endTime = r.endTime || r.endRaw || r.end_time || '-';
  const duration = r.duration || (r.minutes ? `${r.minutes}m` : r.duration_minutes ? `${r.duration_minutes}m` : '-');

  return {
    employee: employeeName || '-',
    code: employeeCode || '-',
    department: departmentName || '-',
    permission_date: permissionDate,
    start_time: startTime,
    end_time: endTime,
    duration,
    status: r.status || '-',
    reason: r.reason || '-',
  };
}

export const OVERTIME_EXPORT_COLUMNS: ExportColumn[] = [
  { header: 'Employee', key: 'employee', width: 22 },
  { header: 'Employee ID', key: 'code', width: 14 },
  { header: 'Department', key: 'department', width: 18 },
  { header: 'Date', key: 'date', width: 14 },
  { header: 'Shift', key: 'shift', width: 18 },
  { header: 'Requested Hours', key: 'requested_hours', width: 16 },
  { header: 'Eligible Hours', key: 'eligible_hours', width: 16 },
  { header: 'Approved Hours', key: 'approved_hours', width: 16 },
  { header: 'Status', key: 'status', width: 14 },
  { header: 'Reason', key: 'reason', width: 30 },
  { header: 'Remarks', key: 'remarks', width: 30 },
];

export function mapOvertimeExportRow(r: any): Record<string, any> {
  const employeeName = r.employee
    ? `${r.employee.first_name || ''} ${r.employee.last_name || ''}`.trim()
    : r.employees
    ? `${r.employees.first_name || ''} ${r.employees.last_name || ''}`.trim()
    : r.name || '-';

  const employeeCode = r.employee?.employee_code || r.employees?.employee_code || r.code || '-';
  const departmentName = r.employee?.departments?.name || r.employees?.departments?.name || r.department || '-';
  const shiftName = r.shift?.name || (r.shift_templates ? r.shift_templates.name : '-');

  return {
    employee: employeeName || '-',
    code: employeeCode || '-',
    department: departmentName || '-',
    date: r.attendance_date || r.date || '-',
    shift: shiftName,
    requested_hours: r.requested_overtime_hours != null ? `${Number(r.requested_overtime_hours).toFixed(1)}h` : '-',
    eligible_hours: r.eligible_overtime_hours != null ? `${Number(r.eligible_overtime_hours).toFixed(1)}h` : '-',
    approved_hours: r.approved_overtime_hours != null ? `${Number(r.approved_overtime_hours).toFixed(1)}h` : '-',
    status: r.status || 'PENDING',
    reason: r.reason || '-',
    remarks: r.reviewer_remarks || r.remarks || '-',
  };
}
