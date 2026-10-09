/**
 * Roster calendar dates (pure, unit-tested).
 *
 * Every roster date is a plain company date string (YYYY-MM-DD). Arithmetic is done on the date
 * itself (UTC noon), never on the browser's local clock, and "today" is the company date
 * (Asia/Kolkata, see utils/companyDate). So a roster week is always Monday → Sunday whatever the
 * time of day or the browser's time zone, and Previous / Next always move by whole weeks.
 */
import { companyDateStr } from '../../utils/companyDate';

const isDate = (d: unknown): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);
const noon = (d: string) => new Date(`${d}T12:00:00Z`);

function assertDate(d: string): void {
  if (!isDate(d) || Number.isNaN(noon(d).getTime()) || noon(d).toISOString().slice(0, 10) !== d) {
    throw new Error(`Invalid date: ${d}`);
  }
}

/** Today's company date (Asia/Kolkata). */
export const rosterToday = (at: Date | number | string = new Date()): string => companyDateStr(at);

export function addDays(date: string, n: number): string {
  assertDate(date);
  const x = noon(date);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}

/** 0 = Monday … 6 = Sunday */
export function weekdayIndex(date: string): number {
  assertDate(date);
  return (noon(date).getUTCDay() + 6) % 7;
}

/** The roster week (Monday → Sunday) that contains the date. */
export function weekRange(date: string): { start: string; end: string; dates: string[] } {
  const start = addDays(date, -weekdayIndex(date));
  const dates = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  return { start, end: dates[6], dates };
}

export function monthRange(date: string): { start: string; end: string; year: number; month: number; daysInMonth: number; firstWeekdayIndex: number } {
  assertDate(date);
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7)); // 1–12
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const start = `${date.slice(0, 7)}-01`;
  return { start, end: `${date.slice(0, 7)}-${String(daysInMonth).padStart(2, '0')}`, year, month, daysInMonth, firstWeekdayIndex: weekdayIndex(start) };
}

/** Previous / Next: ±7 days in week view; first day of the previous / next month in month view. */
export function navigate(anchor: string, view: 'Week' | 'Month', direction: -1 | 1): string {
  if (view === 'Week') return addDays(anchor, 7 * direction);
  const { year, month } = monthRange(anchor);
  const d = new Date(Date.UTC(year, month - 1 + direction, 1, 12));
  return d.toISOString().slice(0, 10);
}

/** Display label for a date, independent of the browser's time zone (e.g. "Mon 12"). */
export function dayLabel(date: string, options: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric' }): string {
  assertDate(date);
  return noon(date).toLocaleDateString('en-US', { ...options, timeZone: 'UTC' });
}

/** True when start/end are exactly one Monday → Sunday roster week. */
export function isRosterWeek(start: string, end: string): boolean {
  if (!isDate(start) || !isDate(end)) return false;
  try { return weekdayIndex(start) === 0 && addDays(start, 6) === end; } catch { return false; }
}

/** Inclusive date ranges overlap. */
export const rangesOverlap = (aStart: string, aEnd: string, bStart: string, bEnd: string): boolean => aStart <= bEnd && bStart <= aEnd;
