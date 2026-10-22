/**
 * Tracking Enforcement Service — client side of the automatic-break policy.
 *
 * The browser only REPORTS what it observes; every payroll-affecting decision (whether a break
 * starts, its start / end time, the attendance it belongs to, WFH and shift-end rules, the policy
 * switches and the grace period) is made by the database:
 *   report_tracking_event(event)  permission denied / GPS unavailable / timeout / network reconnected
 *   process_stale_tracking()      scheduled every minute (pg_cron) — no fresh location reached the server
 *   employee_live_locations trigger  a FRESH location ends a tracking break (automatic resume)
 * See supabase/migrations/20261021120000_automatic_break_tracking.sql and docs/AUTOMATIC_BREAKS.md.
 */
import { supabase } from '../../lib/supabase';
import { breakService } from '../attendance/breakService';
import type { TrackingEvent } from '../attendance/automaticBreakRules';

export interface TrackingEventResult {
  action: 'STARTED' | 'NONE' | 'ERROR';
  reason?: string;
  breakId?: string;
  state?: string;
}

export const trackingEnforcementService = {
  /** Report one device observation. Never throws; a failed report is returned as ERROR. */
  async reportEvent(event: TrackingEvent, opts: { message?: string | null; offlineSeconds?: number | null } = {}): Promise<TrackingEventResult> {
    try {
      const { data, error } = await (supabase as any).rpc('report_tracking_event', {
        p_event: event,
        p_message: opts.message ? String(opts.message).slice(0, 500) : null,
        p_offline_seconds: typeof opts.offlineSeconds === 'number' && Number.isFinite(opts.offlineSeconds) ? Math.max(0, Math.round(opts.offlineSeconds)) : null,
      });
      if (error) return { action: 'ERROR', reason: error.message };
      if (!data || typeof data !== 'object') return { action: 'ERROR', reason: 'NO_RESULT_FROM_SERVER' };
      return {
        action: data.action === 'STARTED' ? 'STARTED' : 'NONE',
        reason: data.reason ?? undefined,
        breakId: data.break_id ?? undefined,
        state: data.state ?? undefined,
      };
    } catch (e: any) {
      return { action: 'ERROR', reason: e?.message || String(e) };
    }
  },

  /** The signed-in employee's server tracking state (RLS: own row only), or null. */
  async getMyTrackingState(employeeId: string): Promise<{ data: any | null; error: Error | null }> {
    const { data, error } = await (supabase.from('employee_tracking_state') as any)
      .select('state, state_since, attendance_id, last_fresh_fix_at, last_problem, last_problem_at, open_auto_break_id')
      .eq('employee_id', employeeId)
      .maybeSingle();
    if (error) return { data: null, error: new Error(error.message) };
    return { data: data ?? null, error: null };
  },

  /**
   * Admin / HR fallback when the database has no pg_cron schedule: run the same idempotent evaluation
   * the scheduler runs. Safe to call repeatedly (server time, row locks, one open break per attendance).
   */
  async runStaleEvaluation(): Promise<{ data: any | null; error: Error | null }> {
    try {
      const { data, error } = await (supabase as any).rpc('process_stale_tracking');
      if (error) return { data: null, error: new Error(error.message) };
      return { data, error: null };
    } catch (e: any) {
      return { data: null, error: e instanceof Error ? e : new Error(String(e)) };
    }
  },

  /** Correct an erroneous automatic break (Admin / HR; audited, server-checked). */
  async correctIncidentBreak(params: { breakId: string; attendanceId: string; reason: string }) {
    return breakService.correctTrackingEnforcementBreak({
      breakId: params.breakId,
      attendanceId: params.attendanceId,
      correctionReason: params.reason,
    });
  },
};
