/**
 * Mobile location tracking: offline queue and upload rules (pure, unit-tested).
 *
 * Nothing here touches the device, the network or the database. The mobile layer (Phase 3)
 * stores the queue securely and calls these functions; the same rules decide what is uploaded,
 * in what order, how failures are retried and what may update the admin's live location.
 *
 * Fits the EXISTING schema (no changes):
 *   employee_location_history.id          ← reading.id (client UUID) → a retried upload is rejected
 *                                            as a duplicate primary key (23505) = already uploaded
 *   employee_location_history.recorded_at ← reading.recordedAt (device time)
 *   employee_location_history.created_at  = server receive time (database default)
 *   employee_location_history.metadata    ← queue / timestamp details and review flags
 *   employee_live_locations.last_seen_at  ← newest device time only (never an older reading)
 *
 * Approved rules: readings uploaded late (offline backlog) go to history only — no retroactive
 * automatic breaks, geofence events or notifications. Suspicious timestamps are flagged, not hidden.
 */

export interface LocationReading {
  id: string;                     // client UUID, created once per reading
  employeeId: string;
  attendanceId: string;
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
  recordedAt: string;             // device time of the GPS fix (ISO)
  queuedAt: string;               // device time it entered the queue (ISO)
  attempts: number;               // upload attempts so far
  nextAttemptAt: string | null;   // earliest next upload (ISO); null = now
  lastError: string | null;
  flags: ReadingFlag[];
}

export type ReadingFlag = 'FUTURE_TIMESTAMP' | 'RECORDED_AFTER_QUEUED' | 'LOW_ACCURACY' | 'LATE_UPLOAD';

export interface QueueLimits {
  maxItems: number;               // hard cap on stored readings
  maxAgeHours: number;            // readings older than this are expired (reported, not silent)
}
export const DEFAULT_QUEUE_LIMITS: QueueLimits = { maxItems: 5000, maxAgeHours: 72 };

export interface RetryPolicy { baseMs: number; maxMs: number; maxAttempts: number }
export const DEFAULT_RETRY: RetryPolicy = { baseMs: 15_000, maxMs: 15 * 60_000, maxAttempts: 20 };

/** A reading counts as an offline backlog (history only) when uploaded this long after it was recorded. */
export const LATE_UPLOAD_MINUTES = 2;
/** Device clocks may drift a little; anything further ahead of the server is FUTURE. */
export const FUTURE_TOLERANCE_MINUTES = 5;
/** Session boundary tolerance (clock-in / clock-out vs GPS fix time). */
export const SESSION_TOLERANCE_MINUTES = 2;
/** Accuracy above this is kept but flagged (same spirit as the web's low-accuracy rule). */
export const LOW_ACCURACY_METERS = 100;

const ms = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : NaN);
const valid = (iso: string | null | undefined) => Number.isFinite(ms(iso));
const MIN = 60_000;

/** Create a queue entry. `newId` is injected (crypto.randomUUID on the device) so tests are deterministic. */
export function createReading(
  input: { employeeId: string; attendanceId: string; latitude: number; longitude: number; accuracyMeters?: number | null; recordedAt: string },
  newId: () => string,
  nowMs: number,
): LocationReading {
  const flags: ReadingFlag[] = [];
  if (input.accuracyMeters !== null && input.accuracyMeters !== undefined && input.accuracyMeters > LOW_ACCURACY_METERS) flags.push('LOW_ACCURACY');
  return {
    id: newId(), employeeId: input.employeeId, attendanceId: input.attendanceId,
    latitude: input.latitude, longitude: input.longitude, accuracyMeters: input.accuracyMeters ?? null,
    recordedAt: input.recordedAt, queuedAt: new Date(nowMs).toISOString(),
    attempts: 0, nextAttemptAt: null, lastError: null, flags,
  };
}

export type SessionCheck = 'OK' | 'BEFORE_CLOCK_IN' | 'AFTER_CLOCK_OUT' | 'WRONG_SESSION' | 'INVALID';

/**
 * Is this reading inside the authorised working session?
 * session.clockOutAt = the server's clock-out (manual OR automatic). Readings after it are never uploaded.
 */
