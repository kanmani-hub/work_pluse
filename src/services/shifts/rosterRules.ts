/**
 * Shift Roster rules (pure, unit-tested).
 *
 * A roster covers one period (the week shown on the Shift Roster page). Each cell is saved as a
 * roster_assignments row: WORK (with a shift and work mode) or WEEK_OFF (the employee's weekly off
 * for that date). Only a DRAFT roster can be edited; publishing makes it the schedule payroll uses.
 * Requires docs/proposals/PROPOSED_roster_persistence.sql (day_type / work_mode columns, ADMIN write policies).
 */

import { isRosterWeek, rangesOverlap } from './rosterDates';

export type RosterDayType = 'WORK' | 'WEEK_OFF';
export type RosterWorkMode = 'OFFICE' | 'WFH';
export type RosterStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';

export interface RosterCell {
  dayType: RosterDayType;
  shiftTemplateId: string | null;
  workMode: RosterWorkMode;
}

const isDate = (d: unknown): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);

/** Form values from the Assign Shift modal ("Office" / "WFH" / "Week Off") → the row to store. */
export function cellFromForm(mode: string, shiftTemplateId: string | null | undefined): RosterCell | { error: string } {
  const m = String(mode || '').trim().toUpperCase();
  if (m === 'WEEK OFF') return { dayType: 'WEEK_OFF', shiftTemplateId: null, workMode: 'OFFICE' };
  if (m !== 'OFFICE' && m !== 'WFH') return { error: 'Choose Office, WFH or Week Off.' };
  if (!shiftTemplateId) return { error: 'Choose a shift for a working day.' };
  return { dayType: 'WORK', shiftTemplateId, workMode: m as RosterWorkMode };
}

/** Stored row → what the roster grid shows. */
export function cellFromAssignment(row: any): { shift: string | null; mode: 'Office' | 'WFH'; type?: 'Week Off'; rostered: true } {
  if (String(row?.day_type || 'WORK').toUpperCase() === 'WEEK_OFF') return { shift: null, mode: 'Office', type: 'Week Off', rostered: true };
  return { shift: row?.shift_template_id ?? null, mode: String(row?.work_mode || '').toUpperCase() === 'WFH' ? 'WFH' : 'Office', rostered: true };
}

export function assignmentRow(rosterId: string, employeeId: string, date: string, cell: RosterCell) {
  return {
    roster_id: rosterId,
    employee_id: employeeId,
    assignment_date: date,
    day_type: cell.dayType,
    shift_template_id: cell.dayType === 'WORK' ? cell.shiftTemplateId : null,
    work_mode: cell.workMode,
  };
}

/** Only a DRAFT roster may be edited (a published roster drives payroll). */
export function editError(status: string | null | undefined): string | null {
  if (!status || status === 'DRAFT') return null;
  if (status === 'PUBLISHED') return 'This roster is published. Unpublish it before making changes.';
  return `This roster is ${String(status).toLowerCase()} and cannot be changed.`;
}

export function dateInPeriodError(date: string, start: string, end: string): string | null {
  if (!isDate(date) || !isDate(start) || !isDate(end)) return 'Invalid roster date.';
  return date < start || date > end ? `The date ${date} is outside this roster (${start} to ${end}).` : null;
}

export function publishError(roster: { status?: string | null } | null, assignmentCount: number, overlappingPublished: number): string | null {
  if (!roster) return 'Save at least one roster entry before publishing.';
  if (roster.status === 'PUBLISHED') return 'This roster is already published.';
  if (roster.status !== 'DRAFT') return `A ${String(roster.status).toLowerCase()} roster cannot be published.`;
  if (assignmentCount <= 0) return 'Save at least one roster entry before publishing.';
  if (overlappingPublished > 0) return 'Another published roster already covers some of these dates. Unpublish it first.';
  return null;
}

export function unpublishError(roster: { status?: string | null } | null, lockedPayrolls: number): string | null {
  if (!roster) return 'Roster not found.';
  if (roster.status !== 'PUBLISHED') return 'Only a published roster can be unpublished.';
  if (lockedPayrolls > 0) return 'Payroll for this period is already approved or paid, so its roster cannot be changed.';
  return null;
}

/** A roster period must be exactly one Monday → Sunday week (keeps periods consistent and non-overlapping). */
export function periodError(start: string, end: string): string | null {
  return isRosterWeek(start, end) ? null : `A roster must cover one Monday-to-Sunday week (got ${start} to ${end}).`;
}

/** Another active (non-archived) roster already covers some of these dates. */
export function overlapError(existing: { id?: string; start_date: string; end_date: string; status?: string | null }[], start: string, end: string, selfId?: string | null): string | null {
  const clash = (existing || []).find(r => r.id !== selfId && r.status !== 'ARCHIVED'
    && rangesOverlap(String(r.start_date).slice(0, 10), String(r.end_date).slice(0, 10), start, end));
  return clash ? `Another roster (${String(clash.start_date).slice(0, 10)} to ${String(clash.end_date).slice(0, 10)}) already covers some of these dates.` : null;
}

/** Calendar months touched by a date range (for the locked-payroll check). */
export function monthsInRange(start: string, end: string): { year: number; month: number }[] {
  const out: { year: number; month: number }[] = [];
  if (!isDate(start) || !isDate(end) || end < start) return out;
  let y = Number(start.slice(0, 4)); let m = Number(start.slice(5, 7));
  const ey = Number(end.slice(0, 4)); const em = Number(end.slice(5, 7));
  while (y < ey || (y === ey && m <= em)) { out.push({ year: y, month: m }); m++; if (m > 12) { m = 1; y++; } }
  return out;
}
