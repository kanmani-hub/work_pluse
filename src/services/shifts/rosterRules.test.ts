import { describe, it, expect } from 'vitest';
import { cellFromForm, cellFromAssignment, assignmentRow, editError, dateInPeriodError, publishError, unpublishError, monthsInRange, periodError, overlapError } from './rosterRules';

describe('roster cells (synthetic)', () => {
  it('Office / WFH need a shift and are WORK days; Week Off has no shift', () => {
    expect(cellFromForm('Office', 's1')).toEqual({ dayType: 'WORK', shiftTemplateId: 's1', workMode: 'OFFICE' });
    expect(cellFromForm('WFH', 's1')).toEqual({ dayType: 'WORK', shiftTemplateId: 's1', workMode: 'WFH' });
    expect(cellFromForm('Week Off', 's1')).toEqual({ dayType: 'WEEK_OFF', shiftTemplateId: null, workMode: 'OFFICE' });
    expect(cellFromForm('Office', '')).toEqual({ error: 'Choose a shift for a working day.' });
    expect(cellFromForm('Holiday', 's1')).toEqual({ error: 'Choose Office, WFH or Week Off.' });
  });

  it('the stored row matches the proposed schema (day_type, work_mode, no shift on a week off)', () => {
    expect(assignmentRow('r1', 'e1', '2026-10-12', { dayType: 'WORK', shiftTemplateId: 's1', workMode: 'WFH' }))
      .toEqual({ roster_id: 'r1', employee_id: 'e1', assignment_date: '2026-10-12', day_type: 'WORK', shift_template_id: 's1', work_mode: 'WFH' });
    expect(assignmentRow('r1', 'e1', '2026-10-13', { dayType: 'WEEK_OFF', shiftTemplateId: 's1', workMode: 'OFFICE' }).shift_template_id).toBeNull();
  });

  it('a stored row is shown as a shift with its mode, or as Week Off', () => {
    expect(cellFromAssignment({ day_type: 'WORK', shift_template_id: 's1', work_mode: 'WFH' })).toEqual({ shift: 's1', mode: 'WFH', rostered: true });
    expect(cellFromAssignment({ day_type: 'WEEK_OFF', shift_template_id: null })).toEqual({ shift: null, mode: 'Office', type: 'Week Off', rostered: true });
    expect(cellFromAssignment({ shift_template_id: 's2' })).toEqual({ shift: 's2', mode: 'Office', rostered: true });
  });
});

describe('roster status rules', () => {
  it('only a DRAFT (or not yet created) roster can be edited', () => {
    expect(editError(undefined)).toBeNull();
    expect(editError('DRAFT')).toBeNull();
    expect(editError('PUBLISHED')).toBe('This roster is published. Unpublish it before making changes.');
    expect(editError('ARCHIVED')).toBe('This roster is archived and cannot be changed.');
  });

  it('entries must fall inside the roster week', () => {
    expect(dateInPeriodError('2026-10-14', '2026-10-12', '2026-10-18')).toBeNull();
    expect(dateInPeriodError('2026-10-19', '2026-10-12', '2026-10-18')).toBe('The date 2026-10-19 is outside this roster (2026-10-12 to 2026-10-18).');
    expect(dateInPeriodError('bad', '2026-10-12', '2026-10-18')).toBe('Invalid roster date.');
  });

  it('publish: DRAFT with entries and no overlapping published roster', () => {
    expect(publishError({ status: 'DRAFT' }, 3, 0)).toBeNull();
    expect(publishError(null, 0, 0)).toBe('Save at least one roster entry before publishing.');
    expect(publishError({ status: 'DRAFT' }, 0, 0)).toBe('Save at least one roster entry before publishing.');
    expect(publishError({ status: 'PUBLISHED' }, 3, 0)).toBe('This roster is already published.');
    expect(publishError({ status: 'DRAFT' }, 3, 1)).toBe('Another published roster already covers some of these dates. Unpublish it first.');
  });

  it('unpublish: only PUBLISHED, and never once payroll for the period is approved or paid', () => {
    expect(unpublishError({ status: 'PUBLISHED' }, 0)).toBeNull();
    expect(unpublishError({ status: 'DRAFT' }, 0)).toBe('Only a published roster can be unpublished.');
    expect(unpublishError({ status: 'PUBLISHED' }, 1)).toBe('Payroll for this period is already approved or paid, so its roster cannot be changed.');
    expect(unpublishError(null, 0)).toBe('Roster not found.');
  });

  it('months touched by a roster week', () => {
    expect(monthsInRange('2026-09-28', '2026-10-04')).toEqual([{ year: 2026, month: 9 }, { year: 2026, month: 10 }]);
    expect(monthsInRange('2026-12-28', '2027-01-03')).toEqual([{ year: 2026, month: 12 }, { year: 2027, month: 1 }]);
    expect(monthsInRange('2026-10-12', '2026-10-18')).toEqual([{ year: 2026, month: 10 }]);
  });
});