export function checkSession(
  r: Pick<LocationReading, 'recordedAt' | 'attendanceId' | 'latitude' | 'longitude'>,
  session: { attendanceId: string; clockInAt: string; clockOutAt: string | null },
): SessionCheck {
  if (!valid(r.recordedAt) || !Number.isFinite(r.latitude) || !Number.isFinite(r.longitude)
    || Math.abs(r.latitude) > 90 || Math.abs(r.longitude) > 180) return 'INVALID';
  if (r.attendanceId !== session.attendanceId) return 'WRONG_SESSION';
  const t = ms(r.recordedAt);
  if (t < ms(session.clockInAt) - SESSION_TOLERANCE_MINUTES * MIN) return 'BEFORE_CLOCK_IN';
  if (session.clockOutAt && t > ms(session.clockOutAt) + SESSION_TOLERANCE_MINUTES * MIN) return 'AFTER_CLOCK_OUT';
  return 'OK';
}

/** Timestamp review flags at upload time (serverNowMs = best estimate of server time). Never changes the stored time. */
export function timestampFlags(r: Pick<LocationReading, 'recordedAt' | 'queuedAt' | 'flags'>, serverNowMs: number): ReadingFlag[] {
  const flags = new Set<ReadingFlag>(r.flags);
  const t = ms(r.recordedAt);
  if (t > serverNowMs + FUTURE_TOLERANCE_MINUTES * MIN) flags.add('FUTURE_TIMESTAMP');
  if (valid(r.queuedAt) && t > ms(r.queuedAt) + FUTURE_TOLERANCE_MINUTES * MIN) flags.add('RECORDED_AFTER_QUEUED');
  if (serverNowMs - t > LATE_UPLOAD_MINUTES * MIN) flags.add('LATE_UPLOAD');
  return [...flags];
}

/** Late (offline backlog) readings update history only: no automatic break, geofence event or alert. */
export const isHistoryOnly = (r: Pick<LocationReading, 'recordedAt'>, serverNowMs: number) =>
  serverNowMs - ms(r.recordedAt) > LATE_UPLOAD_MINUTES * MIN;

export interface EnqueueResult { queue: LocationReading[]; added: boolean; expired: LocationReading[]; overflow: LocationReading[] }

/**
 * Add a reading. Same id twice → ignored. Readings past maxAgeHours or over maxItems are removed
 * oldest-first and RETURNED (the caller reports them: nothing disappears silently).
 */
export function enqueue(queue: LocationReading[], reading: LocationReading, nowMs: number, limits: QueueLimits = DEFAULT_QUEUE_LIMITS): EnqueueResult {
  const exists = queue.some(q => q.id === reading.id);
  let list = exists ? [...queue] : [...queue, reading];
  const cutoff = nowMs - limits.maxAgeHours * 60 * MIN;
  const expired = list.filter(q => ms(q.recordedAt) < cutoff);
  list = list.filter(q => !(ms(q.recordedAt) < cutoff));
  list.sort(byRecordedAt);
  const overflow = list.length > limits.maxItems ? list.slice(0, list.length - limits.maxItems) : [];
  if (overflow.length) list = list.slice(list.length - limits.maxItems);
  return { queue: list, added: !exists, expired, overflow };
}

const byRecordedAt = (a: LocationReading, b: LocationReading) => ms(a.recordedAt) - ms(b.recordedAt) || a.id.localeCompare(b.id);

/** Delay before the next attempt: base × 2^(attempts−1), capped (attempts = failures so far, ≥ 1). */
export function backoffDelayMs(attempts: number, policy: RetryPolicy = DEFAULT_RETRY): number {
  const n = Math.max(1, attempts);
  return Math.min(policy.maxMs, policy.baseMs * 2 ** (n - 1));
}

/** Next upload batch: due readings, oldest recorded first. */
export function nextBatch(queue: LocationReading[], nowMs: number, batchSize = 50): LocationReading[] {
  return queue.filter(q => !q.nextAttemptAt || ms(q.nextAttemptAt) <= nowMs).sort(byRecordedAt).slice(0, batchSize);
}

