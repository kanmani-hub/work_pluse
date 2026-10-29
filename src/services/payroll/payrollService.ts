import { supabase } from '../../lib/supabase';
import { buildPayrollWrite, payrollWriteError, isMissingReplaceFunction, stalePayrollReason, type PayrollWrite } from './payrollWriteRules';
import { canManagePayroll } from '../../lib/roles';
import { salaryService } from './salaryService';
import { auditService } from '../audit/auditService';
import { notificationService } from '../notifications/notificationService';
import { payrollStatusChanged, salaryPaid, payslipAvailable } from '../notifications/notificationRules';
import { payrollSettingsService, type PayrollSettings } from './payrollSettingsService';
import { globalSettingsService } from '../settings/globalSettingsService';
import { payrollAuditService } from './payrollAuditService';
import { payrollDataService } from './payrollDataService';
import type { PayrollEmployeeData } from './payrollDataService';
import { overtimePayAmount, statusChangeError, paymentBlockReason, canRecordPayment, validatePaymentAmount, validatePaymentDate, paymentDateToTimestamp, paymentRpcErrorMessage, WFH_DEDUCTION_POLICY_APPROVED, approvalBlockReason, resolutionMap, resolutionError, parsePayrollSnapshot } from './payrollRules';
import type { ReviewResolution, ReviewDecisionValue } from './payrollRules';
import { companyDateStr } from '../../utils/companyDate';
import { missingClockOutPayrollLines, isMissingClockOutSchemaError, staleMissingClockOutReason } from '../attendance/missingClockOutRules';
import { calculateLateDeduction } from './payrollLateDeductionRules';
import { evaluateDailyImpact } from './payrollImpactRules';
import { marginalDailyCalculation, NO_ATTENDANCE_LISTED_KINDS, isoDayBefore, mapLimited } from './dailyImpactRules';

/** Missing clock-out adjustment ids a calculated payroll included (stored with the calculation). */
export function settledAdjustmentIds(remarks: unknown): string[] {
  const ids = parsePayrollSnapshot(remarks)?.missingClockOutAdjustments?.ids;
  return Array.isArray(ids) ? ids.filter((x: unknown) => typeof x === 'string' && x.length > 0) : [];
}

export interface DailyReportFailure {
  employeeId: string;
  employeeCode: string;
  name: string;
  error: string;
}

