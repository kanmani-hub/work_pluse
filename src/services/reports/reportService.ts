import { supabase } from '../../lib/supabase';

export const reportService = {
  /**
   * KPI Dashboard Metrics
   */
  async getDashboardMetrics(startDate: string, endDate: string, departmentId?: string, officeId?: string) {
    // Basic employee count and filter IDs
    let empQuery = supabase.from('employees').select('id', { count: 'exact' }).eq('status', 'ACTIVE');
    if (departmentId && departmentId !== 'All') empQuery = empQuery.eq('department_id', departmentId);
    if (officeId && officeId !== 'All') empQuery = empQuery.eq('office_id', officeId);
    
    const { data: emps, count: totalEmployees } = await empQuery;
    const hasFilter = (departmentId && departmentId !== 'All') || (officeId && officeId !== 'All');
    const empIds = emps ? (emps as any[]).map(e => e.id) : [];

    if (hasFilter && empIds.length === 0) {
      // Return zeroed metrics if filter yields no employees
      return {
        totalEmployees: 0, attendanceRate: '0.0%', presentToday: 0, lateArrivals: 0,
        earlyLogouts: 0, wfhEmployees: 0, onLeave: 0, avgWorkingHours: '0h 0m',
        payrollProcessed: '₹0.0L', departmentAttendance: [], attendanceTrend: [],
        workforceDistribution: { present: 0, wfh: 0, leave: 0, absent: 0 },
        securityAnalytics: { verifiedInside: '0%', outsideAttempts: '0%', wfhBypass: '0%', locationUnavailable: '0%', faceVerified: '0%', faceFailed: '0%', faceNotRegistered: '0 emp', faceNotRequired: '0%' }
      };
    }

    // Fetch attendance for the range
    let attQuery = supabase.from('attendance')
      .select('id, employee_id, status, clock_in_at, late_minutes, early_logout_minutes, worked_hours, attendance_date, employees!inner(departments(name))')
      .gte('attendance_date', startDate)
      .lte('attendance_date', endDate);
    if (hasFilter) attQuery = attQuery.in('employee_id', empIds);
    const { data: attendanceLogs } = await attQuery;

    // Fetch WFH for the range
    let wfhQuery = supabase.from('wfh_requests')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'APPROVED')
      .gte('request_date', startDate)
      .lte('request_date', endDate);
    if (hasFilter) wfhQuery = wfhQuery.in('employee_id', empIds);
    const { count: wfhCount } = await wfhQuery;

    // Fetch Leave for the range
    let leaveQuery = supabase.from('leave_requests')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'APPROVED')
      .gte('start_date', startDate)
      .lte('end_date', endDate);
    if (hasFilter) leaveQuery = leaveQuery.in('employee_id', empIds);
    const { count: leaveCount } = await leaveQuery;

    // Fetch Payroll for the range
    const startMonth = new Date(startDate).getMonth() + 1;
    const startYear = new Date(startDate).getFullYear();
    let payrollQuery = supabase.from('payroll')
      .select('net_salary')
      .in('status', ['APPROVED', 'PAYMENT_PENDING', 'PAID'])
      .eq('payroll_month', startMonth)
      .eq('payroll_year', startYear);
    if (hasFilter) payrollQuery = payrollQuery.in('employee_id', empIds);
    const { data: payrollData } = await payrollQuery;

    // Fetch Security Analytics Data
    let locQuery = supabase.from('location_verification_events')
      .select('result')
      .gte('verified_at', startDate + 'T00:00:00Z')
      .lte('verified_at', endDate + 'T23:59:59Z');
    if (hasFilter) locQuery = locQuery.in('employee_id', empIds);
    const { data: locVerifications } = await locQuery;

    let faceQuery = supabase.from('face_verification_events')
      .select('result')
      .gte('verified_at', startDate + 'T00:00:00Z')
      .lte('verified_at', endDate + 'T23:59:59Z');
    if (hasFilter) faceQuery = faceQuery.in('employee_id', empIds);
    const { data: faceVerifications } = await faceQuery;

    let faceRegQuery = supabase.from('face_registrations').select('registration_status');
    if (hasFilter) faceRegQuery = faceRegQuery.in('employee_id', empIds);
    const { data: faceRegs } = await faceRegQuery;

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

    let deptStats: any = {};
    let dailyStats: Record<string, { total: number; present: number }> = {};
    if (attendanceLogs) {
      for (const log of (attendanceLogs as any[])) {
        if (log.status === 'PRESENT' || log.status === 'HALF_DAY') present++;
        if (log.late_minutes && log.late_minutes > 0) late++;
        if (log.early_logout_minutes && log.early_logout_minutes > 0) earlyLogout++;
        if (log.worked_hours) {
          totalWorkMinutes += (log.worked_hours * 60);
          presentDays++;
        }
        
        const deptName = log.employees?.departments?.name || 'Unassigned';
        if (!deptStats[deptName]) deptStats[deptName] = { total: 0, present: 0 };
        deptStats[deptName].total++;
        if (log.status === 'PRESENT' || log.status === 'HALF_DAY') deptStats[deptName].present++;
        
        const dStr = log.attendance_date.split('T')[0];
        if (!dailyStats[dStr]) dailyStats[dStr] = { total: 0, present: 0 };
        dailyStats[dStr].total++;
        if (log.status === 'PRESENT' || log.status === 'HALF_DAY') dailyStats[dStr].present++;
      }
    }

    const attendanceTrend = Object.keys(dailyStats)
      .sort()
      .slice(-5)
      .map(dateStr => {
        const d = new Date(dateStr);
        const label = d.toLocaleDateString('en-US', { weekday: 'short' });
        const val = dailyStats[dateStr].total > 0 ? Math.round((dailyStats[dateStr].present / dailyStats[dateStr].total) * 100) : 0;
        return { label, val };
      });

    const attendanceRate = totalEmployees && totalEmployees > 0 && attendanceLogs ? (present / (totalEmployees * (attendanceLogs.length ? (attendanceLogs.length/totalEmployees) : 1))) * 100 : 0;
    const avgWorkMin = presentDays > 0 ? totalWorkMinutes / presentDays : 0;
    const avgHours = Math.floor(avgWorkMin / 60);
    const avgMins = Math.floor(avgWorkMin % 60);

    const departmentAttendance = Object.keys(deptStats).map(dept => {
      const rate = deptStats[dept].total > 0 ? Math.round((deptStats[dept].present / deptStats[dept].total) * 100) : 0;
      return { dept, val: rate };
    });

    const locTotal = locVerifications?.length || 1;
    const locVerified = (locVerifications as any[])?.filter(v => v.result === 'SUCCESS').length || 0;
    const locFailed = (locVerifications as any[])?.filter(v => v.result === 'FAILED' || v.result === 'OUTSIDE_GEOFENCE').length || 0;
    const locWfh = (locVerifications as any[])?.filter(v => v.result === 'WFH').length || 0;
    const locUnavailable = (locVerifications as any[])?.filter(v => v.result === 'ERROR').length || 0;

    const faceTotal = faceVerifications?.length || 1;
    const faceVerified = (faceVerifications as any[])?.filter(v => v.result === 'SUCCESS').length || 0;
    const faceFailed = (faceVerifications as any[])?.filter(v => v.result === 'FAILED').length || 0;
    const faceNotRegistered = (faceRegs as any[])?.filter(r => r.registration_status !== 'COMPLETED').length || 0;

    return {
      totalEmployees: totalEmployees || 0,
      attendanceRate: attendanceRate.toFixed(1) + '%',
      presentToday: present, // Not strictly today, based on range
      lateArrivals: late,
      earlyLogouts: earlyLogout,
      wfhEmployees: wfhCount || 0,
      onLeave: leaveCount || 0,
      avgWorkingHours: `${avgHours}h ${avgMins}m`,
      payrollProcessed: `₹${(totalPayroll / 100000).toFixed(1)}L`,
      departmentAttendance,
      attendanceTrend,
      // For actual reporting we can use the exact queries, but these variables give us a good base
      workforceDistribution: {
        present: present,
        wfh: wfhCount || 0,
        leave: leaveCount || 0,
        absent: (totalEmployees || 0) - present - (wfhCount || 0) - (leaveCount || 0)
      },
      securityAnalytics: {
        verifiedInside: Math.round((locVerified / locTotal) * 100) + '%',
        outsideAttempts: Math.round((locFailed / locTotal) * 100) + '%',
        wfhBypass: Math.round((locWfh / locTotal) * 100) + '%',
        locationUnavailable: Math.round((locUnavailable / locTotal) * 100) + '%',
        faceVerified: Math.round((faceVerified / faceTotal) * 100) + '%',
        faceFailed: Math.round((faceFailed / faceTotal) * 100) + '%',
        faceNotRegistered: faceNotRegistered + ' emp',
        faceNotRequired: '0%' // Handled by policy, placeholder for now
      }
    };
  },

  /**
   * Detailed Attendance Report
   */
  async getAttendanceReport(startDate: string, endDate: string, departmentId?: string) {
    let query = supabase.from('attendance')
      .select('*, employees!inner(first_name, last_name, employee_code, department_id, departments(id, name)), shift_templates(name)')
      .gte('attendance_date', startDate)
      .lte('attendance_date', endDate)
      .order('attendance_date', { ascending: false });

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
