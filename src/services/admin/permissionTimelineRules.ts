/** Admin → Permission timeline: pure helpers (company timezone, unit-tested). */
import { COMPANY_TIMEZONE } from '../../utils/companyDate';

export function shiftDateStr(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** "09 Oct 2026" for a YYYY-MM-DD company date. */
export function formatCompanyDateLabel(date: string, timeZone = COMPANY_TIMEZONE): string {
  const d = new Date(`${date}T12:00:00+05:30`);
  if (isNaN(d.getTime())) return date;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone });
}

/** Requests whose permission_date is the given date, ordered by start time. */
export function permissionsOnDate<T extends { dateISO?: string | null; startRaw?: string | null }>(requests: T[], date: string): T[] {
  return (requests || [])
    .filter(r => String(r.dateISO || '').slice(0, 10) === date)
    .sort((a, b) => String(a.startRaw || '').localeCompare(String(b.startRaw || '')));
}
