/**
 * Tracking Enforcement Service
 * Coordinates detection of tracking problems, warning delivery, immediate automatic breaks,
 * recovery logging, and offline reconciliation according to policy requirements.
 */
import { supabase } from '../../lib/supabase';
import { breakService } from '../attendance/breakService';
import { notificationService } from '../notifications/notificationService';
import {
  evaluateTrackingEnforcement,
  isTrackingRecovered,
  validateServerTimestamp,
  type TrackingViolationType,
  type TrackingCondition,
  type EnforcementEvaluationResult,
} from './trackingEnforcementRules';
import {
  offlineWarningQueued,
  trackingRecoveredAdminAlert,
} from '../notifications/notificationRules';
import { logBreakAudit } from '../attendance/breakAudit';
import { companyDateStr } from '../../utils/companyDate';

export interface TrackingEnforcementResult {
  decision: EnforcementEvaluationResult;
  breakResult?: {
    action: 'STARTED' | 'NONE' | 'ERROR';
    breakId?: string;
    incidentId?: string;
    reason?: string;
    warningSent?: boolean;
    adminNotified?: boolean;
  };
}

export const trackingEnforcementService = {
  // In-memory record of the last known tracking state per employee for recovery detection
  _lastKnownStates: new Map<string, TrackingCondition>(),
  _offlineWarnings: new Map<string, { at: string; reason: string }>(),

  /**
   * Evaluate tracking status for an employee and trigger enforcement policy if a violation is confirmed.
   */
  async evaluateAndEnforce(params: {
    employeeId: string;
    geoStatus?: string | null;
    failureReason?: string | null;
    isOnline?: boolean;
    lastSeenAt?: string | null;
    serverReceivedAt?: string | null;
    deviceTimestamp?: number | null;
  }): Promise<TrackingEnforcementResult> {
    const serverNowMs = Date.now();
    const isOnline = params.isOnline ?? (typeof navigator !== 'undefined' ? navigator.onLine !== false : true);
    const today = companyDateStr(serverNowMs);
    const yesterday = companyDateStr(serverNowMs - 86400000);

    // 1. Fetch current attendance for this employee (today or yesterday)
    const { data: attendance } = await supabase
      .from('attendance')
      .select('id, clock_in_at, clock_out_at, status, attendance_date')
      .eq('employee_id', params.employeeId)
      .in('attendance_date', [today, yesterday])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle() as any;

    const isClockedIn = !!attendance?.clock_in_at;
    const isClockedOut = !!attendance?.clock_out_at;

    // 2. Check for active breaks
    let hasActiveBreak = attendance?.status === 'ON_BREAK';
    if (attendance?.id && !hasActiveBreak) {
      const { data: openBreaks } = await supabase
        .from('attendance_breaks')
        .select('id')
        .eq('attendance_id', attendance.id)
        .is('ended_at', null)
        .limit(1) as any;
      if (openBreaks && openBreaks.length > 0) hasActiveBreak = true;
    }

    // 3. Check for approved WFH today
    let isWfh = false;
    if (attendance?.id) {
      const { data: wfhData } = await supabase
        .from('wfh_requests')
        .select('id')
        .eq('employee_id', params.employeeId)
        .eq('request_date', attendance.attendance_date || today)
        .eq('status', 'APPROVED')
        .maybeSingle() as any;
      isWfh = !!wfhData;
    }

    // 4. Evaluate tracking condition using pure rules
    const decision = evaluateTrackingEnforcement({
      geoStatus: params.geoStatus,
      failureReason: params.failureReason,
      isOnline,
      isClockedIn,
      isClockedOut,
      hasActiveBreak,
      isWfh,
      lastSeenAt: params.lastSeenAt,
      serverReceivedAt: params.serverReceivedAt,
      serverNowMs,
    });

    const previousCondition = this._lastKnownStates.get(params.employeeId) || null;
    this._lastKnownStates.set(params.employeeId, decision.condition);

    // Handle Offline state
    if (decision.isOffline && decision.shouldQueueDeviceWarning) {
      this._offlineWarnings.set(params.employeeId, {
        at: new Date(serverNowMs).toISOString(),
        reason: decision.reason,
      });
      // Queue device notification if available
      try {
        const warning = offlineWarningQueued({ reason: decision.reason });
        await notificationService.notifyEmployee(params.employeeId, warning);
      } catch {
        // Notification delivery non-blocking
      }
      return { decision };
    }

    // Handle Confirmed Violation -> Start Warning & Immediate Auto Break
    if (decision.shouldTriggerAutomaticBreak && decision.violationType) {
      const serverTimestamp = validateServerTimestamp(params.deviceTimestamp, serverNowMs).timestampIso;

      const breakResult = await breakService.handleTrackingEnforcementBreak({
        employeeId: params.employeeId,
        violationType: decision.violationType,
        reason: decision.reason,
        serverTimestamp,
      });

      return { decision, breakResult };
    }

    // Handle Recovery: if employee recovered from a previous tracking-loss condition
    if (decision.condition === 'TRACKING_OK' && isTrackingRecovered(previousCondition, true)) {
      await this.handleTrackingRecovered(params.employeeId, serverNowMs);
    }

    return { decision };
  },

  /**
   * Handle tracking recovery when a valid location fix is re-established.
   * Logs an audit record and notifies admins without auto-closing existing breaks.
   */
  async handleTrackingRecovered(employeeId: string, timestampMs = Date.now()) {
    const recoveryIso = new Date(timestampMs).toISOString();
    this._lastKnownStates.set(employeeId, 'TRACKING_OK');
    this._offlineWarnings.delete(employeeId);

    // Log recovery audit
    await logBreakAudit({
      action: 'TRACKING_RECOVERED',
      module: 'ATTENDANCE',
      entity_type: 'employee_live_locations',
      entity_id: employeeId,
      description: `Location tracking recovered at ${recoveryIso}.`,
      new_values: { recovered_at: recoveryIso },
    });

    // Notify admins of recovery
    try {
      const { data: emp } = await supabase
        .from('employees')
        .select('first_name, last_name, employee_code')
        .eq('id', employeeId)
        .maybeSingle() as any;

      if (emp) {
        const empName = `${emp.first_name || 'Employee'} ${emp.last_name || ''}`.trim();
        const alert = trackingRecoveredAdminAlert({
          employeeName: empName,
          employeeCode: emp.employee_code || 'Unknown',
          timestamp: recoveryIso,
        });
        await notificationService.notifyAdmins({
          notification_type: alert.notification_type,
          title: alert.title,
          message: alert.message,
          priority: alert.priority,
          action_url: alert.action_url,
          entity_type: alert.entity_type,
          metadata: alert.metadata,
        });
      }
    } catch (err) {
      console.error('[TRACKING ENFORCEMENT] Recovery notification failed:', err);
    }
  },

  /**
   * Correct an erroneous tracking enforcement break with audit trail.
   */
  async correctIncidentBreak(params: {
    breakId: string;
    attendanceId: string;
    reason: string;
  }) {
    return breakService.correctTrackingEnforcementBreak({
      breakId: params.breakId,
      attendanceId: params.attendanceId,
      correctionReason: params.reason,
    });
  },

  /**
   * Clear state (useful for test resets).
   */
  clearState() {
    this._lastKnownStates.clear();
    this._offlineWarnings.clear();
  },
};