export const payrollService = {
  /**
   * Employee: Get their own payroll records
   */
  async getMyPayrolls() {
    const empId = await salaryService.getCurrentEmployeeId();
    if (!empId) return { data: null, error: new Error('Unauthorized') };

    const { data, error } = await supabase
      .from('payroll')
      .select('*, payroll_payments(paid_at, payment_method, transaction_reference, amount)')
      .eq('employee_id', empId)
      .order('payroll_year', { ascending: false })
      .order('payroll_month', { ascending: false });

    return { data, error };
  },

  /**
   * Employee: Get specific payroll detail with items
   */
  async getMyPayrollById(id: string) {
    const empId = await salaryService.getCurrentEmployeeId();
    if (!empId) return { data: null, error: new Error('Unauthorized') };

    const { data, error } = await supabase
      .from('payroll')
      .select('*, payroll_items(*), payroll_payments(*), employees!payroll_employee_id_fkey(first_name, last_name, employee_code, departments(name))')
      .eq('id', id)
      .eq('employee_id', empId)
      .single();

    return { data, error };
  },

  /**
   * Admin: Get all payroll records
   */
  async getPayrolls() {
    const { data, error } = await supabase
      .from('payroll')
      .select('*, employees!payroll_employee_id_fkey(first_name, last_name, employee_code, departments(name)), payroll_payments(paid_at, payment_method, transaction_reference, amount)')
      .order('created_at', { ascending: false });

    return { data, error };
  },

  /**
   * Admin: Get Daily Deduction Report for preview (TODAY / CUSTOM DATE)
   */
  async getDailyDeductionReport(dateStr: string) {
    // 1. Get current authenticated user
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) return { data: null, error: new Error('Unauthorized') };
    
    // 2. Safely resolve role using existing RBAC structure (role_id -> roles.name)
    const { data: profile } = await supabase
      .from('profiles')
      .select('role_id')
      .eq('auth_user_id', authData.user.id)
      .single() as any;
      
    if (!profile || !profile.role_id) {
      return { data: null, error: new Error('Unable to verify your permissions.') };
    }

    const { data: roleData } = await supabase
      .from('roles')
      .select('name')
      .eq('id', profile.role_id)
      .single() as any;

    const roleName = roleData?.name || '';
    
    if (import.meta.env.DEV) {
      console.log('[Payroll Auth Debug] user_id =', authData.user.id, 'resolved_role =', roleName);
    }
    
    // Same rule as RLS on payroll tables: get_auth_role() IN ('ADMIN', 'HR')
    if (!canManagePayroll(roleName)) {
      return { data: null, error: new Error('Access Denied: Admin/HR only') };
    }

    // Attendance rows of the date (who clocked in, shift, breaks)
    const { data: attendanceRecords, error: attErr } = await supabase
      .from('attendance')
      .select('*, shift_template:shift_template_id(*)')
      .eq('attendance_date', dateStr) as any;

    if (attErr || !attendanceRecords) {
      return { data: null, error: new Error(`Attendance could not be loaded: ${attErr?.message || 'no data returned'}`) };
    }

    // Payroll population (same as Generate payroll: active salary structures), so employees who are
    // absent or on leave — and therefore have no attendance row — are part of the day too.
    const { data: structures, error: structErr } = await supabase.from('salary_structures').select('employee_id').eq('is_active', true) as any;
    if (structErr || !Array.isArray(structures)) {
      return { data: null, error: new Error(`Salary structures could not be loaded: ${structErr?.message || 'no data returned'}`) };
    }
    const employeeIds = Array.from(new Set<string>([
      ...attendanceRecords.map((a: any) => a.employee_id),
      ...structures.map((s: any) => s.employee_id),
    ].filter(Boolean)));

    const { data: employees, error: empErr } = employeeIds.length === 0 ? { data: [], error: null } : await supabase
      .from('employees')
      .select('id, first_name, last_name, employee_code, departments(name), office:office_id(name)')
      .in('id', employeeIds) as any;

    // Overtime requests for the date (display only: approval status / hours). A failed lookup is
    // reported on the rows as unavailable — never shown as "no request".
    const otRes = await (supabase.from('overtime_requests' as any) as any)
      .select('employee_id, status, eligible_overtime_hours, requested_overtime_hours, approved_overtime_hours')
      .eq('work_date', dateStr);
    const otRequestsError: string | null = otRes?.error ? otRes.error.message : null;
    const otRequests: any[] = Array.isArray(otRes?.data) ? otRes.data : [];

    if (empErr || !employees) return { data: null, error: new Error(`Employees could not be loaded: ${empErr?.message || 'no data returned'}`) };

    // The date's share of the month: month-to-date through the date minus month-to-date through the
    // previous day, with the same calculation as the monthly payroll (see dailyImpactRules). Limits,
    // interval rounding, once-a-month charges and adjustments therefore match the monthly payroll.
    const [yStr, mStr] = dateStr.split('-');
    const year = Number(yStr);
    const month = Number(mStr);
    const monthStart = `${yStr}-${mStr}-01`;
    const previousDay = dateStr > monthStart ? isoDayBefore(dateStr) : null;

    const failures: DailyReportFailure[] = [];
    const results = await mapLimited(employees as any[], 4, async (emp: any) => {
      const att = attendanceRecords.find((a: any) => a.employee_id === emp.id) || null;
      const empOtRequests = otRequests.filter((o: any) => o.employee_id === emp.id);
      const [through, before] = await Promise.all([
        this.calculatePayrollDetails(emp.id, year, month, monthStart, dateStr),
        previousDay ? this.calculatePayrollDetails(emp.id, year, month, monthStart, previousDay) : Promise.resolve({ data: null, error: null }),
      ]);
      if (through.error || !through.data || (previousDay && (before.error || !before.data))) {
        const err = through.error || before.error;
        // an employee whose salary structure starts later, without attendance, is simply not on payroll yet
        if (!att && /No active salary structure/.test(err?.message || '')) return null;

        const failureObj: DailyReportFailure = {
          employeeId: emp.id,
          employeeCode: emp.employee_code || emp.id,
          name: `${emp.first_name || ''} ${emp.last_name || ''}`.trim() || emp.employee_code || emp.id,
          error: err?.message || 'not calculated',
        };
        failures.push(failureObj);

        // If the employee has attendance for the day, preserve their attendance row with CONFIGURATION_ERROR
        // so clocked-in count remains truthful and the admin can click to configure their salary directly.
        if (att) {
          return {
            employee: emp,
            shift: att?.shift_template?.name || (att ? 'Standard' : '—'),
            status: att?.status || '—',
            dayKind: 'WORK',
            hasAttendance: true,
            clockIn: att?.clock_in_at ?? null,
            clockOut: att?.clock_out_at ?? null,
            lateMinutes: 0,
            lateDeduction: 0,
            breakOverrunMinutes: 0,
            breakDeduction: 0,
            overtimeMinutes: 0,
            overtimePay: 0,
            lopImpact: 0,
            otherDeductions: 0,
            totalDailyImpact: 0,
            totalDeductions: 0,
            totalAdditions: 0,
            netDailyImpact: 0,
            impactStatus: 'CONFIGURATION_ERROR',
            configurationError: err?.message || 'Salary configuration is invalid',
            clockOutStatus: att?.clock_in_at && !att?.clock_out_at ? 'IN_PROGRESS' : 'COMPLETED',
            lateStatus: 'DISABLED',
            breakStatus: 'DISABLED',
            overtimeStatus: 'DISABLED',
            lopStatus: 'DISABLED',
            pendingOvertimeHours: 0,
            isShiftInProgress: false,
            lateMonthToDate: { through: 0, before: 0 },
            rawCalc: null,
            attendance: att,
            overtimeRequests: empOtRequests,
            overtimeRequestsError: otRequestsError,
          };
        }
        return null;
      }
      const c = marginalDailyCalculation(through.data as any, before.data as any, dateStr);
      if (!att && !NO_ATTENDANCE_LISTED_KINDS.includes(String(c.dayKind)) && !(Number(c.totalDeductions) > 0)) return null; // week off, holiday, not employed

      const attendanceForDay = att || { attendance_date: dateStr, clock_in_at: null, clock_out_at: null, status: c.dayKind, shift_template: null };
      const evaluated = evaluateDailyImpact({
        attendance: attendanceForDay,
        calculation: c,
        overtimeRequests: empOtRequests,
        overtimeRequestsError: otRequestsError,
        dayKind: c.dayKind,
      });

      return {
        employee: emp,
        shift: att?.shift_template?.name || (att ? 'Standard' : '—'),
        status: att?.status || c.dayKind || '—',
        dayKind: c.dayKind,
        hasAttendance: !!att,
        clockIn: att?.clock_in_at ?? null,
        clockOut: att?.clock_out_at ?? null,
        lateMinutes: evaluated.lateMinutes,
        lateDeduction: evaluated.lateDeduction,
        breakOverrunMinutes: evaluated.breakOverrunMinutes,
        breakDeduction: evaluated.breakDeduction,
        overtimeMinutes: evaluated.overtimeMinutes,
        overtimePay: evaluated.overtimePay,
        lopImpact: evaluated.lopImpact,
        otherDeductions: evaluated.otherDeductions,
        totalDailyImpact: evaluated.totalDailyImpact,
        totalDeductions: evaluated.totalDeductions,
        totalAdditions: evaluated.totalAdditions,
        netDailyImpact: evaluated.netDailyImpact,
        impactStatus: evaluated.impactStatus,
        clockOutStatus: evaluated.clockOutStatus,
        lateStatus: evaluated.lateStatus,
        breakStatus: evaluated.breakStatus,
        overtimeStatus: evaluated.overtimeStatus,
        lopStatus: evaluated.lopStatus,
        pendingOvertimeHours: evaluated.pendingOvertimeHours,
        isShiftInProgress: evaluated.isShiftInProgress,
        lateMonthToDate: c.monthToDate.late,
        rawCalc: c,
        // Display details for the summary-card breakdowns (no effect on any amount)
        attendance: att,
        overtimeRequests: empOtRequests,
        overtimeRequestsError: otRequestsError,
      };
    });

    // Valid employee records are returned and can be viewed normally.
    // Invalid/missing salary structure failures are returned in failures for actionable warning presentation.
    return { data: results.filter(Boolean) as any[], error: null, failures };
  },

  /**
   * Admin: Generate Payroll for all active employees
   */
  async generatePayroll(year: number, month: number) {
    const adminId = await salaryService.getCurrentEmployeeId();
    if (!adminId) return { success: false, error: 'Unauthorized' };

    // Get all active structures
    const { data: structures } = await supabase.from('salary_structures').select('employee_id').eq('is_active', true) as any;
    if (!structures || structures.length === 0) return { success: false, error: 'No active employees with salary structures found' };

    // Set dates for the month (UTC to avoid local timezone offset shifting the day back)
    const startDate = new Date(Date.UTC(year, month - 1, 1)).toISOString();
    const endDate = new Date(Date.UTC(year, month, 0, 23, 59, 59)).toISOString();

    let successCount = 0;
    // Every employee that could not be calculated is reported (never silently skipped)
    const failures: { employee_id: string; error: string }[] = [];
    // Days flagged for Admin review (e.g. half-day leave with the other half unaccounted for)
    const reviews: { employee_id: string; items: { date: string; reason: string }[] }[] = [];
    let skippedLocked = 0;
    for (const s of structures) {
      if (s.employee_id) {
        const { data: existing } = await supabase
          .from('payroll')
          .select('id, status')
          .eq('employee_id', s.employee_id)
          .eq('payroll_year', year)
          .eq('payroll_month', month)
          .single<any>();

        let res;
        if (existing) {
          if (['APPROVED', 'PAYMENT_PENDING', 'PAID', 'CLOSED'].includes(existing.status)) {
            skippedLocked++;
            continue; // Locked payrolls are intentionally left unchanged (reported as skippedLocked)
          }
          res = await this.recalculatePayroll(s.employee_id, year, month, startDate, endDate);
        } else {
          res = await this.calculatePayroll(s.employee_id, year, month, startDate, endDate);
        }

        if (res && !res.error) {
          successCount++;
          const items = (res as any).reviewItems || [];
          if (items.length > 0) reviews.push({ employee_id: s.employee_id, items });
          // Auto submit to UNDER_REVIEW if newly created or still in DRAFT/CALCULATED
          if (res.data?.id && (!existing || ['DRAFT', 'CALCULATED'].includes(existing.status))) {
            const sub = await this.submitPayrollForReview(res.data.id);
            if (sub?.error) failures.push({ employee_id: s.employee_id, error: `Calculated, but not submitted for review: ${sub.error.message}` });
          }
        } else {
          failures.push({ employee_id: s.employee_id, error: res?.error?.message || 'Payroll could not be calculated.' });
        }
      }
    }

    return { success: failures.length === 0, count: successCount, failures, skippedLocked, reviews };
  },

  /**
   * Admin: Calculate Payroll atomically
   */
  async calculatePayroll(employeeId: string, year: number, month: number, periodStart: string, periodEnd: string) {
    const adminId = await salaryService.getCurrentEmployeeId();
    if (!adminId) return { error: new Error('Unauthorized') };

    // 1. Check if payroll already exists
    const { data: existing } = await supabase
      .from('payroll')
      .select('id')
      .eq('employee_id', employeeId)
      .eq('payroll_year', year)
      .eq('payroll_month', month)
      .single<any>();

    if (existing) {
      return { error: new Error('Payroll for this month already exists.') };
    }

    return this._doCalculate(employeeId, year, month, periodStart, periodEnd);
  },

  async recalculatePayroll(employeeId: string, year: number, month: number, periodStart: string, periodEnd: string, opts?: { resolutions?: ReviewResolution[] }) {
    const adminId = await salaryService.getCurrentEmployeeId();
    if (!adminId) return { error: new Error('Unauthorized') };

    const { data: existing } = await supabase
      .from('payroll')
      .select('id, status, remarks')
      .eq('employee_id', employeeId)
      .eq('payroll_year', year)
      .eq('payroll_month', month)
      .single<any>();

    if (existing) {
      if (['APPROVED', 'PAYMENT_PENDING', 'PAID', 'CLOSED'].includes(existing.status)) {
        return { error: new Error(`Cannot recalculate payroll in ${existing.status} status.`) };
      }
      // Nothing is deleted here: the new figures are calculated first and then replace the stored
      // payroll in one database transaction (replace_payroll_calculation). A failed calculation or
      // save leaves the previous payroll and its items as they were.
    }

    // Admin decisions on review flags survive recalculation
    const resolutions: ReviewResolution[] = opts?.resolutions ?? (parsePayrollSnapshot(existing?.remarks)?.reviewResolutions || []);
    const res: any = await this._doCalculate(employeeId, year, month, periodStart, periodEnd, { resolutions, existingId: existing?.id ?? null });
    
    // The database function keeps UNDER_REVIEW itself; only the fallback path (migration not applied)
    // re-created the row as CALCULATED and has to submit it again.
    if (res.data?.id && existing?.status === 'UNDER_REVIEW' && res.atomic === false) {
      await this.submitPayrollForReview(res.data.id);
      res.data.status = 'UNDER_REVIEW';
    }
    
    return res;
  },

  async calculatePayrollDetails(employeeId: string, year: number, month: number, periodStart: string, periodEnd: string, opts?: { resolutions?: ReviewResolution[] }) {
    // 1. Get salary structure
    const { data: salary, error: salErr } = (await salaryService.getSalaryStructureForPeriod(employeeId, periodStart, periodEnd)) as any;
    if (salErr || !salary) {
      return { data: null, error: new Error('No active salary structure found for this payroll period.') };
    }
    const basic = Number(salary.basic_salary || 0);
    const totalAllowances = Number(salary.hra || 0) + Number(salary.transport_allowance || 0) +
                            Number(salary.medical_allowance || 0) + Number(salary.special_allowance || 0) +
                            Number(salary.other_allowances || 0);
    const grossSalary = basic + totalAllowances;
    if (!(grossSalary > 0)) {
      return { data: null, error: new Error('Salary configuration is invalid: gross salary must be greater than zero.') };
    }

    // 2. Get payroll settings from configuration (not hardcoded). If the settings row could not be
    //    read, the defaults (e.g. Mon–Fri working days) would silently change who gets LOP: refuse.
    const globalSettings = await globalSettingsService.loadSettings();
    if (!globalSettings?.updated_at || !globalSettings.payroll || !globalSettings.app) {
      return { data: null, error: new Error('Company settings could not be loaded. Payroll was not calculated.') };
    }
    const settings = globalSettings.payroll;

    // 3. Get actual employee data from attendance/leave/permission/wfh modules
    const appSettings = globalSettings.app;
    // Note: We use periodStart and periodEnd to fetch exactly the requested window
    const startDate = periodStart;
    const endDate = periodEnd;

    const [daysResult, wfhResult, permissionResult, approvedOt, adjustmentsResult] = await Promise.all([
      payrollDataService._fetchPayrollDays(employeeId, startDate, endDate, appSettings, companyDateStr(), resolutionMap(opts?.resolutions)),
      payrollDataService._fetchWfh(employeeId, startDate, endDate),
      payrollDataService._fetchPermissions(employeeId, startDate, endDate),
      payrollDataService._fetchApprovedOvertime(employeeId, startDate, endDate),
      payrollDataService._fetchPayrollAdjustments(employeeId, endDate),
    ]);

    // A failed lookup is never treated as "no absences / no leave / no permissions / no adjustments": stop instead.
    const lookups: [string, any][] = [['Attendance', daysResult], ['Approved WFH', wfhResult], ['Approved permissions', permissionResult], ['Payroll adjustments', adjustmentsResult]];
    for (const [what, res] of lookups) {
      if (!res) return { data: null, error: new Error(`${what} could not be loaded. Payroll was not calculated.`) };
      if (res.error) return { data: null, error: res.error instanceof Error ? res.error : new Error(String(res.error)) };
    }

    // Overtime = APPROVED overtime requests only. attendance.overtime_minutes (e.g. written by the
    // server auto clock-out as worked minus required) is kept for information but never paid.
    if (settings.enableOvertimePay && (!approvedOt || approvedOt.error)) {
      return { data: null, error: approvedOt?.error || new Error('Approved overtime could not be loaded.') };
    }
    const attendanceResult = { ...daysResult.attendance };
    attendanceResult.recordedOvertimeMinutes = attendanceResult.totalOvertimeMinutes;
    attendanceResult.totalOvertimeMinutes = approvedOt && !approvedOt.error ? approvedOt.minutes : 0;

    // LOP days come from the day classification: unexcused absences (working day, no clock-in, no
    // approved paid leave) + approved Loss-of-Pay leave + sandwich LOP. Every date is counted once.
    // LATE / ON_BREAK / EARLY / AUTO-LOGOUT days have a clock-in and are worked days (their lateness
    // and break penalties are the separate minute-based deductions below).

    const empData: PayrollEmployeeData = {
      attendance: attendanceResult,
      leave: daysResult.leave,
      wfh: { wfhDays: wfhResult.wfhDays },
      permission: { permissionCount: permissionResult.permissionCount, totalMinutes: permissionResult.totalMinutes },
    };

    // 4. Gross salary already validated in step 1

    // 5. Daily rate (owner rule, 2026-10-09: keep until the company confirms another policy):
    //    dailyRate = monthly gross ÷ getWorkingDaysForMonth(), configured in Admin → Settings → Payroll
    //    (workingDaysBasis 'configured', configuredWorkingDays 26 → gross ÷ 26). It is NOT the employee's
    //    scheduled working days or calendar days. Full-day LOP = lopDays × dailyRate; half-day LOP = 0.5 ×
    //    dailyRate; half-day attendance deduction = halfDays × dailyRate × 0.5; each amount is then rounded
    //    by salaryRounding ('round' = nearest rupee, 'exact' = 2 decimals).
    const workingDays = payrollSettingsService.getWorkingDaysForMonth(year, month, settings, appSettings?.workingDays);
    if (!(workingDays > 0)) {
      return { data: null, error: new Error('The daily-rate divisor is not configured correctly (Settings → Payroll → Working Days Basis / Configured Working Days, and Settings → Working Days). Payroll was not calculated.') };
    }
    const dailyRate = grossSalary / workingDays;

    // 6. Calculate deductions based on ENABLED rules only
    let totalDeductions = Number(salary.standard_deduction || 0);
    let lopDeduction = 0;
    const deductionItems: { name: string; amount: number }[] = [];

    // LOP Deduction
    if (settings.enableLopDeductions && empData.attendance.lopDays > 0) {
      if (settings.lopMethod === 'fixed') {
        lopDeduction = payrollSettingsService.applyRounding(empData.attendance.lopDays * (settings.lopAmount || 0), settings);
      } else {
        lopDeduction = payrollSettingsService.applyRounding(empData.attendance.lopDays * dailyRate, settings);
      }
      totalDeductions += lopDeduction;
      
      const unauthAbs = empData.attendance.absentDays || 0;
      const sandwich = empData.attendance.sandwichLopDays || 0;
      const leaveLop = empData.leave.lopLeave;
      
      const parts = [];
      if (unauthAbs > 0) parts.push(`${unauthAbs}d unauthorized absence`);
      if (sandwich > 0) parts.push(`${sandwich}d sandwich LOP`);
      if (leaveLop > 0) parts.push(`${leaveLop}d unpaid leave`);
      
      deductionItems.push({ 
        name: `LOP Deduction (${parts.join(', ')})`, 
        amount: lopDeduction 
      });
    }

    // Permission Excess Deduction
    if (settings.enablePermissionDeduction) {
      const limitHours = appSettings?.permissionMaxHoursPerMonth || 3;
      const limitMins = limitHours * 60;
      const totalPermMins = empData.permission.totalMinutes || 0;
      
      if (totalPermMins > limitMins) {
        const excessMins = totalPermMins - limitMins;
        
        let permDeduction = 0;
        let suffix = '';
        
        if (settings.permissionDeductionMethod === 'salary_based') {
          const excessHours = excessMins / 60;
          const hourlyRate = dailyRate / 8; // Assumes 8 working hours per day
          const rate = settings.permissionPerMinuteRate || 1; 
          permDeduction = payrollSettingsService.applyRounding(excessHours * hourlyRate * rate, settings);
          suffix = `(${excessHours.toFixed(1)}h over limit)`;
        } else if (settings.permissionDeductionMethod === 'per_minute') {
          permDeduction = payrollSettingsService.applyRounding(excessMins * (settings.permissionPerMinuteRate || 0), settings);
          suffix = `(${excessMins}m excess)`;
        } else if (settings.permissionDeductionMethod === 'fixed') {
          permDeduction = payrollSettingsService.applyRounding(settings.permissionFixedAmount || 0, settings);
        } else if (settings.permissionDeductionMethod === 'half_day') {
          if (settings.halfDayMethod === 'fixed') {
            permDeduction = payrollSettingsService.applyRounding(settings.permissionHalfDayAmount || settings.halfDayAmount || 0, settings);
          } else {
            permDeduction = payrollSettingsService.applyRounding(dailyRate * 0.5, settings);
          }
        }
        
        if (permDeduction > 0) {
          totalDeductions += permDeduction;
          deductionItems.push({
            name: `Excess Permission LOP ${suffix}`.trim(),
            amount: permDeduction
          });
        }
      }
    }

    // Half-Day Deduction
    if (settings.enableHalfDayDeductions && empData.attendance.halfDays > 0) {
      let halfDayDeduction = 0;
      if (settings.halfDayMethod === 'fixed') {
        halfDayDeduction = payrollSettingsService.applyRounding(empData.attendance.halfDays * (settings.halfDayAmount || 0), settings);
      } else {
        halfDayDeduction = payrollSettingsService.applyRounding(empData.attendance.halfDays * dailyRate * 0.5, settings);
      }
      totalDeductions += halfDayDeduction;
      deductionItems.push({ name: 'Half-Day Deduction', amount: halfDayDeduction });
    }

    // Late Login Deduction
    let lateCalculation: any = null;
    if (settings.enableLateLoginDeduction) {
      const totalLateMins = empData.attendance.totalLateMinutes || 0;
      if (totalLateMins > 0) {
        const lateRes = calculateLateDeduction({
          enableLateLoginDeduction: true,
          lateDeductionMethod: settings.lateDeductionMethod,
          monthlySalary: grossSalary,
          workingDays,
          totalLateMinutes: totalLateMins,
          lateLogins: empData.attendance.lateLogins,
          lateRecords: empData.attendance.lateRecords,
          monthlyLateLoginLimit: settings.monthlyLateLoginLimit,
          salaryRounding: settings.salaryRounding,
          lateFixedAmount: settings.lateFixedAmount,
          latePerMinuteRate: settings.latePerMinuteRate,
          lateIntervalMinutes: settings.lateIntervalMinutes,
          lateIntervalAmount: settings.lateIntervalAmount,
          lateHalfDayAmount: settings.lateHalfDayAmount,
          halfDayMethod: settings.halfDayMethod,
          halfDayAmount: settings.halfDayAmount,
        });

        lateCalculation = {
          method: settings.lateDeductionMethod,
          totalLateMinutes: lateRes.totalLateMinutes,
          chargeableMinutes: lateRes.chargeableMinutes,
          exemptMinutes: lateRes.exemptMinutes,
          totalOccurrences: lateRes.totalLateOccurrences,
          chargeableOccurrences: lateRes.chargeableOccurrences,
          exemptOccurrences: lateRes.exemptOccurrences,
          monthlySalary: grossSalary,
          workingDays,
          dailyRate: payrollSettingsService.applyRounding(dailyRate, settings),
          salaryPerMinute: Number(lateRes.salaryPerMinute.toFixed(4)),
          unroundedAmount: lateRes.unroundedAmount,
          deductionAmount: lateRes.deductionAmount,
          formula: lateRes.formulaDescription,
        };

        if (lateRes.deductionAmount > 0) {
          totalDeductions += lateRes.deductionAmount;
          let label = `Late Deduction (${totalLateMins}m)`;
          if (settings.lateDeductionMethod === 'salary_based') {
            label = lateRes.chargeableMinutes === totalLateMins
              ? `Late Deduction (${lateRes.chargeableMinutes}m @ ₹${lateRes.salaryPerMinute.toFixed(2)}/m)`
              : `Late Deduction (${lateRes.chargeableMinutes}m of ${totalLateMins}m)`;
          }
          deductionItems.push({
            name: label,
            amount: lateRes.deductionAmount,
          });
        }
      }
    }

    // WFH Deduction — disabled until a WFH deduction policy is explicitly approved (payrollRules.WFH_DEDUCTION_POLICY_APPROVED);
    // the Settings toggle alone never charges for WFH days.
    if (WFH_DEDUCTION_POLICY_APPROVED && settings.enableWfhDeduction && empData.wfh.wfhDays > 0) {
      let wfhDeduction = 0;
      
      if (settings.wfhDeductionMethod === 'per_day') {
        wfhDeduction = payrollSettingsService.applyRounding(empData.wfh.wfhDays * (settings.wfhPerDayAmount || 0), settings);
      } else if (settings.wfhDeductionMethod === 'fixed') {
        wfhDeduction = payrollSettingsService.applyRounding(empData.wfh.wfhDays * (settings.wfhFixedAmount || 0), settings);
      } else if (settings.wfhDeductionMethod === 'half_day') {
        if (settings.halfDayMethod === 'fixed') {
          wfhDeduction = payrollSettingsService.applyRounding(empData.wfh.wfhDays * (settings.wfhHalfDayAmount || settings.halfDayAmount || 0), settings);
        } else {
          wfhDeduction = payrollSettingsService.applyRounding(empData.wfh.wfhDays * dailyRate * 0.5, settings);
        }
      }

      if (wfhDeduction > 0) {
        totalDeductions += wfhDeduction;
        deductionItems.push({ name: 'WFH Deduction', amount: wfhDeduction });
      }
    }

    // Break Excess Deduction
    if (settings.enableBreakOverrunDetection && settings.enableBreakOverrunDeduction) {
      const breakExcessMins = empData.attendance.totalBreakExcessMinutes || 0;
      if (breakExcessMins > 0) {
        let breakDeduction = 0;
        let suffix = '';

        if (settings.breakOverrunDeductionMethod === 'salary_based') {
          const excessHours = breakExcessMins / 60;
          const hourlyRate = dailyRate / 8; // Assumes 8 working hours per day
          breakDeduction = excessHours * hourlyRate;
          suffix = `(${excessHours.toFixed(1)}h)`;
        } else if (settings.breakOverrunDeductionMethod === 'per_minute') {
          breakDeduction = breakExcessMins * (settings.breakOverrunPerMinuteRate || 0);
          suffix = `(${breakExcessMins}m)`;
        } else if (settings.breakOverrunDeductionMethod === 'fixed') {
          breakDeduction = settings.breakOverrunFixedAmount || 0;
        } else if (settings.breakOverrunDeductionMethod === 'half_day') {
          if (settings.halfDayMethod === 'fixed') {
            breakDeduction = settings.breakOverrunHalfDayAmount || settings.halfDayAmount || 0;
          } else {
            breakDeduction = dailyRate * 0.5;
          }
        }
        
        breakDeduction = payrollSettingsService.applyRounding(breakDeduction, settings);
        
        if (breakDeduction > 0) {
          totalDeductions += breakDeduction;
          deductionItems.push({ name: `Break Excess Deduction ${suffix}`.trim(), amount: breakDeduction });
        }
      }
    }

    // 6b. Missing clock-out adjustments (unique reference per case; settled atomically on approval, so a
    //     recalculation reads the same PENDING rows again and never adds anything twice)
    const mco = missingClockOutPayrollLines(adjustmentsResult.data, periodEnd, { overtimePayEnabled: !!settings.enableOvertimePay });
    let adjustmentEarnings = 0;
    const earningAdjustmentItems: { name: string; amount: number }[] = [];
    if (mco.deduction) {
      const amount = payrollSettingsService.applyRounding(mco.deduction.amount, settings);
      totalDeductions += amount;
      deductionItems.push({ name: mco.deduction.name, amount });
    }
    if (mco.reversal) {
      adjustmentEarnings = payrollSettingsService.applyRounding(mco.reversal.amount, settings);
      earningAdjustmentItems.push({ name: mco.reversal.name, amount: adjustmentEarnings });
    }

    // 7. Overtime (approved requests of this period + overtime approved after an earlier month was locked)
    let overtime = 0;
    const otRaw = overtimePayAmount({
      enableOvertimePay: settings.enableOvertimePay,
      approvedOvertimeMinutes: empData.attendance.totalOvertimeMinutes + mco.deferredOvertimeMinutes,
      dailyRate,
      overtimeRateType: settings.overtimeRateType,
      overtimeMultiplier: settings.overtimeMultiplier,
      overtimeFixedRate: settings.overtimeFixedRate,
    });
    if (otRaw > 0) overtime = payrollSettingsService.applyRounding(otRaw, settings);

    totalDeductions = payrollSettingsService.applyRounding(totalDeductions, settings);
    
    const eligibleEarnings = grossSalary + overtime + adjustmentEarnings;
    if (grossSalary > 0 && totalDeductions > eligibleEarnings) {
      if (!empData.attendance.reviewItems) empData.attendance.reviewItems = [];
      const reviewType = 'DEDUCTIONS_EXCEED_EARNINGS';
      const hasResolution = (opts?.resolutions || []).some(r => r.type === reviewType);
      if (!hasResolution && !empData.attendance.reviewItems.some(i => i.type === reviewType)) {
        empData.attendance.reviewItems.push({
          date: String(endDate).slice(0, 10),
          type: reviewType as any,
          reason: `Total deductions (₹${totalDeductions.toLocaleString('en-IN')}) exceed eligible earnings (₹${eligibleEarnings.toLocaleString('en-IN')}). Admin review required.`,
        });
      }
    }

    let netSalary = payrollSettingsService.applyRounding(eligibleEarnings - totalDeductions, settings);
    if (netSalary < 0) netSalary = 0;

    return {
      data: {
        basic,
        grossSalary,
        totalAllowances,
        totalDeductions,
        lopDeduction,
        overtime,
        netSalary,
        empData,
        workingDays,
        dailyRate,
        deductionItems,
        earningAdjustmentItems,
        missingClockOutAdjustments: {
          ids: mco.ids,
          references: mco.references,
          deferredOvertimeHours: mco.deferredOvertimeHours,
          notSetUp: adjustmentsResult.notSetUp,
        },
        salary,
        settings,
        lateCalculation,
        // The app settings this calculation used (break allowance, grace period) — for display
        appSettings,
        // Day classification of the period (one entry per date) — the daily view reads the date's kind
        days: Array.isArray((daysResult as any).days) ? (daysResult as any).days.map((d: any) => ({ date: d.date, kind: d.kind })) : [],
      },
      error: null
    };
  },

  async _doCalculate(employeeId: string, year: number, month: number, periodStart: string, periodEnd: string, opts?: { resolutions?: ReviewResolution[]; existingId?: string | null }) {
    const resolutions = opts?.resolutions || [];
    const calc = await this.calculatePayrollDetails(employeeId, year, month, periodStart, periodEnd, { resolutions });
    if (calc.error) return { data: null, error: calc.error };
    
    const {
      basic, grossSalary, totalAllowances, totalDeductions, lopDeduction, overtime, netSalary,
      empData, workingDays, dailyRate, deductionItems, earningAdjustmentItems, missingClockOutAdjustments, salary, settings, lateCalculation
    } = calc.data as any;

    // 9. Build attendance/leave/permission summary JSON to store in payroll
    const dataSummary = JSON.stringify({
      attendance: empData.attendance,
      leave: empData.leave,
      wfh: empData.wfh,
      permission: empData.permission,
      lateCalculation: lateCalculation || undefined,
      settings: {
        workingDaysBasis: settings.workingDaysBasis,
        configuredWorkingDays: settings.configuredWorkingDays,
        workingDaysUsed: workingDays,
        dailyRate: payrollSettingsService.applyRounding(dailyRate, settings),
        wfhDeductionApplied: WFH_DEDUCTION_POLICY_APPROVED && !!settings.enableWfhDeduction,
      },
      deductionBreakdown: deductionItems,
      earningAdjustments: earningAdjustmentItems || [],
      // Missing clock-out adjustments this calculation included; settled when this payroll is approved
      missingClockOutAdjustments: missingClockOutAdjustments || { ids: [], references: [], deferredOvertimeHours: 0 },
      // Admin decisions on attendance review flags (who / when / why), carried across recalculation
      reviewResolutions: resolutions,
    });

    // 10. Build row + items from the finished calculation, then save them together
    const write = buildPayrollWrite({
      employeeId, year, month, periodStart, periodEnd,
      basic, grossSalary, totalAllowances, totalDeductions, lopDeduction, overtime, netSalary,
      remarks: dataSummary,
      deductionItems,
      earningAdjustmentItems: earningAdjustmentItems || [],
      standardDeduction: Number(salary?.standard_deduction || 0),
      lateFormula: lateCalculation?.formula ?? null,
    });
    const invalid = payrollWriteError(write);
    if (invalid) return { data: null, error: new Error(invalid) };

    const saved = await this._savePayrollCalculation(write, opts?.existingId ?? null);
    if (saved.error || !saved.payroll) {
      return { data: null, error: saved.error || new Error('Failed to create payroll record.') };
    }
    const payroll = saved.payroll;

    await payrollAuditService.logEvent({
      payrollId: payroll.id,
      action: 'PAYROLL_GENERATED',
      title: `System generated ${year}-${String(month).padStart(2, '0')} payroll`,
      description: `Base Salary: ₹${basic.toLocaleString('en-IN')}\nNet Salary: ₹${netSalary.toLocaleString('en-IN')}`,
      newStatus: payroll.status || 'CALCULATED'
    });

    await payrollAuditService.logEvent({
      payrollId: payroll.id,
      action: 'PAYROLL_CALCULATED',
      title: `Salary Calculation [${year}-${String(month).padStart(2, '0')}]`,
      description: `Working Days: ${workingDays}\nDaily Rate: ₹${payrollSettingsService.applyRounding(dailyRate, settings)}\nPaid Days: ${empData.attendance.presentDays}\nUnpaid Days: ${empData.attendance.lopDays}`,
    });

    // 11. Payroll items were saved with the row (see _savePayrollCalculation)

    return { data: payroll, error: null, reviewItems: empData.attendance.reviewItems || [], atomic: saved.atomic };
  },

  /**
   * Saves one calculated payroll (row + items). With migration 20261028090100 this is one database
   * transaction that also refuses a locked month. Without it (not applied yet) the previous behaviour
   * remains, but only after the new figures exist, and every step is checked.
   */
  async _savePayrollCalculation(write: PayrollWrite, existingId: string | null): Promise<{ payroll: any | null; error: Error | null; atomic: boolean }> {
    const { data: rpcRes, error: rpcErr } = await (supabase as any).rpc('replace_payroll_calculation', { p_payroll: write.row, p_items: write.items });
    if (!rpcErr) {
      const id = rpcRes?.id;
      const { data: payroll, error: readErr } = await supabase.from('payroll').select('*').eq('id', id).single<any>();
      if (readErr || !payroll) return { payroll: null, error: new Error(`Payroll was saved but could not be read back (${readErr?.message || 'no data returned'}). Please refresh.`), atomic: true };
      return { payroll, error: null, atomic: true };
    }
    if (!isMissingReplaceFunction(rpcErr)) {
      return { payroll: null, error: new Error(rpcErr.message || 'Payroll could not be saved.'), atomic: true };
    }

    // Fallback: database function not available
    if (existingId) {
      const { error: delItemsErr } = await supabase.from('payroll_items').delete().eq('payroll_id', existingId);
      if (delItemsErr) return { payroll: null, error: new Error(`The previous payroll items could not be replaced (${delItemsErr.message}). Nothing was changed.`), atomic: false };
      const { error: delErr } = await supabase.from('payroll').delete().eq('id', existingId);
      if (delErr) return { payroll: null, error: new Error(`The previous payroll could not be replaced (${delErr.message}). Please recalculate.`), atomic: false };
    }
    const { data: payroll, error: insErr } = await supabase
      .from('payroll')
      .insert({ ...write.row, status: 'CALCULATED', calculated_at: new Date().toISOString() } as any)
      .select()
      .single<any>();
    if (insErr || !payroll) return { payroll: null, error: insErr ? new Error(insErr.message) : new Error('Failed to create payroll record.'), atomic: false };
    if (write.items.length > 0) {
      const { error: itemsErr } = await supabase.from('payroll_items').insert(write.items.map(it => ({ ...it, payroll_id: payroll.id })) as any);
      if (itemsErr) {
        // never leave a payroll without its items
        await supabase.from('payroll').delete().eq('id', payroll.id);
        return { payroll: null, error: new Error(`Payroll items could not be saved (${itemsErr.message}). Please recalculate.`), atomic: false };
      }
    }
    return { payroll, error: null, atomic: false };
  },

  /**
   * Status transitions
   */
  async updateStatus(id: string, newStatus: string, expectedCurrentStatus?: string[]) {
    const adminId = await salaryService.getCurrentEmployeeId();
    if (!adminId) return { error: new Error('Unauthorized') };

    const { data: existing } = await supabase.from('payroll').select('status, remarks, employee_id, payroll_year, payroll_month, period_start, period_end, calculated_at, basic_salary, gross_salary, total_allowances, total_deductions, lop_deduction, overtime_amount, net_salary').eq('id', id).single<any>();
    if (!existing) return { error: new Error('Not found') };

    // Unresolved attendance review flags or invalid salary block approval (single and bulk approval both come here)
    if (newStatus === 'APPROVED') {
      const blocked = approvalBlockReason(existing.remarks, existing);
      if (blocked) return { error: new Error(blocked) };
    }

    if (expectedCurrentStatus && !expectedCurrentStatus.includes(existing.status)) {
      return { error: new Error(`Cannot transition from ${existing.status} to ${newStatus}`) };
    }
    // One forward path only; PAID only via markPayrollPaid (see payrollRules)
    const transitionErr = statusChangeError(existing.status, newStatus);
    if (transitionErr) return { error: new Error(transitionErr) };

    // A correction approved after this payroll was calculated changed its attendance and overtime:
    // approving the stale figures would lock the month and that overtime would never be paid.
    if (newStatus === 'APPROVED') {
      const stale = await this._staleMissingClockOutCheck(existing);
      if (stale) return { error: new Error(stale) };
      // Any other change after calculation (attendance correction, leave approved, overtime approved,
      // settings): the stored figures must still equal a fresh calculation.
      const drift = await this._staleCalculationCheck(existing);
      if (drift) return { error: new Error(drift) };
    }

    // A payroll that included missing clock-out adjustments is approved by one database function that
    // also settles exactly those adjustments (all or nothing). If any of them changed since the
    // calculation (cancelled by an approval, settled by another payroll) nothing is approved.
    const adjustmentIds = settledAdjustmentIds(existing.remarks);
    if (newStatus === 'APPROVED' && adjustmentIds.length > 0) {
      const { error: rpcErr } = await (supabase as any).rpc('approve_payroll_with_adjustments', { p_payroll_id: id, p_adjustment_ids: adjustmentIds });
      if (rpcErr) {
        if (isMissingClockOutSchemaError(rpcErr)) return { error: new Error('Payroll adjustments are not set up in the database. Recalculate this payroll before approving.') };
        return { error: new Error(rpcErr.message || 'Payroll could not be approved.') };
      }
      // the function wrote the audit log entry
      const { data: info } = await supabase.from('payroll').select('employee_id, payroll_month, payroll_year').eq('id', id).single<any>();
      if (info) {
        await notificationService.notifyEmployee(info.employee_id, payrollStatusChanged({ id, status: newStatus, month: info.payroll_month, year: info.payroll_year }));
      }
      return { error: null };
    }

    const payload: any = { status: newStatus };
    if (newStatus === 'APPROVED') {
      payload.approved_at = new Date().toISOString();
      payload.approved_by = adminId;
    } else if (newStatus === 'CLOSED') {
      payload.locked_at = new Date().toISOString();
    }

    // Conditional on the status we read: a double click / second tab cannot apply (or announce) it twice
    const { data: changedRows, error } = await (supabase.from('payroll') as any)
      .update(payload as never)
      .eq('id', id)
      .eq('status', existing.status)
      .select('id');

    if (!error && (!changedRows || changedRows.length === 0)) {
      return { error: new Error('Payroll status was already changed. Please refresh.') };
    }

    if (!error) {
      const { data: payrollInfo } = await supabase.from('payroll').select('employee_id, payroll_month, payroll_year').eq('id', id).single<any>();
      
      await auditService.recordAuditLog({
        action: `PAYROLL_${newStatus}`,
        module: 'PAYROLL',
        entity_type: 'payroll',
        entity_id: id,
        description: `Payroll status changed from ${existing.status} to ${newStatus}`,
        old_values: { status: existing.status },
        new_values: { status: newStatus }
      });

      if (payrollInfo) {
        await notificationService.notifyEmployee(payrollInfo.employee_id, payrollStatusChanged({
          id, status: newStatus, month: payrollInfo.payroll_month, year: payrollInfo.payroll_year,
        }));
      }
    }

    return { error };
  },

  /** Refusal message when the stored payroll differs from a fresh calculation of the same period; null when it matches. */
  async _staleCalculationCheck(p: any): Promise<string | null> {
    if (!p?.employee_id || !p.payroll_year || !p.payroll_month) return null;
    const resolutions: ReviewResolution[] = parsePayrollSnapshot(p.remarks)?.reviewResolutions || [];
    try {
      const fresh: any = await this.calculatePayrollDetails(p.employee_id, p.payroll_year, p.payroll_month, p.period_start, p.period_end, { resolutions });
      if (fresh?.error || !fresh?.data) return stalePayrollReason(p, null, fresh?.error?.message || null);
      return stalePayrollReason(p, fresh.data);
    } catch (e: any) {
      return stalePayrollReason(p, null, e?.message || null);
    }
  },

  /** Refusal message when a missing clock-out correction of the period was approved after calculation; null otherwise. */
  async _staleMissingClockOutCheck(p: any): Promise<string | null> {
    if (!p?.employee_id) return null;
    const { data, error } = await (supabase.from('overtime_requests' as any) as any)
      .select('work_date, reviewed_at')
      .eq('employee_id', p.employee_id)
      .eq('request_type', 'MISSING_CLOCK_OUT')
      .eq('status', 'APPROVED');
    if (error) {
      // proposal not applied: there are no corrections to check
      if (isMissingClockOutSchemaError(error) || error.code === '42P01' || error.code === 'PGRST205') return null;
      return 'Missing clock-out corrections could not be checked, so the payroll was not approved. Please try again.';
    }
    return staleMissingClockOutReason(Array.isArray(data) ? data : [], p);
  },

  /**
   * Admin resolves one attendance review flag: APPLY (the deduction applies) or WAIVE (no deduction),
   * with a required note. Only before approval (CALCULATED / UNDER_REVIEW). The payroll is then
   * recalculated through the normal calculation with the decision included — amounts are never edited
   * directly — and the decision (who / when / note) is stored with the calculation and audited.
   */
  async resolveReviewFlag(payrollId: string, date: string, type: string, decision: ReviewDecisionValue, note: string) {
    const adminId = await salaryService.getCurrentEmployeeId();
    if (!adminId) return { data: null, error: new Error('Unauthorized') };
    const role = await this._getCurrentRole();
    if (role !== 'ADMIN') return { data: null, error: new Error('Only an Admin can resolve payroll review flags.') };

    const { data: p } = await supabase.from('payroll')
      .select('id, status, remarks, employee_id, payroll_year, payroll_month, period_start, period_end')
      .eq('id', payrollId).single<any>();
    const err = resolutionError(p, date, type, decision, note);
    if (err) return { data: null, error: new Error(err) };

    const previous: ReviewResolution[] = (parsePayrollSnapshot(p.remarks)?.reviewResolutions || []).filter((r: ReviewResolution) => !(r.date === date && r.type === type));
    const resolutions: ReviewResolution[] = [...previous, { date, type, decision, note: String(note).trim(), by: adminId, at: new Date().toISOString() }];

    const res: any = await this.recalculatePayroll(p.employee_id, p.payroll_year, p.payroll_month, p.period_start, p.period_end, { resolutions });
    if (res?.error) return { data: null, error: res.error };

    await auditService.recordAuditLog({
      action: 'PAYROLL_REVIEW_RESOLVED',
      module: 'PAYROLL',
      entity_type: 'payroll',
      entity_id: res.data?.id || payrollId,
      description: `Review flag ${type} on ${date} resolved: ${decision}. Note: ${String(note).trim()}`,
      new_values: { date, type, decision },
    });
    return { data: res.data, error: null };
  },

  async submitPayrollForReview(id: string) {
    return this.updateStatus(id, 'UNDER_REVIEW', ['CALCULATED', 'DRAFT']);
  },

  async approvePayroll(id: string) {
    return this.updateStatus(id, 'APPROVED', ['UNDER_REVIEW']);
  },

  async movePayrollToPaymentPending(id: string) {
    return this.updateStatus(id, 'PAYMENT_PENDING', ['APPROVED']);
  },

  async closePayroll(id: string) {
    return this.updateStatus(id, 'CLOSED', ['PAID']);
  },

  /**
   * Admin: Record Payment
   */
  /** Normalised role of the signed-in user (profiles.role_id → roles.name), or null. */
  async _getCurrentRole(): Promise<string | null> {
    const { data: authData } = await supabase.auth.getUser();
    if (!authData?.user) return null;
    const { data: profile } = await supabase.from('profiles').select('role_id').eq('auth_user_id', authData.user.id).single() as any;
    if (!profile?.role_id) return null;
    const { data: role } = await supabase.from('roles').select('name').eq('id', profile.role_id).single() as any;
    return role?.name ? String(role.name).trim().toUpperCase() : null;
  },

  /**
   * Admin: record the (single) payment of a payroll.
   * Policy: ADMIN only; amount must equal the approved net salary exactly; one payment per payroll.
   * The authoritative work runs in ONE database transaction (record_payroll_payment): it locks the
   * payroll row, re-checks role, status, amount and existing payments, inserts the payment and sets
   * PAID. The checks below only give early, friendly messages; they are not relied on for safety.
   */
  async markPayrollPaid(id: string, amount: number, method: string, reference: string, remarks?: string, paymentDate?: string) {
    const adminId = await salaryService.getCurrentEmployeeId();
    if (!adminId) return { error: new Error('Unauthorized') };
    const role = await this._getCurrentRole();
    if (!canRecordPayment(role)) return { error: new Error('Only an Admin can record payroll payments.') };

    const { data: payroll } = await supabase.from('payroll').select('status, net_salary, employee_id, payroll_month, payroll_year').eq('id', id).single<any>();
    if (!payroll) return { error: new Error('Not found') };

    const amountErr = validatePaymentAmount(amount, Number(payroll.net_salary));
    if (amountErr) return { error: new Error(amountErr) };
    const dateErr = validatePaymentDate(paymentDate, companyDateStr());
    if (dateErr) return { error: new Error(dateErr) };
    if (!method || !String(method).trim()) return { error: new Error('Choose a payment method.') };

    const blocked = paymentBlockReason(payroll.status, 0);
    if (blocked) return { error: new Error(blocked) };

    const { data: paymentId, error: rpcErr } = await (supabase as any).rpc('record_payroll_payment', {
      p_payroll_id: id,
      p_amount: amount,
      p_payment_method: String(method).trim(),
      p_transaction_reference: reference ? String(reference).trim() : null,
      p_remarks: remarks ? String(remarks).trim() : null,
      p_paid_at: paymentDateToTimestamp(paymentDate),
    });
    if (rpcErr) return { error: new Error(paymentRpcErrorMessage(rpcErr)) };
    if (!paymentId) return { error: new Error('Payment was not recorded: the database did not confirm the payment.') };

    await auditService.recordAuditLog({
      action: 'PAYMENT_MARKED',
      module: 'PAYROLL',
      entity_type: 'payroll',
      entity_id: id,
      description: `Recorded payment of ₹${amount} for payroll via ${method}`,
      new_values: { amount, method, reference, payment_id: paymentId }
    });

    // Salary paid + payslip now available (the employee Payslip page opens PAID/CLOSED payrolls)
    await notificationService.notifyEmployee(payroll.employee_id, salaryPaid({ id, month: payroll.payroll_month, year: payroll.payroll_year }));
    await notificationService.notifyEmployee(payroll.employee_id, payslipAvailable({ payrollId: id, month: payroll.payroll_month, year: payroll.payroll_year }));

    return { error: null, paymentId };
  }
};
