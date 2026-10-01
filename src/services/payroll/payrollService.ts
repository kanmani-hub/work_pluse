import { supabase } from '../../lib/supabase';
import { salaryService } from './salaryService';
import { auditService } from '../audit/auditService';
import { notificationService } from '../notifications/notificationService';
import { payrollSettingsService } from './payrollSettingsService';
import { payrollDataService } from './payrollDataService';
import type { PayrollEmployeeData } from './payrollDataService';

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
   * Admin: Generate Payroll for all active employees
   */
  async generatePayroll(year: number, month: number) {
    const adminId = await salaryService.getCurrentEmployeeId();
    if (!adminId) return { success: false, error: 'Unauthorized' };

    // Get all active structures
    const { data: structures } = await supabase.from('salary_structures').select('employee_id').eq('is_active', true) as any;
    if (!structures || structures.length === 0) return { success: false, error: 'No active employees with salary structures found' };

    // Set dates for the month
    const startDate = new Date(year, month - 1, 1).toISOString();
    const endDate = new Date(year, month, 0).toISOString();

    let successCount = 0;
    for (const s of structures) {
      if (s.employee_id) {
        const res = await this.calculatePayroll(s.employee_id, year, month, startDate, endDate);
        if (!res.error) {
          successCount++;
          // Auto submit to UNDER_REVIEW
          if (res.data?.id) {
            await this.submitPayrollForReview(res.data.id);
          }
        }
      }
    }

    return { success: true, count: successCount };
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

  async recalculatePayroll(employeeId: string, year: number, month: number, periodStart: string, periodEnd: string) {
    const adminId = await salaryService.getCurrentEmployeeId();
    if (!adminId) return { error: new Error('Unauthorized') };

    const { data: existing } = await supabase
      .from('payroll')
      .select('id, status')
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

    const res = await this._doCalculate(employeeId, year, month, periodStart, periodEnd);
    
    // Restore UNDER_REVIEW if it was previously UNDER_REVIEW
    if (res.data?.id && existing?.status === 'UNDER_REVIEW') {
      await this.submitPayrollForReview(res.data.id);
      res.data.status = 'UNDER_REVIEW';
    }
    
    return res;
  },

  async _doCalculate(employeeId: string, year: number, month: number, periodStart: string, periodEnd: string) {
    // 1. Get salary structure
    const { data: salary, error: salErr } = (await salaryService.getSalaryStructureForPeriod(employeeId, periodStart, periodEnd)) as any;
    if (salErr || !salary) {
      return { error: new Error('No active salary structure found for this payroll period.') };
    }

    // 2. Get payroll settings from configuration (not hardcoded)
    const settings = payrollSettingsService.getSettings();

    // 3. Get actual employee data from attendance/leave/permission/wfh modules
    const empData: PayrollEmployeeData = await payrollDataService.getEmployeePayrollData(employeeId, year, month);

    // 4. Compute Gross Salary
    const basic = Number(salary.basic_salary || 0);
    const totalAllowances = Number(salary.hra || 0) + Number(salary.transport_allowance || 0) + 
                            Number(salary.medical_allowance || 0) + Number(salary.special_allowance || 0) + 
                            Number(salary.other_allowances || 0);
    const grossSalary = basic + totalAllowances;

    // 5. Calculate working days based on settings
    const workingDays = payrollSettingsService.getWorkingDaysForMonth(year, month, settings);
    const dailyRate = workingDays > 0 ? grossSalary / workingDays : 0;

    // 6. Calculate deductions based on ENABLED rules only
    let totalDeductions = Number(salary.standard_deduction || 0);
    let lopDeduction = 0;
    const deductionItems: { name: string; amount: number }[] = [];

    // LOP Deduction
    if (settings.enableLopDeductions && empData.leave.lopLeave > 0) {
      lopDeduction = payrollSettingsService.applyRounding(empData.leave.lopLeave * dailyRate, settings);
      totalDeductions += lopDeduction;
      deductionItems.push({ name: 'LOP Deduction', amount: lopDeduction });
    }

    // Half-Day Deduction
    if (settings.enableHalfDayDeductions && empData.attendance.halfDays > 0) {
      const halfDayDeduction = payrollSettingsService.applyRounding(empData.attendance.halfDays * dailyRate * 0.5, settings);
      totalDeductions += halfDayDeduction;
      deductionItems.push({ name: 'Half-Day Deduction', amount: halfDayDeduction });
    }

    // Late Login Deduction
    if (settings.enableLateLoginDeduction) {
      const limit = settings.monthlyLateLoginLimit || 0;
      const chargeableLates = Math.max(0, empData.attendance.lateLogins - limit);
      
      if (chargeableLates > 0 || (settings.lateDeductionMethod === 'per_minute' && empData.attendance.lateLogins > 0)) {
        let lateDeduction = 0;
        const rate = settings.lateDeductionAmountOrRate || 0;
        
        if (settings.lateDeductionMethod === 'per_minute') {
          // Typically we charge for ALL late minutes if limit is 0. 
          // If a monthly limit > 0 is configured, and it's 'per_minute', it's slightly ambiguous 
          // (do we ignore the minutes from the first N allowed lates?). 
          // We will use totalLateMinutes unconditionally, assuming if per_minute is chosen with a limit, 
          // we only trigger deduction if late occurrences > limit, but charge for total minutes. 
          // If limit is 0 (our default), this works perfectly for all minutes.
          if (empData.attendance.lateLogins > limit) {
             const lateMins = empData.attendance.totalLateMinutes || 0;
             lateDeduction = payrollSettingsService.applyRounding(lateMins * rate, settings);
          }
        } else if (settings.lateDeductionMethod === 'fixed') {
          lateDeduction = payrollSettingsService.applyRounding(chargeableLates * rate, settings);
        } else {
          // half_day (legacy behavior)
          lateDeduction = payrollSettingsService.applyRounding(chargeableLates * dailyRate * 0.5, settings);
        }

        if (lateDeduction > 0) {
          totalDeductions += lateDeduction;
          deductionItems.push({ name: 'Late Login Deduction', amount: lateDeduction });
        }
      }
    }

    // Permission Deduction (only excess beyond configured limit)
    if (settings.enablePermissionDeduction && empData.permission.permissionCount > settings.permissionLimit) {
      const excessPermissions = empData.permission.permissionCount - settings.permissionLimit;
      const permDeduction = payrollSettingsService.applyRounding(excessPermissions * dailyRate * 0.5, settings);
      totalDeductions += permDeduction;
      deductionItems.push({ name: 'Permission Deduction', amount: permDeduction });
    }

    // WFH Deduction (if configured)
    if (settings.enableWfhDeduction && empData.wfh.wfhDays > 0) {
      const wfhDeduction = payrollSettingsService.applyRounding(empData.wfh.wfhDays * dailyRate * 0.1, settings);
      totalDeductions += wfhDeduction;
      deductionItems.push({ name: 'WFH Deduction', amount: wfhDeduction });
    }

    // 7. Overtime (only approved)
    let overtime = 0;
    if (settings.enableOvertimePay) {
      // For now overtime stays at 0 until an overtime module exists
      overtime = 0;
    }

    // 8. Apply rounding
    totalDeductions = payrollSettingsService.applyRounding(totalDeductions, settings);
    
    let netSalary = payrollSettingsService.applyRounding((grossSalary + overtime) - totalDeductions, settings);
    if (netSalary < 0) netSalary = 0;

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
      },
      deductionBreakdown: deductionItems,
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
        notes: dataSummary
      } as any)
      .select()
      .single<any>();

    if (insErr || !payroll) {
      return { error: insErr || new Error('Failed to create payroll record.') };
    }

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

    return { data: payroll, error: null };
  },

  /**
   * Status transitions
   */
  async updateStatus(id: string, newStatus: string, expectedCurrentStatus?: string[]) {
    const adminId = await salaryService.getCurrentEmployeeId();
    if (!adminId) return { error: new Error('Unauthorized') };

    const { data: existing } = await supabase.from('payroll').select('status').eq('id', id).single<any>();
    if (!existing) return { error: new Error('Not found') };

    if (expectedCurrentStatus && !expectedCurrentStatus.includes(existing.status)) {
      return { error: new Error(`Cannot transition from ${existing.status} to ${newStatus}`) };
    }

    const payload: any = { status: newStatus };
    if (newStatus === 'APPROVED') {
      payload.approved_at = new Date().toISOString();
      payload.approved_by = adminId;
    } else if (newStatus === 'CLOSED') {
      payload.locked_at = new Date().toISOString();
    }

    const { error } = await supabase.from('payroll').update(payload as never).eq('id', id);

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

      if (payrollInfo && (newStatus === 'APPROVED' || newStatus === 'PAID')) {
        await notificationService.createNotification({
          recipient_employee_id: payrollInfo.employee_id,
          notification_type: 'PAYROLL',
          title: `Payroll ${newStatus === 'PAID' ? 'Paid' : 'Approved'}`,
          message: `Your payroll for ${payrollInfo.payroll_month}/${payrollInfo.payroll_year} has been ${newStatus.toLowerCase()}.`,
          action_url: '/employee/payroll'
        });
      }
    }

    return { error };
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
  async markPayrollPaid(id: string, amount: number, method: string, reference: string, remarks?: string) {
    const adminId = await salaryService.getCurrentEmployeeId();
    if (!adminId) return { error: new Error('Unauthorized') };

    const { data: payroll } = await supabase.from('payroll').select('status, net_salary, employee_id').eq('id', id).single<any>();
    if (!payroll) return { error: new Error('Not found') };

    if (payroll.status !== 'PAYMENT_PENDING') {
      return { error: new Error('Payroll is not in PAYMENT_PENDING status') };
    }

    // Insert payment record
    const { error: payErr } = await supabase.from('payroll_payments').insert({
      payroll_id: id,
      paid_at: new Date().toISOString(),
      amount: amount || payroll.net_salary,
      payment_method: method,
      transaction_reference: reference || null,
      remarks: remarks || null,
      paid_by: adminId
    } as never);

    if (payErr) return { error: payErr };

    // Update payroll status
    const { error: updErr } = await supabase.from('payroll').update({ status: 'PAID' } as never).eq('id', id);

    if (!updErr) {
      await auditService.recordAuditLog({
        action: 'PAYROLL_PAID',
        module: 'PAYROLL',
        entity_type: 'payroll',
        entity_id: id,
        description: `Recorded payment of ₹${amount || payroll.net_salary} for payroll via ${method}`,
        new_values: { amount: amount || payroll.net_salary, method, reference }
      });

      await notificationService.createNotification({
        recipient_employee_id: payroll.employee_id,
        notification_type: 'PAYROLL',
        title: 'Salary Paid',
        message: `Your salary has been disbursed via ${method}.`,
        action_url: '/employee/payroll'
      });
    }

    return { error: updErr };
  }
};
