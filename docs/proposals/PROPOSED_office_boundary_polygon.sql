-- =============================================================================================
-- PROPOSED (NOT APPLIED) — optional building boundary (polygon) per office
-- =============================================================================================
-- Keeps the current circle (latitude, longitude, geofence_radius) as the default. A polygon is only
-- used once an admin has entered VERIFIED corner points (surveyed / taken on site, not estimated from
-- a map measurement) and recorded who verified them. No coordinates are created by this script.
-- App side (prepared, not wired): src/services/location/polygonGeofence.ts.
--
-- Format: boundary_polygon = JSON array of 3–50 points, in order around the building:
--   [{"lat": 13.0..., "lng": 80.2...}, {"lat": ..., "lng": ...}, ...]
-- The app validates shape further (no crossing edges, real area) before using it.
-- =============================================================================================

BEGIN;

ALTER TABLE public.offices ADD COLUMN IF NOT EXISTS boundary_polygon jsonb;
ALTER TABLE public.offices ADD COLUMN IF NOT EXISTS boundary_verified_by uuid REFERENCES public.employees(id) ON DELETE SET NULL;
ALTER TABLE public.offices ADD COLUMN IF NOT EXISTS boundary_verified_at timestamptz;

ALTER TABLE public.offices ADD CONSTRAINT offices_boundary_polygon_shape CHECK (
  boundary_polygon IS NULL OR (
    jsonb_typeof(boundary_polygon) = 'array'
    AND jsonb_array_length(boundary_polygon) BETWEEN 3 AND 50
    AND NOT jsonb_path_exists(boundary_polygon, '$[*] ? (!(@.lat.type() == "number" && @.lng.type() == "number" && @.lat >= -90 && @.lat <= 90 && @.lng >= -180 && @.lng <= 180))')
  )
);

-- A polygon is only meaningful together with who verified it and when
ALTER TABLE public.offices ADD CONSTRAINT offices_boundary_polygon_verified CHECK (
  boundary_polygon IS NULL OR (boundary_verified_by IS NOT NULL AND boundary_verified_at IS NOT NULL)
);

COMMENT ON COLUMN public.offices.boundary_polygon IS
  'Optional verified building boundary [{lat,lng},...]. NULL = use the circle (latitude, longitude, geofence_radius).';

COMMIT;

-- ROLLBACK:
--   BEGIN;
--   ALTER TABLE public.offices DROP CONSTRAINT IF EXISTS offices_boundary_polygon_verified;
--   ALTER TABLE public.offices DROP CONSTRAINT IF EXISTS offices_boundary_polygon_shape;
--   ALTER TABLE public.offices DROP COLUMN IF EXISTS boundary_verified_at;
--   ALTER TABLE public.offices DROP COLUMN IF EXISTS boundary_verified_by;
--   ALTER TABLE public.offices DROP COLUMN IF EXISTS boundary_polygon;
--   COMMIT;
--
-- Security: offices are already writable only by admins under the existing RLS; employees only read
-- their office (the polygon is not personal data). Changing the boundary changes Auto Break results
-- for everyone in that office, so record it in the audit log from the admin screen when it is built.
