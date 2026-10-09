/**
 * Shift Roster persistence (rosters / roster_assignments).
 * Requires docs/proposals/PROPOSED_roster_persistence.sql to be applied (day_type, work_mode,
 * unique day key, ADMIN write policies). Every failure is returned — nothing is silently skipped.
 */
import { supabase } from '../../lib/supabase';
import { salaryService } from '../payroll/salaryService';
import { auditService } from '../audit/auditService';
import { LOCKED_PAYROLL_STATUSES } from '../payroll/payrollRules';
import { assignmentRow, dateInPeriodError, editError, monthsInRange, overlapError, periodError, publishError, unpublishError } from './rosterRules';
import type { RosterCell } from './rosterRules';

const err = (what: string, e: any) => new Error(`${what}: ${e?.message || e}`);
const db = () => supabase as any;

export const rosterService = {
  /** Rosters (not archived) overlapping the range, with their assignments inside the range. */
  async getRosters(start: string, end: string): Promise<{ rosters: any[]; assignments: any[]; error: Error | null }> {
    const { data: rosters, error } = await db().from('rosters').select('*')
      .neq('status', 'ARCHIVED').lte('start_date', end).gte('end_date', start);
    if (error || !Array.isArray(rosters)) return { rosters: [], assignments: [], error: err('Rosters could not be loaded', error || 'no data') };
    if (rosters.length === 0) return { rosters: [], assignments: [], error: null };
    const { data: assignments, error: aErr } = await db().from('roster_assignments').select('*')
      .in('roster_id', rosters.map((r: any) => r.id)).gte('assignment_date', start).lte('assignment_date', end);
    if (aErr || !Array.isArray(assignments)) return { rosters, assignments: [], error: err('Roster entries could not be loaded', aErr || 'no data') };
    return { rosters, assignments, error: null };
  },

  /** The roster for exactly this period (DRAFT or PUBLISHED), or null. */
  async getPeriodRoster(start: string, end: string): Promise<{ roster: any | null; error: Error | null }> {
    const { data, error } = await db().from('rosters').select('*')
      .eq('start_date', start).eq('end_date', end).neq('status', 'ARCHIVED').maybeSingle();
    if (error) return { roster: null, error: err('Roster could not be loaded', error) };
    return { roster: data || null, error: null };
  },

  /** Save one cell (WORK with shift + mode, or WEEK_OFF) into the period's DRAFT roster (created if missing). */
  async saveCell(start: string, end: string, employeeId: string, date: string, cell: RosterCell): Promise<{ data: any; error: Error | null }> {
    const pErr = periodError(start, end);
    if (pErr) return { data: null, error: new Error(pErr) };
    const dateErr = dateInPeriodError(date, start, end);
    if (dateErr) return { data: null, error: new Error(dateErr) };
    const adminId = await salaryService.getCurrentEmployeeId();
    if (!adminId) return { data: null, error: new Error('Unauthorized') };

    let { roster, error } = await this.getPeriodRoster(start, end);
    if (error) return { data: null, error };
    if (!roster) {
      // Never create a second active roster over the same days (the proposed migration also enforces this)
      const ov = await db().from('rosters').select('id, start_date, end_date, status')
        .neq('status', 'ARCHIVED').lte('start_date', end).gte('end_date', start);
      if (ov.error) return { data: null, error: err('Existing rosters could not be checked', ov.error) };
      const oErr = overlapError(ov.data || [], start, end);
      if (oErr) return { data: null, error: new Error(oErr) };
      const created = await db().from('rosters')
        .insert({ name: `Roster ${start} to ${end}`, start_date: start, end_date: end, status: 'DRAFT', created_by: adminId })
        .select().single();
      if (created.error || !created.data) return { data: null, error: err('Roster could not be created', created.error || 'no data') };
      roster = created.data;
    }
    const locked = editError(roster.status);
    if (locked) return { data: null, error: new Error(locked) };

    const saved = await db().from('roster_assignments')
      .upsert(assignmentRow(roster.id, employeeId, date, cell), { onConflict: 'roster_id,employee_id,assignment_date' })
      .select().single();
    if (saved.error || !saved.data) return { data: null, error: err('Roster entry could not be saved', saved.error || 'no data') };
    return { data: { roster, assignment: saved.data }, error: null };
  },

  /** DRAFT → PUBLISHED (records who and when). Refused if another published roster overlaps. */
  async publish(rosterId: string): Promise<{ data: any; error: Error | null }> {
    const adminId = await salaryService.getCurrentEmployeeId();
    if (!adminId) return { data: null, error: new Error('Unauthorized') };
    const { data: roster, error } = await db().from('rosters').select('*').eq('id', rosterId).maybeSingle();
    if (error) return { data: null, error: err('Roster could not be loaded', error) };
    const count = await db().from('roster_assignments').select('id', { count: 'exact', head: true }).eq('roster_id', rosterId);
    if (count.error) return { data: null, error: err('Roster entries could not be counted', count.error) };
    let overlapping = 0;
    if (roster) {
      const ov = await db().from('rosters').select('id').eq('status', 'PUBLISHED')
        .lte('start_date', roster.end_date).gte('end_date', roster.start_date).neq('id', rosterId);
      if (ov.error) return { data: null, error: err('Published rosters could not be checked', ov.error) };
      overlapping = (ov.data || []).length;
    }
    const pErr = publishError(roster, count.count ?? 0, overlapping);
    if (pErr) return { data: null, error: new Error(pErr) };

    const upd = await db().from('rosters')
      .update({ status: 'PUBLISHED', published_at: new Date().toISOString(), published_by: adminId })
      .eq('id', rosterId).eq('status', 'DRAFT').select('*');
    if (upd.error) return { data: null, error: err('Roster could not be published', upd.error) };
    if (!upd.data || upd.data.length === 0) return { data: null, error: new Error('Roster status was already changed. Please refresh.') };
    await auditService.recordAuditLog({
      action: 'ROSTER_PUBLISHED', module: 'SETUP', entity_type: 'rosters', entity_id: rosterId,
      description: `Published roster ${roster.start_date} to ${roster.end_date}`, new_values: { status: 'PUBLISHED' },
    }).catch((e: any) => console.error('[AUDIT]', e));
    return { data: upd.data[0], error: null };
  },

  /** PUBLISHED → DRAFT, unless payroll for any month it covers is already approved / paid. */
  async unpublish(rosterId: string): Promise<{ data: any; error: Error | null }> {
    const adminId = await salaryService.getCurrentEmployeeId();
    if (!adminId) return { data: null, error: new Error('Unauthorized') };
    const { data: roster, error } = await db().from('rosters').select('*').eq('id', rosterId).maybeSingle();
    if (error) return { data: null, error: err('Roster could not be loaded', error) };
    let locked = 0;
    if (roster) {
      for (const { year, month } of monthsInRange(String(roster.start_date).slice(0, 10), String(roster.end_date).slice(0, 10))) {
        const q = await db().from('payroll').select('id', { count: 'exact', head: true })
          .eq('payroll_year', year).eq('payroll_month', month).in('status', LOCKED_PAYROLL_STATUSES);
        if (q.error) return { data: null, error: err('Payroll status could not be checked', q.error) };
        locked += q.count ?? 0;
      }
    }
    const uErr = unpublishError(roster, locked);
    if (uErr) return { data: null, error: new Error(uErr) };

    const upd = await db().from('rosters')
      .update({ status: 'DRAFT', published_at: null, published_by: null })
      .eq('id', rosterId).eq('status', 'PUBLISHED').select('*');
    if (upd.error) return { data: null, error: err('Roster could not be unpublished', upd.error) };
    if (!upd.data || upd.data.length === 0) return { data: null, error: new Error('Roster status was already changed. Please refresh.') };
    await auditService.recordAuditLog({
      action: 'ROSTER_UNPUBLISHED', module: 'SETUP', entity_type: 'rosters', entity_id: rosterId,
      description: `Unpublished roster ${roster.start_date} to ${roster.end_date}`, new_values: { status: 'DRAFT' },
    }).catch((e: any) => console.error('[AUDIT]', e));
    return { data: upd.data[0], error: null };
  },
};
