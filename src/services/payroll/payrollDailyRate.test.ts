import { describe, it, expect, vi, beforeEach } from 'vitest';
import { payrollService } from './payrollService';
import { salaryService } from './salaryService';
import { payrollDataService } from './payrollDataService';
import { globalSettingsService } from '../settings/globalSettingsService';
import { payrollSettingsService } from './payrollSettingsService';
import { classifyPayrollDays, summarizeDays } from './attendanceClassification';

// payrollSettingsService is NOT mocked: the real working-days basis (configured 26) and rounding are tested.
vi.mock('./salaryService');
vi.mock('./payrollDataService');
vi.mock('../settings/globalSettingsService');
vi.mock('../audit/auditService');
vi.mock('./payrollAuditService');
vi.mock('../notifications/notificationService');
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      insert: vi.fn().mockImplementation((payload) => ({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: { id: 'mock-id', ...payload }, error: null }),
        }),
      })),
      select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue({ data: null }) }),
    })),
  },
}));

// Synthetic data only.
const settings = (over: any = {}) => (globalSettingsService.loadSettings as any).mockResolvedValue({
  updated_at: '2026-10-01T00:00:00Z',
  app: { permissionMaxHoursPerMonth: 3, breakDurationMins: 75, workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] },
  // Real defaults: workingDaysBasis 'configured', configuredWorkingDays 26, salaryRounding 'round',
  // LOP by daily rate, half-day 50 %, late ₹100 per 15 min.
  payroll: { ...payrollSettingsService.getDefaults(), ...over },
});
const attendance = (a: any = {}) => ({
  workingDays: 26, presentDays: 26, absentDays: 0, lateLogins: 0, totalLateMinutes: 0, totalBreakExcessMinutes: 0,
  totalBreakOverrunMinutes: 0, totalOvertimeMinutes: 0, earlyLogouts: 0, halfDays: 0, lopDays: 0, sandwichLopDays: 0, ...a,
});
const mockData = (att: any, leave: any = {}) => {
  (payrollDataService._fetchPayrollDays as any).mockResolvedValue({
    attendance: attendance(att), leave: { approvedLeave: 0, lopLeave: 0, totalLeaveDays: 0, ...leave }, days: [], error: null,
  });
  (payrollDataService._fetchWfh as any).mockResolvedValue({ wfhDays: 0, error: null });
  (payrollDataService._fetchPermissions as any).mockResolvedValue({ permissionCount: 0, totalMinutes: 0, error: null });
  (payrollDataService._fetchApprovedOvertime as any).mockResolvedValue({ minutes: 0, error: null });
};
const gross = (amount: number) => (salaryService.getSalaryStructureForPeriod as any).mockResolvedValue({ data: { basic_salary: amount }, error: null });
const calc = () => payrollService._doCalculate('emp1', 2026, 10, '2026-10-01', '2026-10-31');
const lopItems = (res: any) => JSON.parse(res.data.remarks).deductionBreakdown.filter((d: any) => d.name.startsWith('LOP Deduction'));

beforeEach(() => {
  vi.clearAllMocks();
  settings();
  gross(26000); // ₹26,000 / 26 = ₹1,000 a day
});

