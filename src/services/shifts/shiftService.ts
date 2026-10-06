import { supabase } from '../../lib/supabase';

export const shiftService = {
  async getShifts() {
    const { data, error } = await supabase
      .from('shift_templates')
      .select('*, shift_assignments(id)')
      .order('created_at', { ascending: false });
    if (error) return { data: null, error };
    return { data, error: null };
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
    // @ts-ignore
    const { data, error } = await (supabase.from('shift_templates') as any)
      .update(shiftData)
      .eq('id', shiftId)
      .select()
      .single();
    if (error) return { data: null, error };
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
