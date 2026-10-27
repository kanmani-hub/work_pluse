import { env } from '../config/env.js';
import { cacheService } from '../redis/cacheService.js';
import { getSupabase } from './supabase.js';

export interface DailyReportFilter {
  date: string;
  departmentId?: string;
  officeId?: string;
}

export class PayrollCacheService {
  private getCacheKey(filter: DailyReportFilter): string {
    const dept = filter.departmentId || 'all';
    const office = filter.officeId || 'all';
    return `cache:payroll:daily:${filter.date}:dept_${dept}:off_${office}`;
  }

  /**
   * Fetch daily deduction & payroll impact report, served from Redis cache when available
   */
  async getDailyDeductionReport(filter: DailyReportFilter): Promise<any> {
    const cacheKey = this.getCacheKey(filter);

    return cacheService.getOrSet(
      cacheKey,
      async () => {
        const supabase = getSupabase();
        if (!supabase) {
          // Fallback demo response if Supabase not configured in local testing
          return {
            date: filter.date,
            source: 'mock_fallback',
            generatedAt: new Date().toISOString(),
            records: [],
            summary: {
              totalEmployees: 0,
              totalDeductions: 0,
              totalAdditions: 0,
              netImpact: 0,
            },
          };
        }

        // Real tables and columns (integration fix MS-2): attendance.attendance_date, salary_structures
        // effective on that date, and the payroll section of app_settings (there is no payroll_rules table).
        let attQuery: any = supabase.from('attendance')
          .select('id, employee_id, attendance_date, clock_in_at, clock_out_at, status, worked_hours, break_minutes, break_overrun_minutes, late_minutes, early_logout_minutes, overtime_minutes, employees!inner(employee_code, first_name, last_name, department_id, office_id)')
          .eq('attendance_date', filter.date);
        if (filter.departmentId) attQuery = attQuery.eq('employees.department_id', filter.departmentId);
        if (filter.officeId) attQuery = attQuery.eq('employees.office_id', filter.officeId);
        const attendanceRes = await attQuery;
        if (attendanceRes.error) throw new Error(`attendance: ${attendanceRes.error.message}`);   // errors are not cached
        const employeeIds = [...new Set((attendanceRes.data || []).map((a: any) => a.employee_id))];
        const [salaryRes, settingsRes] = await Promise.all([
          employeeIds.length
            ? supabase.from('salary_structures').select('employee_id, effective_from, effective_to, basic_salary')
                .in('employee_id', employeeIds).lte('effective_from', filter.date)
            : Promise.resolve({ data: [], error: null } as any),
          supabase.from('app_settings').select('settings').eq('id', '00000000-0000-0000-0000-000000000001').maybeSingle(),
        ]);
        if (salaryRes.error) throw new Error(`salary_structures: ${salaryRes.error.message}`);
        if (settingsRes.error) throw new Error(`app_settings: ${settingsRes.error.message}`);
        const salaryStructures = (salaryRes.data || []).filter((s: any) => !s.effective_to || s.effective_to >= filter.date);

        return {
          date: filter.date,
          source: 'database_fresh',
          generatedAt: new Date().toISOString(),
          recordCount: attendanceRes.data?.length || 0,
          attendance: attendanceRes.data || [],
          salaryStructures,
          payrollSettings: (settingsRes.data as any)?.settings?.payroll ?? null,
        };
      },
      env.PAYROLL_CACHE_TTL_SECONDS
    );
  }

  /**
   * Invalidate cached report for a specific date (e.g. after attendance correction or overtime approval)
   */
  async invalidateDate(date: string): Promise<number> {
    const pattern = `cache:payroll:daily:${date}:*`;
    const count = await cacheService.delByPattern(pattern);
    console.log(`[PayrollCache] Invalidated ${count} cache keys for date ${date}`);
    return count;
  }

  /**
   * Invalidate all payroll cache entries
   */
  async invalidateAll(): Promise<number> {
    const count = await cacheService.delByPattern('cache:payroll:*');
    console.log(`[PayrollCache] Invalidated all (${count}) payroll cache entries`);
    return count;
  }
}

export const payrollCacheService = new PayrollCacheService();