describe('Rule 4: daily rate = monthly gross ÷ 26 (Payroll Settings → working-days basis "configured", 26)', () => {
  it('the configured basis is 26 and the stored calculation records it', async () => {
    expect(payrollSettingsService.getWorkingDaysForMonth(2026, 10, payrollSettingsService.getDefaults())).toBe(26);
    mockData({});
    const res: any = await calc();
    expect(res.error).toBeNull();
    expect(JSON.parse(res.data.remarks).settings).toMatchObject({ workingDaysBasis: 'configured', configuredWorkingDays: 26, workingDaysUsed: 26, dailyRate: 1000 });
  });

  it('the divisor is NOT the scheduled working days or calendar days (31 days in October, 27 scheduled)', async () => {
    gross(30000); // 30000 / 26 = 1153.846…
    mockData({ workingDays: 27, absentDays: 1, lopDays: 1 });
    const res: any = await calc();
    expect(res.data.lop_deduction).toBe(1154); // rounded to the rupee ('round'); /27 would be 1111, /31 would be 968
    expect(JSON.parse(res.data.remarks).settings.dailyRate).toBe(1154);
  });

  it('full-day LOP: 1 day = ₹1,000; net = gross − LOP', async () => {
    mockData({ absentDays: 1, lopDays: 1, presentDays: 25 });
    const res: any = await calc();
    expect(res.data.lop_deduction).toBe(1000);
    expect(res.data.total_deductions).toBe(1000);
    expect(res.data.net_salary).toBe(25000);
  });

  it('half-day LOP (approved half-day Loss-of-Pay leave): 0.5 day = ₹500', async () => {
    mockData({ lopDays: 0.5 }, { lopLeave: 0.5, totalLeaveDays: 0.5 });
    const res: any = await calc();
    expect(res.data.lop_deduction).toBe(500);
    expect(res.data.net_salary).toBe(25500);
  });

  it('half-day attendance deduction is 50 % of the daily rate and is not LOP', async () => {
    mockData({ halfDays: 1 });
    const res: any = await calc();
    expect(res.data.lop_deduction).toBe(0);
    expect(res.data.total_deductions).toBe(500);
  });

  it('rounding: 2.5 LOP days on ₹30,000 = 2.5 × 1153.846 = 2884.62 → ₹2,885', async () => {
    gross(30000);
    mockData({ absentDays: 2, lopDays: 2.5 }, { lopLeave: 0.5, totalLeaveDays: 0.5 });
    const res: any = await calc();
    expect(res.data.lop_deduction).toBe(2885);
    expect(res.data.net_salary).toBe(27115);
  });

  it('exact rounding setting keeps paise: 1 LOP day on ₹30,000 = ₹1,153.85', async () => {
    settings({ salaryRounding: 'exact' });
    gross(30000);
    mockData({ absentDays: 1, lopDays: 1 });
    const res: any = await calc();
    expect(res.data.lop_deduction).toBe(1153.85);
    expect(res.data.net_salary).toBe(28846.15);
  });
});

describe('Rule 3: early logout has no automatic salary deduction', () => {
  it('3 early logouts (120 min) on worked days → ₹0 deducted; minutes kept for information', async () => {
    mockData({ earlyLogouts: 3, earlyLogoutMinutes: 120 });
    const res: any = await calc();
    expect(res.error).toBeNull();
    expect(res.data.total_deductions).toBe(0);
    expect(res.data.net_salary).toBe(26000);
    expect(JSON.parse(res.data.remarks).attendance).toMatchObject({ earlyLogouts: 3, earlyLogoutMinutes: 120 });
  });
});

describe('no duplicate deductions across leave, absence and attendance', () => {
  it('absence + LOP leave + sandwich + half day + lateness: each counted once, in its own item', async () => {
    mockData({ absentDays: 1, sandwichLopDays: 1, lopDays: 3, halfDays: 1, totalLateMinutes: 30 }, { approvedLeave: 2, lopLeave: 1, totalLeaveDays: 3 });
    const res: any = await calc();
    const items = JSON.parse(res.data.remarks).deductionBreakdown;
    expect(items).toEqual([
      { name: 'LOP Deduction (1d unauthorized absence, 1d sandwich LOP, 1d unpaid leave)', amount: 3000 },
      { name: 'Half-Day Deduction', amount: 500 },
      { name: 'Late Deduction (30m)', amount: 200 },
    ]);
    expect(res.data.total_deductions).toBe(3700);
    expect(res.data.net_salary).toBe(22300);
  });

  it('end to end from synthetic attendance: classification → deduction, paid leave never deducted', async () => {
    // Oct 1–10 2026, Mon–Sat: LATE day, holiday, paid leave, LOP half-day leave + worked half, one absence,
    // a half-day leave with no attendance for the other half (flagged, not deducted)
    const row = (d: string, status: string, extra: any = {}) => ({ attendance_date: d, status, clock_in_at: `${d}T03:30:00Z`, ...extra });
    const days = classifyPayrollDays({
      periodStart: '2026-10-01', periodEnd: '2026-10-10', today: '2026-10-31', joiningDate: '2025-01-01',
      workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'], holidays: ['2026-10-02'],
      attendance: [row('2026-10-01', 'LATE', { late_minutes: 30 }), row('2026-10-03', 'COMPLETED'), row('2026-10-06', 'HALF_DAY', { is_half_day: true }),
        row('2026-10-08', 'COMPLETED', { early_logout_minutes: 40 }), row('2026-10-10', 'COMPLETED')],
      leaves: [
        { start_date: '2026-10-05', end_date: '2026-10-05', isLop: false },
        { start_date: '2026-10-06', end_date: '2026-10-06', is_half_day: true, half_day_type: 'SECOND_HALF', isLop: true },
        { start_date: '2026-10-09', end_date: '2026-10-09', is_half_day: true, half_day_type: 'FIRST_HALF', isLop: false },
      ],
      // 2026-10-07: no row, no leave → absent
    });
    const s = summarizeDays(days);
    expect(s).toMatchObject({ absentDays: 1, lopLeaveDays: 0.5, lopDays: 1.5, paidLeaveDays: 1.5, halfDays: 0, holidayDays: 1, earlyLogoutMinutes: 40 });
    expect(s.reviewItems.map(r => r.date)).toEqual(['2026-10-09']);
    mockData({ absentDays: s.absentDays, lopDays: s.lopDays, halfDays: s.halfDays, totalLateMinutes: 30, earlyLogouts: 1, earlyLogoutMinutes: 40 },
      { approvedLeave: s.paidLeaveDays, lopLeave: s.lopLeaveDays, totalLeaveDays: 2 });
    const res: any = await calc();
    expect(lopItems(res)).toEqual([{ name: 'LOP Deduction (1d unauthorized absence, 0.5d unpaid leave)', amount: 1500 }]);
    expect(res.data.total_deductions).toBe(1700); // ₹1,500 LOP + ₹200 late; no half-day, early-logout or paid-leave deduction
  });
});