export type UploadOutcome = 'SAVED' | 'DUPLICATE' | 'RETRY' | 'REJECTED';

/** Classify a database/network error for one row (23505 = this id is already stored → treat as uploaded). */
export function classifyUploadError(err: { code?: string; status?: number; message?: string } | null | undefined): UploadOutcome {
  if (!err) return 'SAVED';
  if (err.code === '23505') return 'DUPLICATE';
  // Permission / validation errors will not fix themselves by retrying (RLS 42501, check 23514, bad input 22xxx, 4xx except 408/429)
  if (err.code === '42501' || err.code === '23514' || /^22/.test(err.code || '')) return 'REJECTED';
  if (typeof err.status === 'number' && err.status >= 400 && err.status < 500 && err.status !== 408 && err.status !== 429) return 'REJECTED';
  return 'RETRY'; // network down, timeout, 5xx, rate-limited
}

export interface ApplyResult { queue: LocationReading[]; uploaded: string[]; heldForReview: LocationReading[] }

/**
 * Apply per-reading outcomes. SAVED/DUPLICATE leave the queue. RETRY is rescheduled with backoff.
 * REJECTED, or RETRY past maxAttempts, is moved to `heldForReview` (kept and shown to the
 * employee/admin — never silently discarded).
 */
export function applyUploadResults(
  queue: LocationReading[], outcomes: Record<string, { outcome: UploadOutcome; error?: string }>, nowMs: number, policy: RetryPolicy = DEFAULT_RETRY,
): ApplyResult {
  const uploaded: string[] = [];
  const heldForReview: LocationReading[] = [];
  const next: LocationReading[] = [];
  for (const q of queue) {
    const o = outcomes[q.id];
    if (!o) { next.push(q); continue; }
    if (o.outcome === 'SAVED' || o.outcome === 'DUPLICATE') { uploaded.push(q.id); continue; }
    const attempts = q.attempts + 1;
    const updated = { ...q, attempts, lastError: o.error ?? o.outcome, nextAttemptAt: new Date(nowMs + backoffDelayMs(attempts, policy)).toISOString() };
    if (o.outcome === 'REJECTED' || attempts >= policy.maxAttempts) heldForReview.push(updated);
    else next.push(updated);
  }
  return { queue: next, uploaded, heldForReview };
}

/** Newest wins: a reading may update the live location only if it is newer than what the server holds. */
export function shouldUpdateLive(currentLastSeenAt: string | null | undefined, readingRecordedAt: string): boolean {
  if (!valid(readingRecordedAt)) return false;
  if (!valid(currentLastSeenAt)) return true;
  return ms(readingRecordedAt) > ms(currentLastSeenAt);
}

/** The newest reading of a batch (the only one that may update the live location). */
export function newestReading(batch: LocationReading[]): LocationReading | null {
  return batch.length ? [...batch].sort(byRecordedAt)[batch.length - 1] : null;
}

/** History row for the EXISTING employee_location_history table (geofence fields come from the caller). */
export function historyRow(
  r: LocationReading,
  geo: { officeId: string | null; distanceMeters: number | null; locationStatus: string; locationContext: string },
  serverNowMs: number, appVersion: string,
) {
  const flags = timestampFlags(r, serverNowMs);
  return {
    id: r.id,
    employee_id: r.employeeId,
    attendance_id: r.attendanceId,
    office_id: geo.officeId,
    latitude: r.latitude,
    longitude: r.longitude,
    accuracy_meters: r.accuracyMeters,
    distance_from_office_meters: geo.distanceMeters,
    location_status: geo.locationStatus,
    location_context: geo.locationContext,
    recorded_at: r.recordedAt,      // device time; created_at (server receive time) is set by the database
    source: 'MOBILE',
    metadata: {
      device_recorded_at: r.recordedAt,
      queued_at: r.queuedAt,
      upload_attempts: r.attempts + 1,
      history_only: isHistoryOnly(r, serverNowMs),
      flags,
      needs_review: flags.includes('FUTURE_TIMESTAMP') || flags.includes('RECORDED_AFTER_QUEUED'),
      app_version: appVersion,
    },
  };
}
