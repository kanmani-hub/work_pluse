import { supabase } from '../../lib/supabase';
import { notificationService } from '../notifications/notificationService';
import { shiftTimingChanged } from '../notifications/notificationRules';
import { companyDateStr } from '../../utils/companyDate';
import { countAssignedEmployeesByShift } from './shiftAssignmentRules';

export const shiftService = {
  async getShifts() {
    const { data, error } = await supabase
      .from('shift_templates')
      .select('*, shift_assignments(id)')
      .order('created_at', { ascending: false });
    if (error) return { data: null, error };
    return { data, error: null };
  },

  /**
   * Employees currently assigned per shift template (see shiftAssignmentRules for the rule).
   * Returns error instead of zeros when either read fails.
   */
  async getCurrentAssignmentCounts(today: string = companyDateStr()): Promise<{ counts: Record<string, number> | null; error: any }> {
    const [assignRes, empRes] = await Promise.all([
      (supabase.from('shift_assignments') as any)
        .select('employee_id, shift_template_id, effective_date, end_date')
        .lte('effective_date', today),
      (supabase.from('employees') as any).select('id, status'),
    ]);
    if (assignRes.error || empRes.error) return { counts: null, error: assignRes.error || empRes.error };
    return { counts: countAssignedEmployeesByShift(assignRes.data || [], empRes.data || [], today), error: null };
  },

  async createShift(shiftData: any) {
    // @ts-ignore
    const { data, error } = await (supabase.from('shift_templates') as any)
      .insert(shiftData)
      .select()
      .single();
    if (error) return { data: null, error };
    import('../audit/auditService').then(({ auditService }) => {
      auditService.recordAuditLog({
        action: 'SHIFT_CREATED',
        module: 'SETUP',
        entity_type: 'shift_templates',
        entity_id: data.id,
        description: `Created shift: ${shiftData.name}`
      }).catch(e => console.error('[AUDIT]', e));
    });
    return { data, error: null };
  },

  async updateShift(shiftId: string, shiftData: any) {
    const { data: before } = await (supabase.from('shift_templates') as any)
      .select('start_time, end_time').eq('id', shiftId).maybeSingle();
    // @ts-ignore
    const { data, error } = await (supabase.from('shift_templates') as any)
      .update(shiftData)
      .eq('id', shiftId)
      .select()
      .single();
    if (error) return { data: null, error };

    // Timing changed → notify only employees whose CURRENT shift is this one
    if (before && data && (before.start_time !== data.start_time || before.end_time !== data.end_time)) {
      const today = companyDateStr();
      const { data: rows } = await (supabase.from('shift_assignments') as any)
        .select('employee_id, shift_template_id, effective_date')
        .lte('effective_date', today)
        .order('effective_date', { ascending: false });
      // Each employee's current assignment = the latest effective_date on or before today
      const latest = new Map<string, { date: string; sid: string }>();
      for (const r of (rows || []) as any[]) {
        const cur = latest.get(r.employee_id);
        if (!cur || r.effective_date > cur.date) latest.set(r.employee_id, { date: r.effective_date, sid: r.shift_template_id });
      }
      const affected = [...latest.entries()].filter(([, v]) => v.sid === shiftId).map(([emp]) => emp);
      const n = shiftTimingChanged({ shiftId, shiftName: data.name, start: data.start_time, end: data.end_time });
      for (const emp of affected) await notificationService.notifyEmployee(emp, n);
    }
    import('../audit/auditService').then(({ auditService }) => {
      auditService.recordAuditLog({
        action: 'SHIFT_UPDATED',
        module: 'SETUP',
        entity_type: 'shift_templates',
        entity_id: shiftId,
        description: `Updated shift: ${shiftData.name || shiftId}`
      }).catch(e => console.error('[AUDIT]', e));
    });
    return { data, error: null };
  },

  async deactivateShift(shiftId: string) {
    // @ts-ignore
    const { error } = await (supabase.from('shift_templates') as any)
      .update({ is_active: false })
      .eq('id', shiftId);
    if (!error) {
      import('../audit/auditService').then(({ auditService }) => {
        auditService.recordAuditLog({
          action: 'SHIFT_DELETED',
          module: 'SETUP',
          entity_type: 'shift_templates',
          entity_id: shiftId,
          description: `Deactivated shift ID: ${shiftId}`
        }).catch(e => console.error('[AUDIT]', e));
      });
    }
    return { error };
  },

  async activateShift(shiftId: string) {
    // @ts-ignore
    const { error } = await (supabase.from('shift_templates') as any)
      .update({ is_active: true })
      .eq('id', shiftId);
    return { error };
  },

  async checkShiftDependencies(shiftId: string) {
    const { count: activeAssignments, error: assignErr } = await supabase
      .from('shift_assignments')
      .select('*', { count: 'exact', head: true })
      .eq('shift_template_id', shiftId);
    
    const { count: rosterAssignments, error: rosterErr } = await supabase
      .from('roster_assignments')
      .select('*', { count: 'exact', head: true })
      .eq('shift_template_id', shiftId);

    return {
      activeAssignments: (activeAssignments || 0) + (rosterAssignments || 0),
      error: assignErr || rosterErr
    };
  },

  async deleteShift(shiftId: string) {
    const deps = await this.checkShiftDependencies(shiftId);
    if (deps.error) return { success: false, error: deps.error.message };
    
    if (deps.activeAssignments > 0) {
      return { success: false, reason: 'ASSIGNMENTS_EXIST', assignmentCount: deps.activeAssignments };
    }

    const { error } = await supabase.from('shift_templates').delete().eq('id', shiftId);
    if (error) {
      if (error.code === '23503') { // foreign key violation
        return { success: false, reason: 'HISTORICAL_DEPENDENCY' };
      }
      return { success: false, error: error.message };
    }
    return { success: true };
  }
};