describe('Policy 2026-10-09: working-days basis is read from the saved setting', () => {
  const MON_SAT = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  it('"configured" divides by the saved configuredWorkingDays (26)', async () => {
    settings({ workingDaysBasis: 'configured', configuredWorkingDays: 26 });
    mockData({ absentDays: 1, lopDays: 1 });
    const res: any = await calc();
    expect(res.data.lop_deduction).toBe(1000);
    expect(JSON.parse(res.data.remarks).settings).toMatchObject({ workingDaysBasis: 'configured', workingDaysUsed: 26 });
  });

  it('the saved live value "actual" is respected and now counts company working days: October 2026 Mon–Sat = 27 (was Mon–Fri 22)', async () => {
    settings({ workingDaysBasis: 'actual', configuredWorkingDays: 26 });
    gross(27000);
    mockData({ absentDays: 1, lopDays: 1 });
    const res: any = await calc();
    expect(JSON.parse(res.data.remarks).settings).toMatchObject({ workingDaysBasis: 'actual', workingDaysUsed: 27, dailyRate: 1000 });
    expect(res.data.lop_deduction).toBe(1000);
  });

  // Policy 2026-10-09 (fully database-driven): no hardcoded Mon–Fri / 26 fallback — an invalid saved configuration is NaN
  it('getWorkingDaysForMonth: actual uses the saved company days; no saved days → NaN (no Mon–Fri guess)', () => {
    const s = { ...payrollSettingsService.getDefaults(), workingDaysBasis: 'actual' as const };
    expect(payrollSettingsService.getWorkingDaysForMonth(2026, 10, s, MON_SAT)).toBe(27);
    expect(payrollSettingsService.getWorkingDaysForMonth(2026, 10, s, ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'])).toBe(22);
    expect(Number.isNaN(payrollSettingsService.getWorkingDaysForMonth(2026, 10, s))).toBe(true);
    expect(Number.isNaN(payrollSettingsService.getWorkingDaysForMonth(2026, 10, s, []))).toBe(true);
    expect(Number.isNaN(payrollSettingsService.getWorkingDaysForMonth(2026, 10, { ...s, workingDaysBasis: 'weekly' as any }, MON_SAT))).toBe(true);
    expect(Number.isNaN(payrollSettingsService.getWorkingDaysForMonth(2026, 10, { ...s, workingDaysBasis: 'configured', configuredWorkingDays: 0 }, MON_SAT))).toBe(true);
    expect(payrollSettingsService.getWorkingDaysForMonth(2026, 2, s, MON_SAT)).toBe(24); // Feb 2026: 28 days, 4 Sundays
    expect(payrollSettingsService.getWorkingDaysForMonth(2026, 10, { ...s, workingDaysBasis: 'calendar' }, MON_SAT)).toBe(31);
    expect(payrollSettingsService.getWorkingDaysForMonth(2026, 10, { ...s, workingDaysBasis: 'configured', configuredWorkingDays: 26 }, MON_SAT)).toBe(26);
  });
});

describe('Policy 2026-10-09: WFH days are never charged (policy not approved)', () => {
  for (const method of ['per_day', 'fixed', 'half_day']) {
    it(`WFH deduction switched ON (${method}, ₹500 per day) with 3 WFH days → ₹0 deducted`, async () => {
      settings({ enableWfhDeduction: true, wfhDeductionMethod: method, wfhPerDayAmount: 500, wfhFixedAmount: 500, wfhHalfDayAmount: 500 });
      mockData({});
      (payrollDataService._fetchWfh as any).mockResolvedValue({ wfhDays: 3, error: null });
      const res: any = await calc();
      expect(res.error).toBeNull();
      expect(res.data.total_deductions).toBe(0);
      expect(res.data.net_salary).toBe(26000);
      const snap = JSON.parse(res.data.remarks);
      expect(snap.deductionBreakdown.some((d: any) => /WFH/.test(d.name))).toBe(false);
      expect(snap.settings.wfhDeductionApplied).toBe(false);
      expect(snap.wfh.wfhDays).toBe(3); // still recorded for information
    });
  }
});

describe('Policy 2026-10-09: short days — no half-day deduction until an Admin applies it', () => {
  it('an unresolved short day (flag, halfDays 0) deducts nothing; once APPLIED (halfDays 1) the existing 50 % rule applies', async () => {
    mockData({ halfDays: 0, reviewItems: [{ date: '2026-10-06', type: 'SHORT_DAY', reason: 'Short working day' }] });
    const flagged: any = await calc();
    expect(flagged.data.total_deductions).toBe(0);
    mockData({ halfDays: 1, reviewItems: [] });
    const applied: any = await calc();
    expect(applied.data.total_deductions).toBe(500);
  });

  it('decisions are passed to the classification and stored with the calculation', async () => {
    mockData({});
    const resolutions = [{ date: '2026-10-06', type: 'SHORT_DAY', decision: 'WAIVE' as const, note: 'Doctor visit', by: 'admin1', at: '2026-10-20T10:00:00Z' }];
    const res: any = await payrollService._doCalculate('emp1', 2026, 10, '2026-10-01', '2026-10-31', { resolutions });
    expect((payrollDataService._fetchPayrollDays as any).mock.calls[0][5]).toEqual({ '2026-10-06|SHORT_DAY': 'WAIVE' });
    expect(JSON.parse(res.data.remarks).reviewResolutions).toEqual(resolutions);
  });
});

describe('Saved payroll settings drive the daily rate (changing a setting changes the result)', () => {
  it('configured 26 → ₹1,000/day; configured 30 → ₹866.67 → ₹867 (rounded); calendar → ₹838.71 → ₹839', async () => {
    mockData({ absentDays: 1, lopDays: 1 });
    settings({ workingDaysBasis: 'configured', configuredWorkingDays: 26 });
    expect((await calc() as any).data.lop_deduction).toBe(1000);
    settings({ workingDaysBasis: 'configured', configuredWorkingDays: 30 });
    expect((await calc() as any).data.lop_deduction).toBe(867);
    settings({ workingDaysBasis: 'calendar' });
    expect((await calc() as any).data.lop_deduction).toBe(839);
  });

  it('"actual" follows the saved company working days: Mon–Sat 27 days vs Mon–Fri 22 days', async () => {
    mockData({ absentDays: 1, lopDays: 1 });
    gross(27000);
    (globalSettingsService.loadSettings as any).mockResolvedValue({ updated_at: 'x', app: { workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] }, payroll: { ...payrollSettingsService.getDefaults(), workingDaysBasis: 'actual' } });
    expect((await calc() as any).data.lop_deduction).toBe(1000);
    (globalSettingsService.loadSettings as any).mockResolvedValue({ updated_at: 'x', app: { workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'] }, payroll: { ...payrollSettingsService.getDefaults(), workingDaysBasis: 'actual' } });
    expect((await calc() as any).data.lop_deduction).toBe(1227); // 27000 / 22 = 1227.27
  });

  it('an invalid saved divisor stops the calculation instead of producing ₹0 deductions', async () => {
    mockData({ absentDays: 1, lopDays: 1 });
    for (const bad of [{ workingDaysBasis: 'configured', configuredWorkingDays: 0 }, { workingDaysBasis: 'unknown' }]) {
      settings(bad);
      const res: any = await calc();
      expect(res.data).toBeNull();
      expect(res.error?.message).toMatch('daily-rate divisor is not configured correctly');
    }
  });
});
