import React, { useEffect, useState } from 'react';
import { buildRequestTimeline, formatTimelineTime, type RequestLike } from '../../services/admin/requestTimeline';
import { fetchEmployeeNames } from '../../services/admin/employeeNames';

const TONE_COLOR: Record<string, string> = {
  neutral: 'var(--gray-400)', success: 'var(--success)', danger: 'var(--danger)', warning: 'var(--warning)',
};

/** Timeline of a leave/permission request built only from what is stored on the request row. */
export const RequestTimeline: React.FC<{ request: RequestLike; requesterName?: string | null }> = ({ request, requesterName }) => {
  const [reviewerName, setReviewerName] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setReviewerName(null);
    if (request.reviewed_by) {
      fetchEmployeeNames([request.reviewed_by]).then(names => { if (alive) setReviewerName(names[request.reviewed_by as string] || null); });
    }
    return () => { alive = false; };
  }, [request.reviewed_by]);

  const { events, historyIncomplete } = buildRequestTimeline(request, { requesterName, reviewerName });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', paddingLeft: '1rem', borderLeft: '2px solid var(--gray-200)' }}>
      {events.map(ev => (
        <div key={ev.key} style={{ position: 'relative' }}>
          <div style={{ position: 'absolute', left: '-1.35rem', top: '2px', width: '12px', height: '12px', borderRadius: '50%', backgroundColor: TONE_COLOR[ev.tone], border: '2px solid white' }}></div>
          <div style={{ fontSize: '0.875rem', fontWeight: 500 }}>{ev.label}</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
            {formatTimelineTime(ev.at)}{ev.by ? ` by ${ev.by}` : ''}
          </div>
          {ev.note && <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontStyle: 'italic' }}>“{ev.note}”</div>}
        </div>
      ))}
      {historyIncomplete && (
        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Some earlier history for this request was not recorded and is unavailable.</div>
      )}
    </div>
  );
};
