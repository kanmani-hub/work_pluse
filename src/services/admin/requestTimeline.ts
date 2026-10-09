/**
 * Request timeline (leave / permission) built ONLY from columns stored on the request row:
 * requested_at, status, reviewed_at, reviewed_by (+ resolved reviewer name), reviewer_remarks.
 * No invented events: when a decision exists but its time was not recorded, the event is
 * still shown with "time not recorded" and `historyIncomplete` is set.
 */
import { COMPANY_TIMEZONE } from '../../utils/companyDate';

export interface TimelineEvent {
  key: string;
  label: string;
  at: string | null;          // ISO timestamp, null when not recorded
  by: string | null;          // display name, null when unknown
  tone: 'neutral' | 'success' | 'danger' | 'warning';
  note?: string | null;
}

export interface RequestLike {
  status?: string | null;
  requested_at?: string | null;
  created_at?: string | null;
  reviewed_at?: string | null;
  reviewed_by?: string | null;
  reviewer_remarks?: string | null;
}

const DECISION: Record<string, { label: string; tone: TimelineEvent['tone'] }> = {
  APPROVED: { label: 'Approved', tone: 'success' },
  REJECTED: { label: 'Rejected', tone: 'danger' },
  CANCELLED: { label: 'Cancelled', tone: 'warning' },
  REVOKED: { label: 'Revoked', tone: 'warning' },
};

export function buildRequestTimeline(
  req: RequestLike,
  opts: { requesterName?: string | null; reviewerName?: string | null } = {}
): { events: TimelineEvent[]; historyIncomplete: boolean } {
  const events: TimelineEvent[] = [];
  let historyIncomplete = false;
  const requestedAt = req.requested_at || req.created_at || null;
  events.push({ key: 'requested', label: 'Requested', at: requestedAt, by: opts.requesterName || null, tone: 'neutral' });
  if (!requestedAt) historyIncomplete = true;

  const status = String(req.status || '').toUpperCase();
  const decision = DECISION[status];
  if (decision) {
    const at = req.reviewed_at || null;
    // A cancellation by the employee normally has no reviewer; an admin decision does.
    const by = req.reviewed_by ? (opts.reviewerName || 'Admin (name unavailable)') : null;
    if (!at) historyIncomplete = true;
    events.push({ key: 'decision', label: decision.label, at, by, tone: decision.tone, note: req.reviewer_remarks || null });
  }
  return { events, historyIncomplete };
}

export function formatTimelineTime(iso: string | null, timeZone = COMPANY_TIMEZONE): string {
  if (!iso) return 'time not recorded';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return 'time not recorded';
  return `${d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone })}, ${d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone })}`;
}
