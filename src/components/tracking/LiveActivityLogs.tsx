import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity } from 'lucide-react';
import { ACTIVITY_LABELS, filterLogs, formatActivityTime, mergeLogs, type LiveActivityLog, type LiveActivityType } from '../../services/location/liveActivityRules';
import { fetchActivitySince, startOfCompanyDayIso, subscribeToActivity, type LiveActivityConnection } from '../../services/location/liveActivityService';

/**
 * Live Activity Logs (Admin Live Tracking). Display-only layer: shows real database events,
 * never computes geofence or break state itself.
 */

const FILTERABLE: LiveActivityType[] = ['CLOCK_IN', 'CLOCK_OUT', 'BREAK_STARTED', 'BREAK_ENDED', 'GEOFENCE_ENTER', 'GEOFENCE_EXIT', 'LOCATION_UPDATE', 'GPS_STALE', 'GPS_PERMISSION_DENIED', 'GPS_UNAVAILABLE'];

const DOT: Record<LiveActivityType, string> = {
  CLOCK_IN: 'var(--success)', CLOCK_OUT: 'var(--gray-500)', BREAK_STARTED: 'var(--warning)', BREAK_ENDED: 'var(--success)',
  GEOFENCE_ENTER: 'var(--success)', GEOFENCE_EXIT: 'var(--danger)', LOCATION_UPDATE: 'var(--primary-500)',
  GPS_STALE: 'var(--gray-500)', GPS_PERMISSION_DENIED: 'var(--danger)', GPS_UNAVAILABLE: 'var(--warning)',
};

const NEAR_TOP_PX = 40;
const REFRESH_DEBOUNCE_MS = 1200;
const OVERLAP_MS = 2 * 60000; // re-read a small overlap so late-arriving rows are not missed (dedupe removes repeats)

interface Props {
  onSelectEmployee?: (employeeId: string, employeeCode?: string) => void;
}

