import React from 'react';
import { Radio, Clock, MapPinOff, LocateOff, CircleSlash, CircleHelp, ChevronDown, type LucideIcon } from 'lucide-react';
import { formatAge, trackingSummary, type BreakReportTracking, type TrackingTone } from '../../services/attendance/breakReportRules';

const ICON: Record<TrackingTone, LucideIcon> = {
  current: Radio,
  stale: Clock,
  permission: MapPinOff,
  unavailable: LocateOff,
  'no-data': CircleSlash,
  unknown: CircleHelp,
  'not-applicable': CircleSlash,
};

interface Props {
  tracking: BreakReportTracking;
  nowMs: number;
  /** Formats an ISO time in company time (null → placeholder). */
  formatTime: (iso: string | null) => string;
  /** Render expanded (no disclosure), e.g. inside the details panel. */
  expanded?: boolean;
}

/**
 * Compact location-tracking status for Break Management: a short state chip, the last update time
 * with its age, and the last known location. The full explanation is behind a disclosure
 * (native <details>, keyboard and screen-reader accessible) instead of wrapping in the table.
 * The state is always written in words; colour and icon only repeat it.
 */
const TrackingStatus: React.FC<Props> = ({ tracking, nowMs, formatTime, expanded = false }) => {
  const s = trackingSummary(tracking, nowMs, formatTime);
  if (s.tone === 'not-applicable' && !expanded) {
    return <span className="tracking-status tracking-status--na" title={s.detail}><span aria-hidden="true">—</span><span className="visually-hidden">Not tracked</span></span>;
  }
  const Icon = ICON[s.tone];
  const when = s.at ? `${formatTime(s.at)} · ${formatAge(s.ageMins)}` : null;
  const chip = (
    <span className={`tracking-chip tracking-chip--${s.tone}`}>
      <Icon size={13} aria-hidden={true} />
      <span>{s.label}</span>
    </span>
  );
  const meta = (
    <span className="tracking-meta">
      {when && <span className="tracking-when"><time dateTime={s.at!}>{when}</time></span>}
      {s.tone !== 'no-data' && s.tone !== 'unknown' && <span className="tracking-where">Last known: {s.location}</span>}
    </span>
  );

  if (expanded) {
    return (
      <div className={`tracking-status tracking-status--${s.tone} is-expanded`} data-tracking-tone={s.tone}>
        {chip}
        {meta}
        <p className="tracking-detail">{s.detail}</p>
      </div>
    );
  }
  return (
    <details className={`tracking-status tracking-status--${s.tone}`} data-tracking-tone={s.tone}>
      <summary aria-label={`Tracking: ${s.label}${when ? `, ${when}` : ''}. Show details`}>
        {chip}
        <ChevronDown className="tracking-toggle" size={14} aria-hidden={true} />
        {meta}
      </summary>
      <p className="tracking-detail">{s.detail}</p>
    </details>
  );
};

export default TrackingStatus;