describe('roster periods (2026-10-10 date fix)', () => {
  it('a roster period must be one Monday → Sunday week', () => {
    expect(periodError('2026-10-05', '2026-10-11')).toBeNull();
    expect(periodError('2026-10-04', '2026-10-10')).toBe('A roster must cover one Monday-to-Sunday week (got 2026-10-04 to 2026-10-10).');
  });

  it('an overlapping active roster is reported; archived rosters and the roster itself are ignored', () => {
    const existing = [
      { id: 'a', start_date: '2026-10-05', end_date: '2026-10-11', status: 'DRAFT' },
      { id: 'b', start_date: '2026-10-12', end_date: '2026-10-18', status: 'ARCHIVED' },
    ];
    expect(overlapError(existing, '2026-10-04', '2026-10-10')).toBe('Another roster (2026-10-05 to 2026-10-11) already covers some of these dates.');
    expect(overlapError(existing, '2026-10-12', '2026-10-18')).toBeNull();
    expect(overlapError(existing, '2026-10-05', '2026-10-11', 'a')).toBeNull();
    expect(overlapError([], '2026-10-05', '2026-10-11')).toBeNull();
  });
});

describe('payload matches the database constraints in PROPOSED_roster_persistence.sql (revision 3)', () => {
  // day_type IN ('WORK','WEEK_OFF'); work_mode IN ('OFFICE','WFH');
  // (day_type = 'WORK' AND shift_template_id IS NOT NULL) OR (day_type = 'WEEK_OFF' AND shift_template_id IS NULL)
  const satisfies = (row: any) =>
    ['WORK', 'WEEK_OFF'].includes(row.day_type) && ['OFFICE', 'WFH'].includes(row.work_mode)
    && ((row.day_type === 'WORK' && !!row.shift_template_id) || (row.day_type === 'WEEK_OFF' && row.shift_template_id === null));
  it('Office, WFH and Week Off rows all satisfy the constraints and carry the upsert key', () => {
    for (const mode of ['Office', 'WFH', 'Week Off']) {
      const cell: any = cellFromForm(mode, mode === 'Week Off' ? null : 's1');
      expect('error' in cell).toBe(false);
      const row = assignmentRow('r1', 'e1', '2026-10-10', cell);
      expect(satisfies(row)).toBe(true);
      expect(row).toMatchObject({ roster_id: 'r1', employee_id: 'e1', assignment_date: '2026-10-10' });
    }
  });

  it('Week Off saves without a shift; WORK entries strictly require a shift', () => {
    // Week Off ignores shift and always yields shiftTemplateId: null
    expect(cellFromForm('Week Off', null)).toEqual({ dayType: 'WEEK_OFF', shiftTemplateId: null, workMode: 'OFFICE' });
    expect(cellFromForm('Week Off', undefined)).toEqual({ dayType: 'WEEK_OFF', shiftTemplateId: null, workMode: 'OFFICE' });
    expect(cellFromForm('Week Off', '')).toEqual({ dayType: 'WEEK_OFF', shiftTemplateId: null, workMode: 'OFFICE' });
    expect(cellFromForm('Week Off', 'ignored_shift')).toEqual({ dayType: 'WEEK_OFF', shiftTemplateId: null, workMode: 'OFFICE' });

    // WORK entries (Office and WFH) fail without a shift
    expect(cellFromForm('Office', null)).toEqual({ error: 'Choose a shift for a working day.' });
    expect(cellFromForm('Office', undefined)).toEqual({ error: 'Choose a shift for a working day.' });
    expect(cellFromForm('Office', '')).toEqual({ error: 'Choose a shift for a working day.' });
    expect(cellFromForm('WFH', null)).toEqual({ error: 'Choose a shift for a working day.' });
    expect(cellFromForm('WFH', undefined)).toEqual({ error: 'Choose a shift for a working day.' });
    expect(cellFromForm('WFH', '')).toEqual({ error: 'Choose a shift for a working day.' });

    // WORK entries succeed with a valid shift
    expect(cellFromForm('Office', 'shift-123')).toEqual({ dayType: 'WORK', shiftTemplateId: 'shift-123', workMode: 'OFFICE' });
    expect(cellFromForm('WFH', 'shift-456')).toEqual({ dayType: 'WORK', shiftTemplateId: 'shift-456', workMode: 'WFH' });
  });
});

