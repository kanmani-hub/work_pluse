/**
 * Employee → My Attendance month cards (pure, unit-tested). Same counting as the page used
 * before, from the employee's OWN attendance history only (the page loads nothing else), so
 * each card and its detail rows reconcile.
 *  - Total Hours sums stored worked hours; a day without a clock-out adds nothing and is shown
 *    as "Not clocked out" — hours are never estimated.
 */
export type MyAttendanceCard = 'workingDays' | 'present' | 'late' | 'lateMinutes' | 'halfDay' | 'leave' | 'wfh' | 'totalHours';
export interface MyAttendanceCardData { count: number; rows: Record<string, any>[] }

const PRESENT = ['PRESENT', 'COMPLETED', 'WORKING', 'ON_BREAK', 'LATE', 'EARLY LOGOUT', 'HALF_DAY'];
const parseHours = (s: any) => { const m = String(s ?? '').match(/(\d+)h\s*(\d+)m/); return m ? parseInt(m[1]) * 60 + parseInt(m[2]) : 0; };

/** monthKey: 'YYYY-MM' of the month shown on the page. */
export function myAttendanceCards(history: any[], monthKey: string) {
  const month = (history || []).filter(r => String(r.rawDate || '').startsWith(monthKey));
  const row = (r: any) => ({
    __key: r.id, date: r.rawDate, shift: r.shift || '—', mode: r.mode || '—', clockIn: r.in || '--:--',
    clockOut: r.clock_out_at ? r.out : (r.clock_in_at ? 'Not clocked out' : '--:--'),
    hours: parseHours(r.hours) > 0 ? r.hours : (r.clock_in_at && !r.clock_out_at ? 'Not calculated (no clock-out)' : '—'),
    lateMinutes: r.lateMin || 0, status: r.status,
  });
  const pack = (f: (r: any) => boolean): MyAttendanceCardData => { const rows = month.filter(f).map(row); return { count: rows.length, rows }; };
  const late = pack(r => r.lateMin > 0);
  const hours = pack(r => parseHours(r.hours) > 0);
  const totalMinutes = month.reduce((s, r) => s + parseHours(r.hours), 0);
  const totalLateMinutes = month.reduce((s, r) => s + (r.lateMin > 0 ? r.lateMin : 0), 0);
  const cards: Record<MyAttendanceCard, MyAttendanceCardData> = {
    workingDays: pack(() => true),
    present: pack(r => PRESENT.includes(String(r.status || '').toUpperCase())),
    late,
    lateMinutes: late,
    halfDay: pack(r => r.originalStatus === 'HALF DAY' || !!r.is_half_day),
    leave: pack(r => r.originalStatus === 'LEAVE' || r.status === 'LEAVE'),
    wfh: pack(r => r.mode === 'WFH'),
    totalHours: hours,
  };
  return {
    cards,
    totalMinutes,
    totalLateMinutes,
    totalHoursLabel: `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m`,
  };
}
