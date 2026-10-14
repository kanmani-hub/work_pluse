/**
 * PROPOSAL — building-boundary (polygon) geofence. NOT USED by the app yet.
 *
 * The live app keeps the circular geofence (office latitude/longitude + geofence_radius). This module
 * is ready for when verified building corner coordinates exist AND the schema proposal
 * docs/proposals/PROPOSED_office_boundary_polygon.sql has been approved and applied. No corner
 * coordinates are invented anywhere. A Google Maps "40 m" measurement is a path length, not a radius:
 * it cannot be turned into a boundary without the actual corner points.
 *
 * Integration idea (one place, locationService step 4/5): when an office has a verified polygon, use
 * polygonAsGeofenceDistance() instead of the haversine distance + radius. It returns values in the same
 * "distance vs radius" form the existing rules use, so geofenceStability (jitter confirmation, boundary
 * buffer, accuracy requirement, no grace period) applies unchanged:
 *   inside the polygon            ⇔ distanceMeters <= radiusMeters
 *   d metres outside the boundary ⇔ distanceMeters = radiusMeters + d
 * radiusMeters is the radius of a circle with the polygon's area, so the buffer and the accuracy
 * requirement scale with the size of the building as they do today with the circle.
 */
export interface LatLng { lat: number; lng: number }

const EARTH_RADIUS_M = 6_371_000;
const toRad = (d: number) => (d * Math.PI) / 180;

/** Local flat projection (metres) around a reference point: accurate to centimetres at building scale. */
function project(p: LatLng, ref: LatLng): { x: number; y: number } {
  return {
    x: toRad(p.lng - ref.lng) * Math.cos(toRad(ref.lat)) * EARTH_RADIUS_M,
    y: toRad(p.lat - ref.lat) * EARTH_RADIUS_M,
  };
}

function centroid(points: LatLng[]): LatLng {
  return { lat: points.reduce((s, p) => s + p.lat, 0) / points.length, lng: points.reduce((s, p) => s + p.lng, 0) / points.length };
}

function areaM2(xy: { x: number; y: number }[]): number {
  let a = 0;
  for (let i = 0; i < xy.length; i++) { const p = xy[i], q = xy[(i + 1) % xy.length]; a += p.x * q.y - q.x * p.y; }
  return Math.abs(a) / 2;
}

function segmentsIntersect(a: any, b: any, c: any, d: any): boolean {
  const cross = (o: any, p: any, q: any) => (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
  const d1 = cross(c, d, a), d2 = cross(c, d, b), d3 = cross(a, b, c), d4 = cross(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

export const MIN_POLYGON_POINTS = 3;
export const MAX_POLYGON_POINTS = 50;
export const MIN_POLYGON_AREA_M2 = 25;

/** A boundary is usable only if it is a simple (non-crossing) polygon of real coordinates with a real area. */
export function validatePolygon(points: unknown): { ok: true } | { ok: false; reason: string } {
  if (!Array.isArray(points)) return { ok: false, reason: 'Boundary must be a list of points' };
  if (points.length < MIN_POLYGON_POINTS) return { ok: false, reason: 'At least 3 corner points are required' };
  if (points.length > MAX_POLYGON_POINTS) return { ok: false, reason: `At most ${MAX_POLYGON_POINTS} points are allowed` };
  for (const p of points as any[]) {
    if (!p || typeof p.lat !== 'number' || typeof p.lng !== 'number' || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)
      || Math.abs(p.lat) > 90 || Math.abs(p.lng) > 180 || (p.lat === 0 && p.lng === 0)) {
      return { ok: false, reason: 'Every point needs a valid latitude and longitude' };
    }
  }
  const pts = points as LatLng[];
  const ref = centroid(pts);
  const xy = pts.map(p => project(p, ref));
  for (let i = 0; i < xy.length; i++) {
    for (let j = i + 1; j < xy.length; j++) {
      if (Math.abs(i - j) <= 1 || (i === 0 && j === xy.length - 1)) continue; // adjacent edges share a corner
      if (segmentsIntersect(xy[i], xy[(i + 1) % xy.length], xy[j], xy[(j + 1) % xy.length])) {
        return { ok: false, reason: 'Boundary edges cross each other' };
      }
    }
  }
  if (areaM2(xy) < MIN_POLYGON_AREA_M2) return { ok: false, reason: 'Boundary area is too small to be a building' };
  return { ok: true };
}

/** Point-in-polygon (ray casting) in the local projection. Points exactly on an edge count as inside. */
export function isInsidePolygon(point: LatLng, polygon: LatLng[]): boolean {
  return signedDistanceToPolygonMeters(point, polygon) <= 0;
}

/** Distance to the boundary in metres: negative inside, positive outside, 0 on the edge. */
export function signedDistanceToPolygonMeters(point: LatLng, polygon: LatLng[]): number {
  const ref = centroid(polygon);
  const p = project(point, ref);
  const xy = polygon.map(v => project(v, ref));
  let inside = false;
  let minDist = Infinity;
  for (let i = 0, j = xy.length - 1; i < xy.length; j = i++) {
    const a = xy[i], b = xy[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
    minDist = Math.min(minDist, Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)));
  }
  if (minDist < 1e-6) return 0;
  return inside ? -minDist : minDist;
}

/**
 * Polygon expressed as the existing circle inputs, so geofenceStability works unchanged:
 * radiusMeters = equal-area circle radius; distanceMeters = radius + signed distance (never < 0).
 */
export function polygonAsGeofenceDistance(point: LatLng, polygon: LatLng[]): { distanceMeters: number; radiusMeters: number } {
  const ref = centroid(polygon);
  const radiusMeters = Math.sqrt(areaM2(polygon.map(v => project(v, ref))) / Math.PI);
  const signed = signedDistanceToPolygonMeters(point, polygon);
  return { distanceMeters: Math.max(0, radiusMeters + signed), radiusMeters };
}
