import React from 'react';
import { Radio, Clock, MapPinOff, LocateOff, CircleSlash, CircleHelp, ChevronDown, type LucideIcon } from 'lucide-react';
import './trackingStatus.css';
import { formatAge, formatTrackingTime, trackingSummary, TRACKING_STALE_MINUTES, type TrackingInfo, type TrackingTone } from '../../services/location/trackingStatus';

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
  tracking: TrackingInfo;
  nowMs: number;
  /** Display threshold for "not updating" (Settings → trackingStaleMinutes). */
  staleMinutes?: number;
  /** Optional time formatter; defaults to company time with the date when it is not today. */
  formatTime?: (iso: string | null) => string;
  /** Render expanded (no disclosure), e.g. inside the details panel. */
  expanded?: boolean;
}

/**
 * Compact location-tracking status (Break Management, Live Tracking): a short state chip, the last update time
 * with its age, and the last known location. The full explanation is behind a disclosure
 * (native <details>, keyboard and screen-reader accessible) instead of wrapping in the table.
 * The state is always written in words; colour and icon only repeat it.
 */
const TrackingStatus: React.FC<Props> = ({ tracking, nowMs, staleMinutes = TRACKING_STALE_MINUTES, formatTime, expanded = false }) => {
  const fmt = formatTime ?? ((iso: string | null) => formatTrackingTime(iso, nowMs));
  const s = trackingSummary(tracking, nowMs, fmt, staleMinutes);
  if (s.tone === 'not-applicable' && !expanded) {
    // explicit empty state (not a bare dash): why tracking does not apply
    return (
      <span className="tracking-status tracking-status--na" data-tracking-tone="not-applicable" title={s.detail}>
        <span className="tracking-na-label">Not tracked · {s.label.toLowerCase()}</span>
      </span>
    );
  }
  const Icon = ICON[s.tone];
  const when = s.at ? `${fmt(s.at)} · ${formatAge(s.ageMins)}` : null;
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
