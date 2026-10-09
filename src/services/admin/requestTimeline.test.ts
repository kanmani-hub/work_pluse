import { describe, it, expect } from 'vitest';
import { buildRequestTimeline, formatTimelineTime } from './requestTimeline';

describe('buildRequestTimeline (only stored events, no invented dates)', () => {
  it('pending request: only the request event', () => {
    const t = buildRequestTimeline({ status: 'PENDING', requested_at: '2026-10-08T04:00:00Z' }, { requesterName: 'Asha K' });
    expect(t.events).toEqual([{ key: 'requested', label: 'Requested', at: '2026-10-08T04:00:00Z', by: 'Asha K', tone: 'neutral' }]);
    expect(t.historyIncomplete).toBe(false);
  });
  it('approved request uses reviewed_at and the resolved reviewer name and remarks', () => {
    const t = buildRequestTimeline({ status: 'APPROVED', requested_at: '2026-10-08T04:00:00Z', reviewed_at: '2026-10-08T06:05:00Z', reviewed_by: 'adm', reviewer_remarks: 'ok' }, { reviewerName: 'HR Lead' });
    expect(t.events[1]).toEqual({ key: 'decision', label: 'Approved', at: '2026-10-08T06:05:00Z', by: 'HR Lead', tone: 'success', note: 'ok' });
    expect(t.historyIncomplete).toBe(false);
  });
  it('reviewer whose name cannot be resolved is not invented', () => {
    const t = buildRequestTimeline({ status: 'REJECTED', requested_at: 'a', reviewed_at: 'b', reviewed_by: 'adm' });
    expect(t.events[1].by).toBe('Admin (name unavailable)');
  });
  it('decision without a recorded time → flagged as incomplete history', () => {
    const t = buildRequestTimeline({ status: 'CANCELLED', requested_at: '2026-10-08T04:00:00Z' });
    expect(t.events[1]).toMatchObject({ label: 'Cancelled', at: null, by: null });
    expect(t.historyIncomplete).toBe(true);
    expect(formatTimelineTime(null)).toBe('time not recorded');
  });
  it('formats in company time', () => {
    expect(formatTimelineTime('2026-10-08T04:00:00Z')).toBe('08 Oct 2026, 09:30 AM');
  });
});
