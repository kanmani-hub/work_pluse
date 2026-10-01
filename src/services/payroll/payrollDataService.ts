/**
 * Payroll Data Service
 * 
 * Single source of truth for fetching actual attendance, leave, WFH, and permission data
 * for a given employee + payroll month. Both Admin and Employee views consume this.
 */

import { supabase } from '../../lib/supabase';

export interface PayrollAttendanceSummary {
  workingDays: number;     // from settings or calculated
  presentDays: number;
  absentDays: number;
  lateLogins: number;
  totalLateMinutes: number;
  earlyLogouts: number;
  halfDays: number;
  lopDays: number;
}

export interface PayrollLeaveSummary {
  approvedLeave: number;
  lopLeave: number;
  totalLeaveDays: number;
}

export interface PayrollWfhSummary {
  wfhDays: number;
}

export interface PayrollPermissionSummary {
  permissionCount: number;
  totalMinutes: number;
}

export interface PayrollEmployeeData {
  attendance: PayrollAttendanceSummary;
  leave: PayrollLeaveSummary;
  wfh: PayrollWfhSummary;
  permission: PayrollPermissionSummary;
}

export const payrollDataService = {
  /**
   * Fetch all payroll-relevant data for a specific employee and month.
   * This is the single source of truth — no hardcoded mock values.
   */
  async getEmployeePayrollData(
    employeeId: string,
    year: number,
    month: number
  ): Promise<PayrollEmployeeData> {
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    // Fetch all data in parallel
    const [attendanceResult, leaveResult, wfhResult, permissionResult] = await Promise.all([
      this._fetchAttendance(employeeId, startDate, endDate),
      this._fetchLeave(employeeId, startDate, endDate),
      this._fetchWfh(employeeId, startDate, endDate),
      this._fetchPermissions(employeeId, startDate, endDate),
    ]);

    return {
      attendance: attendanceResult,
      leave: leaveResult,
      wfh: wfhResult,
      permission: permissionResult,
    };
  },

  async _fetchAttendance(
    employeeId: string,
    startDate: string,
    endDate: string
  ): Promise<PayrollAttendanceSummary> {
    try {
      const { data, error } = await supabase
        .from('attendance')
        .select('*')
        .eq('employee_id', employeeId)
        .gte('attendance_date', startDate)
        .lte('attendance_date', endDate);

      if (error || !data) {
        return { workingDays: 0, presentDays: 0, absentDays: 0, lateLogins: 0, totalLateMinutes: 0, earlyLogouts: 0, halfDays: 0, lopDays: 0 };
      }

      const presentDays = data.filter((a: any) =>
        a.status === 'COMPLETED' || a.status === 'WORKING' || a.status === 'PRESENT'
      ).length;

      const lateLogins = data.filter((a: any) =>
        (a.late_minutes && Number(a.late_minutes) > 0)
      ).length;

      const totalLateMinutes = data.reduce((sum: number, a: any) => sum + (Number(a.late_minutes) || 0), 0);

      const earlyLogouts = data.filter((a: any) =>
        (a.early_logout_minutes && Number(a.early_logout_minutes) > 0)
      ).length;

      const halfDays = data.filter((a: any) => a.is_half_day === true).length;

      // Calculate working days as total days with attendance records
      // (this represents actual working days in the month for this employee)
      const workingDays = data.length;

      return {
        workingDays,
        presentDays,
        absentDays: Math.max(0, workingDays - presentDays),
        lateLogins,
        totalLateMinutes,
        earlyLogouts,
        halfDays,
        lopDays: 0, // Will be computed from leave data
      };
    } catch (err) {
      console.error('Error fetching attendance for payroll:', err);
      return { workingDays: 0, presentDays: 0, absentDays: 0, lateLogins: 0, totalLateMinutes: 0, earlyLogouts: 0, halfDays: 0, lopDays: 0 };
    }
  },

  async _fetchLeave(
    employeeId: string,
    startDate: string,
    endDate: string
  ): Promise<PayrollLeaveSummary> {
    try {
      const { data, error } = await supabase
        .from('leave_requests')
        .select('*, leave_types(name, code)')
        .eq('employee_id', employeeId)
        .in('status', ['APPROVED', 'PENDING'])
        .lte('start_date', endDate)
        .gte('end_date', startDate);

      if (error || !data) {
        return { approvedLeave: 0, lopLeave: 0, totalLeaveDays: 0 };
      }

      let approvedLeave = 0;
      let lopLeave = 0;

      for (const req of data) {
        const r = req as any;
        // Calculate overlap with payroll month
        const reqStart = new Date(r.start_date);
        const reqEnd = new Date(r.end_date);
        const monthStart = new Date(startDate);
        const monthEnd = new Date(endDate);

        const overlapStart = reqStart > monthStart ? reqStart : monthStart;
        const overlapEnd = reqEnd < monthEnd ? reqEnd : monthEnd;
        let overlapDays = Math.ceil((overlapEnd.getTime() - overlapStart.getTime()) / (1000 * 60 * 60 * 24)) + 1;
        if (r.is_half_day && overlapDays === 1) overlapDays = 0.5;
        if (overlapDays < 0) overlapDays = 0;

        if (r.status === 'APPROVED') {
          // Check if leave type is LOP/unpaid
          const leaveCode = r.leave_types?.code?.toUpperCase() || '';
          const leaveName = r.leave_types?.name?.toUpperCase() || '';
          if (leaveCode === 'LOP' || leaveCode === 'LOSS_OF_PAY' || leaveName.includes('LOSS OF PAY') || leaveName.includes('LOP') || leaveName.includes('UNPAID')) {
            lopLeave += overlapDays;
          } else {
            approvedLeave += overlapDays;
          }
        }
      }

      return {
        approvedLeave,
        lopLeave,
        totalLeaveDays: approvedLeave + lopLeave,
      };
    } catch (err) {
      console.error('Error fetching leave for payroll:', err);
      return { approvedLeave: 0, lopLeave: 0, totalLeaveDays: 0 };
    }
  },

  async _fetchWfh(
    employeeId: string,
    startDate: string,
    endDate: string
  ): Promise<PayrollWfhSummary> {
    try {
      const { data, error } = await supabase
        .from('wfh_requests')
        .select('*')
        .eq('employee_id', employeeId)
        .eq('status', 'APPROVED')
        .lte('start_date', endDate)
        .gte('end_date', startDate);

      if (error || !data) {
        return { wfhDays: 0 };
      }

      let wfhDays = 0;
      for (const req of data) {
        const r = req as any;
        const reqStart = new Date(r.start_date);
        const reqEnd = new Date(r.end_date);
        const monthStart = new Date(startDate);
        const monthEnd = new Date(endDate);

        const overlapStart = reqStart > monthStart ? reqStart : monthStart;
        const overlapEnd = reqEnd < monthEnd ? reqEnd : monthEnd;
        const days = Math.ceil((overlapEnd.getTime() - overlapStart.getTime()) / (1000 * 60 * 60 * 24)) + 1;
        wfhDays += Math.max(0, days);
      }

      return { wfhDays };
    } catch (err) {
      console.error('Error fetching WFH for payroll:', err);
      return { wfhDays: 0 };
    }
  },

  async _fetchPermissions(
    employeeId: string,
    startDate: string,
    endDate: string
  ): Promise<PayrollPermissionSummary> {
    try {
      const { data, error } = await supabase
        .from('permission_requests')
        .select('*')
        .eq('employee_id', employeeId)
        .eq('status', 'APPROVED')
        .gte('permission_date', startDate)
        .lte('permission_date', endDate);

      if (error || !data) {
        return { permissionCount: 0, totalMinutes: 0 };
      }

      const totalMinutes = data.reduce((sum: number, r: any) => sum + Number(r.duration_minutes || 0), 0);

      return {
        permissionCount: data.length,
        totalMinutes,
      };
    } catch (err) {
      console.error('Error fetching permissions for payroll:', err);
      return { permissionCount: 0, totalMinutes: 0 };
    }
  },
};
