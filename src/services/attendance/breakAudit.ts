/**
 * Audit logging for break and clock-out actions.
 *
 * auditService.recordAuditLog() returns { data, error } instead of throwing, so a `.catch()` alone
 * never sees a failed insert. This helper checks both the returned error and thrown exceptions.
 * An audit failure never undoes or fails the break action itself: it is reported as a diagnostic
 * (action, record type and id, database error code/message; no personal data) and the caller
 * returns `auditLogged: false`.
 */
import { auditService } from '../audit/auditService';

type AuditParams = Parameters<typeof auditService.recordAuditLog>[0];

export async function logBreakAudit(params: AuditParams): Promise<boolean> {
  const where = `${params.entity_type || 'record'} ${params.entity_id || ''}`.trim();
  try {
    const res: any = await auditService.recordAuditLog(params);
    if (res?.error) {
      console.error(`[AUDIT] ${params.action} not recorded for ${where}: ${res.error.code || ''} ${res.error.message || 'unknown error'}`.replace(/\s+/g, ' '));
      return false;
    }
    return true;
  } catch (e: any) {
    console.error(`[AUDIT] ${params.action} not recorded for ${where}: ${e?.message || 'exception'}`);
    return false;
  }
}