const LiveActivityLogs: React.FC<Props> = ({ onSelectEmployee }) => {
  const [logs, setLogs] = useState<LiveActivityLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [connection, setConnection] = useState<LiveActivityConnection>('connecting');
  const [employeeFilter, setEmployeeFilter] = useState('All');
  const [activityFilter, setActivityFilter] = useState<'All' | LiveActivityType>('All');
  const [pendingNew, setPendingNew] = useState(0);

  const logsRef = useRef<LiveActivityLog[]>([]);
  const listRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevConnection = useRef<LiveActivityConnection>('connecting');

  const applyIncoming = useCallback((incoming: LiveActivityLog[], countAsNew: boolean) => {
    const before = new Set(logsRef.current.map(l => l.id));
    const merged = mergeLogs(logsRef.current, incoming);
    const added = merged.filter(l => !before.has(l.id)).length;
    logsRef.current = merged;
    setLogs(merged);
    if (countAsNew && added > 0) {
      const el = listRef.current;
      if (el && el.scrollTop > NEAR_TOP_PX) setPendingNew(n => n + added); // user scrolled away: don't jump
    }
  }, []);

  const fetchNewer = useCallback(async () => {
    const dayStart = startOfCompanyDayIso();
    const newest = logsRef.current[0]?.timestamp;
    const since = newest ? new Date(Math.max(new Date(newest).getTime() - OVERLAP_MS, new Date(dayStart).getTime())).toISOString() : dayStart;
    const { logs: incoming, errors } = await fetchActivitySince(since);
    if (errors.length) console.error('[Live Activity] fetch errors:', errors);
    applyIncoming(incoming, true);
  }, [applyIncoming]);

  // Initial load: today's latest real events
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { logs: initial, errors } = await fetchActivitySince(startOfCompanyDayIso());
      if (cancelled) return;
      if (errors.length && initial.length === 0) setLoadError(true);
      if (errors.length) console.error('[Live Activity] load errors:', errors);
      applyIncoming(initial, false);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [applyIncoming]);

  // One Realtime subscription for the lifetime of the panel
  useEffect(() => {
    const cleanup = subscribeToActivity(
      () => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => { fetchNewer(); }, REFRESH_DEBOUNCE_MS);
      },
      status => {
        // After a reconnect, catch up on anything missed (dedupe prevents duplicates)
        if (status === 'live' && (prevConnection.current === 'reconnecting' || prevConnection.current === 'disconnected')) fetchNewer();
        prevConnection.current = status;
        setConnection(status);
      },
    );
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      cleanup();
    };
  }, [fetchNewer]);

  const employees = useMemo(() => {
    const m = new Map<string, string>();
    logs.forEach(l => m.set(l.employeeId, l.employeeCode ? `${l.employeeName} (${l.employeeCode})` : l.employeeName));
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [logs]);

  const visible = useMemo(
    () => filterLogs(logs, employeeFilter, activityFilter),
    [logs, employeeFilter, activityFilter],
  );

  const onScroll = () => {
    if (listRef.current && listRef.current.scrollTop <= NEAR_TOP_PX && pendingNew) setPendingNew(0);
  };
  const jumpToNewest = () => {
    listRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    setPendingNew(0);
  };

  const live = connection === 'live';
  const indicator = live
    ? { dot: 'var(--success)', text: 'Live', filled: true }
    : connection === 'connecting'
      ? { dot: 'var(--gray-500)', text: 'Connecting…', filled: false }
      : connection === 'reconnecting'
        ? { dot: 'var(--warning)', text: 'Reconnecting…', filled: false }
        : { dot: 'var(--danger)', text: 'Disconnected', filled: false };

  return (
    <div className="card live-activity-card" style={{ padding: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }} data-testid="live-activity-logs">
      <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border-color)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
          <h3 className="card-title" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}><Activity size={18} /> Live Activity</h3>
          <span data-testid="live-activity-status" data-status={connection} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.75rem', fontWeight: 600, color: indicator.dot }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: indicator.filled ? indicator.dot : 'transparent', border: `2px solid ${indicator.dot}` }} />
            {indicator.text}
          </span>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
          <select className="form-control" style={{ flex: '1 1 140px', fontSize: '0.8rem' }} value={employeeFilter} onChange={e => setEmployeeFilter(e.target.value)} aria-label="Filter by employee">
            <option value="All">All Employees</option>
            {employees.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
          <select className="form-control" style={{ flex: '1 1 140px', fontSize: '0.8rem' }} value={activityFilter} onChange={e => setActivityFilter(e.target.value as any)} aria-label="Filter by activity">
            <option value="All">All Activities</option>
            {FILTERABLE.map(t => <option key={t} value={t}>{ACTIVITY_LABELS[t]}</option>)}
          </select>
        </div>
        <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: '0.5rem' }}>Today</div>
        {!live && connection !== 'connecting' && (
          <div style={{ fontSize: '0.75rem', color: 'var(--danger)', marginTop: '0.5rem' }}>Live activity connection interrupted.</div>
        )}
      </div>

      <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        {pendingNew > 0 && (
          <button onClick={jumpToNewest} className="btn btn-primary" data-testid="live-activity-new" style={{ position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)', zIndex: 2, fontSize: '0.75rem', padding: '0.25rem 0.75rem', borderRadius: 'var(--radius-full)' }}>
            {pendingNew} new {pendingNew === 1 ? 'activity' : 'activities'}
          </button>
        )}
        <div ref={listRef} onScroll={onScroll} className="live-activity-list" data-testid="live-activity-list">
          {loading ? (
            <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Loading activity…</div>
          ) : loadError ? (
            <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--danger)', fontSize: '0.875rem' }}>Unable to load live activity.</div>
          ) : visible.length === 0 ? (
            <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.875rem' }}>No activity yet today.</div>
          ) : (
            visible.map(l => {
              const clickable = !!onSelectEmployee;
              return (
                <div
                  key={l.id}
                  data-testid="live-activity-item"
                  data-activity={l.activityType}
                  className={`live-activity-item${clickable ? ' clickable' : ''}`}
                  role={clickable ? 'button' : undefined}
                  tabIndex={clickable ? 0 : undefined}
                  onClick={clickable ? () => onSelectEmployee!(l.employeeId, l.employeeCode) : undefined}
                  onKeyDown={clickable ? (e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelectEmployee!(l.employeeId, l.employeeCode); } }) : undefined}
                  title={clickable ? 'Show this employee' : undefined}
                >
                  <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: DOT[l.activityType], marginTop: '0.4rem', flexShrink: 0 }} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem' }}>
                      <span style={{ fontWeight: 600, fontSize: '0.85rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {l.employeeName}{l.employeeCode && <span style={{ color: 'var(--text-secondary)', fontWeight: 400 }}> · {l.employeeCode}</span>}
                      </span>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{formatActivityTime(l.timestamp)}</span>
                    </div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-primary)', marginTop: '0.125rem' }}>{(m => m.charAt(0).toUpperCase() + m.slice(1))(l.message.replace(`${l.employeeName} `, ''))}</div>
                    <span className="badge badge-gray" style={{ fontSize: '0.65rem', marginTop: '0.25rem' }}>{ACTIVITY_LABELS[l.activityType]}</span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

export default LiveActivityLogs;
