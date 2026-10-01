import { supabase } from '../../lib/supabase';

export const reportService = {
  /**
   * KPI Dashboard Metrics
   */
  async getDashboardMetrics(startDate: string, endDate: string) {
    // Basic employee count
    const { count: totalEmployees } = await supabase.from('employees').select('id', { count: 'exact', head: true });

    // Fetch attendance for the range
    const { data: attendanceLogs } = await supabase.from('attendance')
      .select('id, status, clock_in, late_minutes, early_logout_minutes, work_minutes, date')
      .gte('date', startDate)
      .lte('date', endDate);

    // Fetch WFH for the range
    const { count: wfhCount } = await supabase.from('wfh_requests')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'APPROVED')
      .gte('request_date', startDate)
      .lte('request_date', endDate);

    // Fetch Leave for the range
    const { count: leaveCount } = await supabase.from('leave_requests')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'APPROVED')
      .gte('start_date', startDate)
      .lte('end_date', endDate);

    // Fetch Payroll for the range
    const startMonth = new Date(startDate).getMonth() + 1;
    const startYear = new Date(startDate).getFullYear();
    const { data: payrollData } = await supabase.from('payroll')
      .select('net_salary')
      .in('status', ['APPROVED', 'PAYMENT_PENDING', 'PAID'])
      .eq('payroll_month', startMonth)
      .eq('payroll_year', startYear);

    let totalPayroll = 0;
    if (payrollData) {
      for (const p of (payrollData as any[])) {
         totalPayroll += p.net_salary || 0;
      }
    }

    let present = 0;
    let late = 0;
    let earlyLogout = 0;
    let totalWorkMinutes = 0;
    let presentDays = 0;

    if (attendanceLogs) {
      for (const log of (attendanceLogs as any[])) {
        if (log.status === 'PRESENT' || log.status === 'HALF_DAY') present++;
        if (log.late_minutes && log.late_minutes > 0) late++;
        if (log.early_logout_minutes && log.early_logout_minutes > 0) earlyLogout++;
        if (log.work_minutes) {
          totalWorkMinutes += log.work_minutes;
          presentDays++;
        }
      }
    }

    const attendanceRate = totalEmployees && totalEmployees > 0 && attendanceLogs ? (present / (totalEmployees * (attendanceLogs.length ? (attendanceLogs.length/totalEmployees) : 1))) * 100 : 0;
    const avgWorkMin = presentDays > 0 ? totalWorkMinutes / presentDays : 0;
    const avgHours = Math.floor(avgWorkMin / 60);
    const avgMins = Math.floor(avgWorkMin % 60);

    return {
      totalEmployees: totalEmployees || 0,
      attendanceRate: attendanceRate.toFixed(1) + '%',
      presentToday: present, // Not strictly today, based on range
      lateArrivals: late,
      earlyLogouts: earlyLogout,
      wfhEmployees: wfhCount || 0,
      onLeave: leaveCount || 0,
      avgWorkingHours: `${avgHours}h ${avgMins}m`,
      payrollProcessed: `₹${(totalPayroll / 100000).toFixed(1)}L`
    };
  },

  /**
   * Detailed Attendance Report
   */
  async getAttendanceReport(startDate: string, endDate: string, departmentId?: string) {
    let query = supabase.from('attendance')
      .select('*, employees!inner(first_name, last_name, employee_code, departments(id, name)), offices(name), shift_templates(name)')
      .gte('date', startDate)
      .lte('date', endDate)
      .order('date', { ascending: false });

    if (departmentId && departmentId !== 'All') {
      query = query.eq('employees.department_id', departmentId);
    }

    const { data, error } = await query;
    return { data, error };
  },

  /**
   * Leave Report
   */
  async getLeaveReport(startDate: string, endDate: string) {
    const { data, error } = await supabase.from('leave_requests')
      .select('*, employees!leave_requests_employee_id_fkey(first_name, last_name, employee_code, departments(name)), leave_types(name)')
      .gte('start_date', startDate)
      .lte('end_date', endDate)
      .order('start_date', { ascending: false });
    return { data, error };
  },

  /**
   * WFH Report
   */
  async getWFHReport(startDate: string, endDate: string) {
    const { data, error } = await supabase.from('wfh_requests')
      .select('*, employees!wfh_requests_employee_id_fkey(first_name, last_name, employee_code, departments(name))')
      .gte('request_date', startDate)
      .lte('request_date', endDate)
      .order('request_date', { ascending: false });
    return { data, error };
  },

  /**
   * Permission Report
   */
  async getPermissionReport(startDate: string, endDate: string) {
    const { data, error } = await supabase.from('permission_requests')
      .select('*, employees!permission_requests_employee_id_fkey(first_name, last_name, employee_code, departments(name))')
      .gte('permission_date', startDate)
      .lte('permission_date', endDate)
      .order('permission_date', { ascending: false });
    return { data, error };
  },

  /**
   * Payroll Report
   */
  async getPayrollReport(month: number, year: number) {
    const { data, error } = await supabase.from('payroll')
      .select('*, employees!payroll_employee_id_fkey(first_name, last_name, employee_code, departments(name))')
      .eq('payroll_month', month)
      .eq('payroll_year', year);
    return { data, error };
  }
};
