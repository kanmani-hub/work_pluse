-- =====================================================================================
-- PROPOSED — NOT APPLIED. Do NOT run without approval.
-- WorkPulse HR Step 4: GPS & Geofence security review
--
-- VERIFIED OK (supabase/migrations/0009_security_hardening.sql):
--   * employee_location_history, geofence_events, location_verification_events:
--       SELECT/INSERT only where employee_id = get_auth_employee_id() (or ADMIN/HR);
--       no UPDATE/DELETE policy → employees cannot modify or delete history/events at all.
--   * employee_live_locations: WITH CHECK employee_id = get_auth_employee_id()
--       → an employee CANNOT write, insert or change another employee's location/status.
--
-- WEAKNESSES (own data only):
--   L1 (MEDIUM) employee_live_locations "Manage" is FOR ALL: an employee can UPDATE their
--      own row to any location_status (e.g. INSIDE_GEOFENCE while away) or DELETE it.
--   L2 (INHERENT) GPS is reported by the browser; a spoofed position cannot be detected
--      server-side from a web app. Real protection = native app attestation / server checks.
-- =====================================================================================
BEGIN;

-- L1a: employees may not delete their live row (admins still can)
DROP POLICY IF EXISTS "Manage employee_live_locations" ON employee_live_locations;
CREATE POLICY "Insert own employee_live_locations" ON employee_live_locations FOR INSERT TO authenticated
WITH CHECK (public.get_auth_role() IN ('ADMIN', 'HR') OR employee_id = public.get_auth_employee_id());
CREATE POLICY "Update own employee_live_locations" ON employee_live_locations FOR UPDATE TO authenticated
USING (public.get_auth_role() IN ('ADMIN', 'HR') OR employee_id = public.get_auth_employee_id())
WITH CHECK (public.get_auth_role() IN ('ADMIN', 'HR') OR employee_id = public.get_auth_employee_id());
CREATE POLICY "Delete employee_live_locations (admin)" ON employee_live_locations FOR DELETE TO authenticated
USING (public.get_auth_role() IN ('ADMIN', 'HR'));

-- L1b: the stored status must agree with the stored distance/radius (server recomputes it),
--      so the status cannot be set independently of the reported coordinates.
CREATE OR REPLACE FUNCTION public.live_location_consistency()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_office offices%ROWTYPE; v_dist DOUBLE PRECISION;
BEGIN
  IF auth.uid() IS NULL OR public.get_auth_role() IN ('ADMIN', 'HR') THEN RETURN NEW; END IF;
  IF NEW.location_status = 'WFH' THEN RETURN NEW; END IF;  -- WFH validated by wfh_requests in the app
  SELECT * INTO v_office FROM offices WHERE id = NEW.office_id;
  IF v_office.id IS NULL OR v_office.latitude IS NULL THEN RETURN NEW; END IF;
  v_dist := 6371000 * 2 * asin(sqrt(
      power(sin(radians(NEW.latitude - v_office.latitude) / 2), 2) +
      cos(radians(v_office.latitude)) * cos(radians(NEW.latitude)) *
      power(sin(radians(NEW.longitude - v_office.longitude) / 2), 2)));
  NEW.distance_from_office_meters := v_dist;
  -- Same hysteresis as geofenceStability.ts (radius / radius + 20 m buffer)
  IF NEW.location_status = 'INSIDE_GEOFENCE' AND v_dist > v_office.geofence_radius + 20 THEN
    RAISE EXCEPTION 'Location status does not match the reported position.' USING ERRCODE = '42501';
  END IF;
  IF NEW.location_status = 'OUTSIDE_GEOFENCE' AND v_dist <= v_office.geofence_radius THEN
    RAISE EXCEPTION 'Location status does not match the reported position.' USING ERRCODE = '42501';
  END IF;
  NEW.last_seen_at := now();  -- server time, not browser time
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS live_location_consistency ON employee_live_locations;
CREATE TRIGGER live_location_consistency BEFORE INSERT OR UPDATE ON employee_live_locations
FOR EACH ROW EXECUTE FUNCTION public.live_location_consistency();

COMMIT;
