/**
 * Monthly and Scoped Shift Roster Rules (pure, unit-tested).
 *
 * Implements shift assignment consistency across:
 * 1. Selected date only ('DATE')
 * 2. Selected week ('WEEK', Monday to Sunday)
 * 3. Entire month ('MONTH', 1st to last day of the calendar month)
 *
 * Rules:
 * - Strictly respects calendar boundaries (never touches previous or future months outside scope).
 * - Preserves existing weekly offs (e.g. Sundays, company configured weekly offs, or roster week offs).
 * - Preserves company public holidays.
 * - Preserves approved employee leaves.
 * - Preserves explicitly configured date-specific shift exceptions when preserveExceptions is true.
 * - Prevents duplicate assignments.
 */

import { weekRange, monthRange } from './rosterDates';
import type { RosterCell } from './rosterRules';

export type AssignmentScope = 'DATE' | 'WEEK' | 'MONTH';

const isDate = (d: unknown): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);
const noon = (d: string) => new Date(`${d}T12:00:00Z`);

/** Day name in English ('Monday', 'Tuesday', ..., 'Sunday') from YYYY-MM-DD */
export function getWeekdayName(dateStr: string): string {
  if (!isDate(dateStr)) return '';
  return noon(dateStr).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
}

/** Check if a date is a weekly off day */
export function isWeeklyOffDay(dateStr: string, weeklyOffDays?: string[] | null): boolean {
  const configured = (weeklyOffDays && weeklyOffDays.length > 0)
    ? weeklyOffDays.map(d => String(d).trim().toLowerCase())
    : ['sunday']; // standard default fallback
  const dayName = getWeekdayName(dateStr).toLowerCase();
  return configured.includes(dayName);
}

export interface ScopedDatesResolutionInput {
  targetDate: string; // YYYY-MM-DD
  scope: AssignmentScope;
  cell: RosterCell;
  preserveExceptions?: boolean;
  weeklyOffDays?: string[] | null;
  holidays?: string[]; // array of YYYY-MM-DD
  approvedLeaves?: { start_date: string; end_date: string }[];
  existingAssignments?: Record<string, { shift?: string | null; shiftTemplateId?: string | null; day_type?: string; dayType?: string; is_exception?: boolean }>;
  baseShiftId?: string | null;
}

export interface ScopedDatesResolutionResult {
  scope: AssignmentScope;
  targetDate: string;
  scopeRange: { start: string; end: string };
  datesToUpdate: string[];
  skippedDates: { date: string; reason: 'WEEK_OFF' | 'HOLIDAY' | 'LEAVE' | 'EXCEPTION' }[];
}

/**
 * Returns all dates covered by the scope.
 * - 'DATE': [targetDate]
 * - 'WEEK': 7 days of the Monday-to-Sunday week containing targetDate
 * - 'MONTH': all dates from 1st to last day of the calendar month containing targetDate
 */
export function getScopeDates(targetDate: string, scope: AssignmentScope): { start: string; end: string; dates: string[] } {
  if (!isDate(targetDate)) {
    throw new Error(`Invalid targetDate: ${targetDate}`);
  }

  if (scope === 'DATE') {
    return { start: targetDate, end: targetDate, dates: [targetDate] };
  }

  if (scope === 'WEEK') {
    const wr = weekRange(targetDate);
    return { start: wr.start, end: wr.end, dates: [...wr.dates] };
  }

  // scope === 'MONTH'
  const mr = monthRange(targetDate);
  const year = mr.year;
  const month = mr.month;
  const daysInMonth = mr.daysInMonth;

  const dates: string[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    dates.push(`${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  }

  return { start: mr.start, end: mr.end, dates };
}

/**
 * Resolves exactly which dates should receive the new shift assignment.
 * Filters out weekly offs, holidays, leaves, and intentional exceptions.
 */
export function resolveScopedAssignmentDates(input: ScopedDatesResolutionInput): ScopedDatesResolutionResult {
  const {
    targetDate,
    scope,
    cell,
    preserveExceptions = true,
    weeklyOffDays,
    holidays = [],
    approvedLeaves = [],
    existingAssignments = {},
    baseShiftId,
  } = input;

  const { start, end, dates: candidateDates } = getScopeDates(targetDate, scope);

  const holidaySet = new Set((holidays || []).map(h => String(h).slice(0, 10)));
  const datesToUpdate: string[] = [];
  const skippedDates: { date: string; reason: 'WEEK_OFF' | 'HOLIDAY' | 'LEAVE' | 'EXCEPTION' }[] = [];

  // For single-date scope, admin explicitly clicked this date and chose to update it
  if (scope === 'DATE') {
    return {
      scope,
      targetDate,
      scopeRange: { start, end },
      datesToUpdate: [targetDate],
      skippedDates: [],
    };
  }

  for (const d of candidateDates) {
    // 1. Weekly Off preservation
    // If the admin is assigning a WORK shift, preserve weekly offs
    const existing = existingAssignments[d];
    const isRosterWeekOff = String(existing?.day_type || existing?.dayType || '').toUpperCase() === 'WEEK_OFF';
    const isCompanyWeeklyOff = isWeeklyOffDay(d, weeklyOffDays);

    if (cell.dayType === 'WORK' && (isCompanyWeeklyOff || isRosterWeekOff)) {
      skippedDates.push({ date: d, reason: 'WEEK_OFF' });
      continue;
    }

    // 2. Company Holiday preservation
    if (holidaySet.has(d)) {
      skippedDates.push({ date: d, reason: 'HOLIDAY' });
      continue;
    }

    // 3. Approved Leave preservation
    const onLeave = approvedLeaves.some(l => {
      const ls = String(l.start_date).slice(0, 10);
      const le = String(l.end_date).slice(0, 10);
      return ls <= d && le >= d;
    });
    if (onLeave) {
      skippedDates.push({ date: d, reason: 'LEAVE' });
      continue;
    }

    // 4. Intentional Date-Specific Exception preservation
    // If the date is not the anchor date, already has an assignment, and differs from the base shift
    if (preserveExceptions && d !== targetDate && existing) {
      const existingShiftId = existing.shiftTemplateId || existing.shift || null;
      const isExplicitException = existing.is_exception === true;
      // If marked as explicit exception, or if it has a custom shift distinct from baseShiftId
      if (isExplicitException || (baseShiftId && existingShiftId && existingShiftId !== baseShiftId && existingShiftId !== cell.shiftTemplateId)) {
        skippedDates.push({ date: d, reason: 'EXCEPTION' });
        continue;
      }
    }

    datesToUpdate.push(d);
  }

  return {
    scope,
    targetDate,
    scopeRange: { start, end },
    datesToUpdate,
    skippedDates,
  };
}
