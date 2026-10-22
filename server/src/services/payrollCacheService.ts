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

        // Fetch from Supabase tables
        const [attendanceRes, salaryRes, rulesRes] = await Promise.all([
          supabase.from('attendance').select('*').eq('work_date', filter.date),
          supabase.from('salary_structures').select('*'),
          supabase.from('payroll_rules').select('*').maybeSingle(),
        ]);

        return {
          date: filter.date,
          source: 'database_fresh',
          generatedAt: new Date().toISOString(),
          recordCount: attendanceRes.data?.length || 0,
          attendance: attendanceRes.data || [],
          salaryStructures: salaryRes.data || [],
          rules: rulesRes.data || null,
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
