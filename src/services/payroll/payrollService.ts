import { supabase } from '../../lib/supabase';
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

    // Find all attendance records for this date
    const { data: attendanceRecords, error: attErr } = await supabase
      .from('attendance')
      .select('employee_id, status, clock_in_at, clock_out_at, shift_template:shift_template_id(name)')
      .eq('attendance_date', dateStr) as any;

    if (attErr || !attendanceRecords) {
      return { data: null, error: new Error(`Attendance could not be loaded: ${attErr?.message || 'no data returned'}`) };
    }

    const { data: employees, error: empErr } = await supabase
      .from('employees')
      .select('id, first_name, last_name, employee_code, departments(name)')
      .in('id', attendanceRecords.map((a: any) => a.employee_id)) as any;

    if (empErr || !employees) return { data: null, error: new Error(`Employees could not be loaded: ${empErr?.message || 'no data returned'}`) };

    // Get the year and month for the given date to pass to the calculation engine
    const d = new Date(dateStr);
    const year = d.getFullYear();
    const month = d.getMonth() + 1;

    const reports = [];
    const failures: string[] = [];

    for (const emp of employees) {
      const att = attendanceRecords.find((a: any) => a.employee_id === emp.id);
      if (!att) continue;

      const calc = await this.calculatePayrollDetails(emp.id, year, month, dateStr, dateStr);
      if (calc.error || !calc.data) {
        failures.push(`${emp.employee_code || emp.id}: ${calc.error?.message || 'not calculated'}`);
        continue;
      }
      
      if (!calc.error && calc.data) {
        const c = calc.data as any;
        const totalLate = c.empData.attendance.totalLateMinutes;
        const lateDed = c.deductionItems.find((d: any) => d.name.includes('Late Deduction'))?.amount || 0;
        
        const totalBreakOverrun = c.empData.attendance.totalBreakExcessMinutes;
        const breakDed = c.deductionItems.find((d: any) => d.name.includes('Break Excess Deduction'))?.amount || 0;

        const overtimeMins = c.empData.attendance.totalOvertimeMinutes;
        const overtimePay = c.overtime;

        const lopImpact = c.lopDeduction;

        // Sum all other deductions excluding Late, Break, LOP, Standard
        const otherDed = c.deductionItems
          .filter((d: any) => !d.name.includes('Late Deduction') && !d.name.includes('Break Excess') && !d.name.includes('LOP Deduction'))
          .reduce((sum: number, item: any) => sum + item.amount, 0);

        reports.push({
          employee: emp,
          shift: att.shift_template?.name || 'Standard',
          status: att.status,
          clockIn: att.clock_in_at,
          clockOut: att.clock_out_at,
          lateMinutes: totalLate,
          lateDeduction: lateDed,
          breakOverrunMinutes: totalBreakOverrun,
          breakDeduction: breakDed,
          overtimeMinutes: overtimeMins,
          overtimePay: overtimePay,
          lopImpact: lopImpact,
          otherDeductions: otherDed,
          totalDailyImpact: lateDed + breakDed + lopImpact + otherDed,
          rawCalc: c
        });
      }
    }

    // A preview that silently drops employees would understate deductions: report them instead.
    if (failures.length > 0) {
      return { data: null, error: new Error(`Deductions could not be calculated for ${failures.length} employee(s). ${failures[0]}`) };
    }
    return { data: reports, error: null };
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
      
      // Delete existing to recalculate
      await supabase.from('payroll_items').delete().eq('payroll_id', existing.id);
      await supabase.from('payroll').delete().eq('id', existing.id);
    }

    // Admin decisions on review flags survive recalculation
    const resolutions: ReviewResolution[] = opts?.resolutions ?? (parsePayrollSnapshot(existing?.remarks)?.reviewResolutions || []);
    const res: any = await this._doCalculate(employeeId, year, month, periodStart, periodEnd, { resolutions });
    
    // Restore UNDER_REVIEW if it was previously UNDER_REVIEW
    if (res.data?.id && existing?.status === 'UNDER_REVIEW') {
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

    const [daysResult, wfhResult, permissionResult, approvedOt] = await Promise.all([
      payrollDataService._fetchPayrollDays(employeeId, startDate, endDate, appSettings, companyDateStr(), resolutionMap(opts?.resolutions)),
      payrollDataService._fetchWfh(employeeId, startDate, endDate),
      payrollDataService._fetchPermissions(employeeId, startDate, endDate),
      payrollDataService._fetchApprovedOvertime(employeeId, startDate, endDate),
    ]);

    // A failed lookup is never treated as "no absences / no leave / no permissions": stop instead.
    const lookups: [string, any][] = [['Attendance', daysResult], ['Approved WFH', wfhResult], ['Approved permissions', permissionResult]];
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

    // 4. Compute Gross Salary
    const basic = Number(salary.basic_salary || 0);
    const totalAllowances = Number(salary.hra || 0) + Number(salary.transport_allowance || 0) + 
                            Number(salary.medical_allowance || 0) + Number(salary.special_allowance || 0) + 
                            Number(salary.other_allowances || 0);
    const grossSalary = basic + totalAllowances;

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
    if (settings.enableLateLoginDeduction) {
      const totalLateMins = empData.attendance.totalLateMinutes || 0;
      if (totalLateMins > 0) {
        let lateDeduction = 0;
        
        if (settings.lateDeductionMethod === 'interval_based') {
          const intervalMins = settings.lateIntervalMinutes || 15;
          const intervalAmount = settings.lateIntervalAmount || 100;
          lateDeduction = Math.floor(totalLateMins / intervalMins) * intervalAmount;
        } else if (settings.lateDeductionMethod === 'fixed') {
          lateDeduction = settings.lateFixedAmount || 0;
        } else if (settings.lateDeductionMethod === 'per_minute') {
          lateDeduction = totalLateMins * (settings.latePerMinuteRate || 0);
        } else if (settings.lateDeductionMethod === 'half_day') {
          if (settings.halfDayMethod === 'fixed') {
            lateDeduction = settings.lateHalfDayAmount || settings.halfDayAmount || 0;
          } else {
            lateDeduction = dailyRate * 0.5;
          }
        }
        
        lateDeduction = payrollSettingsService.applyRounding(lateDeduction, settings);

        if (lateDeduction > 0) {
          totalDeductions += lateDeduction;
          deductionItems.push({ name: `Late Deduction (${totalLateMins}m)`, amount: lateDeduction });
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

    // 7. Overtime
    let overtime = 0;
    const otRaw = overtimePayAmount({
      enableOvertimePay: settings.enableOvertimePay,
      approvedOvertimeMinutes: empData.attendance.totalOvertimeMinutes,
      dailyRate,
      overtimeRateType: settings.overtimeRateType,
      overtimeMultiplier: settings.overtimeMultiplier,
      overtimeFixedRate: settings.overtimeFixedRate,
    });
    if (otRaw > 0) overtime = payrollSettingsService.applyRounding(otRaw, settings);

    // 8. Apply rounding
    totalDeductions = payrollSettingsService.applyRounding(totalDeductions, settings);
    
    let netSalary = payrollSettingsService.applyRounding((grossSalary + overtime) - totalDeductions, settings);
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
        salary,
        settings
      },
      error: null
    };
  },

  async _doCalculate(employeeId: string, year: number, month: number, periodStart: string, periodEnd: string, opts?: { resolutions?: ReviewResolution[] }) {
    const resolutions = opts?.resolutions || [];
    const calc = await this.calculatePayrollDetails(employeeId, year, month, periodStart, periodEnd, { resolutions });
    if (calc.error) return { data: null, error: calc.error };
    
    const {
      basic, grossSalary, totalAllowances, totalDeductions, lopDeduction, overtime, netSalary,
      empData, workingDays, dailyRate, deductionItems, salary, settings
    } = calc.data as any;

    // 9. Build attendance/leave/permission summary JSON to store in payroll
    const dataSummary = JSON.stringify({
      attendance: empData.attendance,
      leave: empData.leave,
      wfh: empData.wfh,
      permission: empData.permission,
      settings: {
        workingDaysBasis: settings.workingDaysBasis,
        configuredWorkingDays: settings.configuredWorkingDays,
        workingDaysUsed: workingDays,
        dailyRate: payrollSettingsService.applyRounding(dailyRate, settings),
        wfhDeductionApplied: WFH_DEDUCTION_POLICY_APPROVED && !!settings.enableWfhDeduction,
      },
      deductionBreakdown: deductionItems,
      // Admin decisions on attendance review flags (who / when / why), carried across recalculation
      reviewResolutions: resolutions,
    });

    // 10. Insert Payroll
    const { data: payroll, error: insErr } = await supabase
      .from('payroll')
      .insert({
        employee_id: employeeId,
        payroll_year: year,
        payroll_month: month,
        period_start: periodStart,
        period_end: periodEnd,
        basic_salary: basic,
        gross_salary: grossSalary,
        total_allowances: totalAllowances,
        total_deductions: totalDeductions,
        lop_deduction: lopDeduction,
        overtime_amount: overtime,
        net_salary: netSalary,
        status: 'CALCULATED',
        calculated_at: new Date().toISOString(),
        remarks: dataSummary
      } as any)
      .select()
      .single<any>();

    if (insErr || !payroll) {
      return { error: insErr || new Error('Failed to create payroll record.') };
    }

    await payrollAuditService.logEvent({
      payrollId: payroll.id,
      action: 'PAYROLL_GENERATED',
      title: `System generated ${year}-${String(month).padStart(2, '0')} payroll`,
      description: `Base Salary: ₹${basic.toLocaleString('en-IN')}\nNet Salary: ₹${netSalary.toLocaleString('en-IN')}`,
      newStatus: 'CALCULATED'
    });

    await payrollAuditService.logEvent({
      payrollId: payroll.id,
      action: 'PAYROLL_CALCULATED',
      title: `Salary Calculation [${year}-${String(month).padStart(2, '0')}]`,
      description: `Working Days: ${workingDays}\nDaily Rate: ₹${payrollSettingsService.applyRounding(dailyRate, settings)}\nPaid Days: ${empData.attendance.presentDays}\nUnpaid Days: ${empData.attendance.lopDays}`,
    });

    // 11. Insert Payroll Items
    const items: any[] = [];
    if (grossSalary > 0) items.push({ payroll_id: payroll.id, item_type: 'EARNING', item_name: 'Gross Salary', amount: grossSalary });
    if (overtime > 0) items.push({ payroll_id: payroll.id, item_type: 'EARNING', item_name: 'Approved Overtime', amount: overtime });
    
    // Add individual deduction items
    for (const d of deductionItems) {
      items.push({ payroll_id: payroll.id, item_type: 'DEDUCTION', item_name: d.name, amount: d.amount });
    }
    // Standard deduction if any
    if (Number(salary.standard_deduction || 0) > 0) {
      items.push({ payroll_id: payroll.id, item_type: 'DEDUCTION', item_name: 'Standard Deduction', amount: Number(salary.standard_deduction) });
    }

    if (items.length > 0) {
      await supabase.from('payroll_items').insert(items as any);
    }

    return { data: payroll, error: null, reviewItems: empData.attendance.reviewItems || [] };
  },

  /**
   * Status transitions
   */
  async updateStatus(id: string, newStatus: string, expectedCurrentStatus?: string[]) {
    const adminId = await salaryService.getCurrentEmployeeId();
    if (!adminId) return { error: new Error('Unauthorized') };

    const { data: existing } = await supabase.from('payroll').select('status, remarks').eq('id', id).single<any>();
    if (!existing) return { error: new Error('Not found') };

    // Unresolved attendance review flags block approval (single and bulk approval both come here)
    if (newStatus === 'APPROVED') {
      const blocked = approvalBlockReason(existing.remarks);
      if (blocked) return { error: new Error(blocked) };
    }

    if (expectedCurrentStatus && !expectedCurrentStatus.includes(existing.status)) {
      return { error: new Error(`Cannot transition from ${existing.status} to ${newStatus}`) };
    }
    // One forward path only; PAID only via markPayrollPaid (see payrollRules)
    const transitionErr = statusChangeError(existing.status, newStatus);
    if (transitionErr) return { error: new Error(transitionErr) };

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
