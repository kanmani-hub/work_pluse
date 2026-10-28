-- Rollback of 20261028090300_auto_break_tracking_off_immediate.sql: restores report_tracking_event() and
-- process_stale_tracking() exactly as in 20261021120000_automatic_break_tracking.sql (permission denied waits
-- for a configured grace period again). No break, attendance or tracking data is changed.
BEGIN;

CREATE OR REPLACE FUNCTION public.report_tracking_event(p_event text, p_message text DEFAULT NULL, p_offline_seconds integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_emp uuid := get_auth_employee_id();
  v_att uuid; v_date date; v_wfh boolean; v_policy jsonb := ab_policy(); v_state text; v_reason text; v_applies boolean;
  v_shift_end timestamptz; v_open record;
BEGIN
  IF v_emp IS NULL THEN RAISE EXCEPTION 'Not signed in as an employee' USING ERRCODE = '42501'; END IF;
  IF p_event NOT IN ('LOCATION_DENIED', 'LOCATION_UNAVAILABLE', 'TIMEOUT', 'UNKNOWN_ERROR', 'NETWORK_RECONNECTED') THEN
    RAISE EXCEPTION 'Unknown tracking event %', p_event USING ERRCODE = '22023';
  END IF;

  v_att := ab_open_attendance(v_emp, true);
  IF v_att IS NULL THEN
    RETURN jsonb_build_object('action', 'NONE', 'reason', 'NOT_CLOCKED_IN');  -- no off-duty tracking state
  END IF;
  SELECT attendance_date INTO v_date FROM attendance WHERE id = v_att;
  v_wfh := ab_is_wfh(v_emp, v_date);

  v_state := CASE p_event WHEN 'LOCATION_DENIED' THEN 'PERMISSION_DENIED' WHEN 'LOCATION_UNAVAILABLE' THEN 'GPS_UNAVAILABLE'
                          WHEN 'TIMEOUT' THEN 'GPS_TIMEOUT' WHEN 'UNKNOWN_ERROR' THEN 'LOCATION_ERROR' ELSE 'WAITING_FOR_FIX' END;
  PERFORM ab_set_state(v_emp, v_att, v_state, CASE WHEN v_wfh THEN 'WFH' ELSE 'OFFICE' END);
  UPDATE employee_tracking_state SET
    last_problem = CASE WHEN p_event = 'NETWORK_RECONNECTED' THEN last_problem ELSE v_state END,
    last_problem_at = CASE WHEN p_event = 'NETWORK_RECONNECTED' THEN last_problem_at ELSE now() END,
    last_problem_message = CASE WHEN p_event = 'NETWORK_RECONNECTED' THEN last_problem_message ELSE left(p_message, 500) END,
    last_reconnect_at = CASE WHEN p_event = 'NETWORK_RECONNECTED' THEN now() ELSE last_reconnect_at END,
    reported_offline_seconds = CASE WHEN p_event = 'NETWORK_RECONNECTED' THEN GREATEST(0, LEAST(p_offline_seconds, 86400)) ELSE reported_offline_seconds END
  WHERE employee_id = v_emp;

  SELECT id, break_type, reason INTO v_open FROM attendance_breaks WHERE attendance_id = v_att AND ended_at IS NULL AND break_type <> 'CANCELLED' LIMIT 1;

  IF p_event = 'NETWORK_RECONNECTED' THEN
    -- the device says it was offline: a stale-location break gets the more specific reason (time unchanged)
    IF v_open.id IS NOT NULL AND v_open.break_type = 'AUTO_TRACKING' AND v_open.reason = 'TRACKING_STALE' AND COALESCE(p_offline_seconds, 0) > 0 THEN
      UPDATE attendance_breaks SET reason = 'NETWORK_DISCONNECTED' WHERE id = v_open.id;
    END IF;
    RETURN jsonb_build_object('action', 'NONE', 'reason', 'WAITING_FOR_FRESH_LOCATION', 'state', v_state);
  END IF;

  IF p_event IN ('TIMEOUT', 'UNKNOWN_ERROR') THEN
    RETURN jsonb_build_object('action', 'NONE', 'reason', 'NOT_PROOF_OF_TRACKING_LOSS', 'state', v_state);
  END IF;

  v_reason := CASE p_event WHEN 'LOCATION_DENIED' THEN 'LOCATION_PERMISSION_DENIED' ELSE 'GPS_UNAVAILABLE' END;
  v_applies := (v_policy->>'enabled')::boolean
    AND CASE p_event WHEN 'LOCATION_DENIED' THEN (v_policy->>'onPermissionDenied')::boolean ELSE (v_policy->>'onGpsUnavailable')::boolean END
    AND (NOT v_wfh OR (v_policy->>'wfhGpsLoss')::boolean);
  IF NOT v_applies THEN
    RETURN jsonb_build_object('action', 'NONE', 'reason', CASE WHEN v_wfh THEN 'WFH_EXEMPT' ELSE 'POLICY_DISABLED' END, 'state', v_state);
  END IF;
  IF v_open.id IS NOT NULL THEN
    RETURN jsonb_build_object('action', 'NONE', 'reason', 'BREAK_ALREADY_ACTIVE', 'break_id', v_open.id, 'state', v_state);
  END IF;
  v_shift_end := ab_shift_end(v_att);
  IF v_shift_end IS NOT NULL AND now() >= v_shift_end THEN
    RETURN jsonb_build_object('action', 'NONE', 'reason', 'AFTER_SHIFT_END', 'state', v_state);
  END IF;
  IF (v_policy->>'graceMinutes')::int > 0 THEN
    RETURN jsonb_build_object('action', 'NONE', 'reason', 'GRACE_PERIOD', 'state', v_state);  -- process_stale_tracking starts it later
  END IF;
  RETURN ab_start_auto_break(v_att, 'AUTO_TRACKING', v_reason, now(), jsonb_build_object('device_message', left(p_message, 300)))
         || jsonb_build_object('state', v_state);
END $$;

CREATE OR REPLACE FUNCTION public.process_stale_tracking()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_policy jsonb := ab_policy(); v_stale int; v_grace int; v_today date := ab_company_date(now());
  r record; s record; v_open record; v_shift_end timestamptz; v_wfh boolean; v_since timestamptz; v_res jsonb;
  v_started int := 0; v_closed int := 0; v_checked int := 0; v_gps_policy boolean;
BEGIN
  -- API callers must be ADMIN/HR (fallback when pg_cron is not available); cron / service role have no auth.uid()
  IF auth.uid() IS NOT NULL AND COALESCE(get_auth_role(), '') NOT IN ('ADMIN', 'HR') THEN
    RAISE EXCEPTION 'Only administrators can run tracking evaluation' USING ERRCODE = '42501';
  END IF;
  v_stale := (v_policy->>'staleMinutes')::int;
  v_grace := (v_policy->>'graceMinutes')::int;

  FOR r IN
    SELECT a.id, a.employee_id, a.attendance_date, a.clock_in_at
    FROM attendance a LEFT JOIN shift_templates st ON st.id = a.shift_template_id
    WHERE a.clock_in_at IS NOT NULL AND a.clock_out_at IS NULL
      AND (a.attendance_date = v_today OR (a.attendance_date = v_today - 1 AND COALESCE(st.crosses_midnight, false)))
    FOR UPDATE OF a SKIP LOCKED   -- another run (or a device request) is handling this attendance
  LOOP
    v_checked := v_checked + 1;
    SELECT id, break_type, started_at INTO v_open FROM attendance_breaks WHERE attendance_id = r.id AND ended_at IS NULL AND break_type <> 'CANCELLED' LIMIT 1;
    v_shift_end := ab_shift_end(r.id);

    -- Shift end: close an open tracking break at the shift end; no new automatic breaks afterwards
    IF v_shift_end IS NOT NULL AND now() >= v_shift_end THEN
      IF v_open.id IS NOT NULL AND v_open.break_type = 'AUTO_TRACKING' THEN
        PERFORM ab_end_auto_break(v_open.id, GREATEST(v_shift_end, v_open.started_at), 'SHIFT_END');
        v_closed := v_closed + 1;
      END IF;
      CONTINUE;
    END IF;
    IF NOT (v_policy->>'enabled')::boolean OR v_open.id IS NOT NULL THEN CONTINUE; END IF;

    v_wfh := ab_is_wfh(r.employee_id, r.attendance_date);
    SELECT * INTO s FROM employee_tracking_state WHERE employee_id = r.employee_id AND attendance_id = r.id;

    -- (a) a GPS problem reported by the device that has outlasted a configured grace period
    IF v_grace > 0 AND s.employee_id IS NOT NULL AND s.state IN ('PERMISSION_DENIED', 'GPS_UNAVAILABLE')
       AND (NOT v_wfh OR (v_policy->>'wfhGpsLoss')::boolean)
       AND (CASE s.state WHEN 'PERMISSION_DENIED' THEN (v_policy->>'onPermissionDenied')::boolean ELSE (v_policy->>'onGpsUnavailable')::boolean END)
       AND now() >= s.state_since + make_interval(mins => v_grace) THEN
      v_res := ab_start_auto_break(r.id, 'AUTO_TRACKING',
                 CASE s.state WHEN 'PERMISSION_DENIED' THEN 'LOCATION_PERMISSION_DENIED' ELSE 'GPS_UNAVAILABLE' END,
                 s.state_since + make_interval(mins => v_grace));
      IF v_res->>'action' = 'STARTED' THEN v_started := v_started + 1; END IF;
      CONTINUE;
    END IF;

    -- (b) no fresh location reached the server for the stale interval
    IF NOT (v_policy->>'onStale')::boolean OR (v_wfh AND NOT (v_policy->>'wfhStale')::boolean) THEN CONTINUE; END IF;
    v_since := GREATEST(COALESCE(s.last_fresh_fix_at, r.clock_in_at), r.clock_in_at);
    IF now() < v_since + make_interval(mins => v_stale + v_grace) THEN CONTINUE; END IF;
    -- The device is still in contact and is reporting a GPS problem whose policy says "no break"
    -- (WFH GPS loss, or that rule switched off): GPS loss is not turned into a stale break.
    IF s.employee_id IS NOT NULL AND s.state IN ('PERMISSION_DENIED', 'GPS_UNAVAILABLE')
       AND s.last_contact_at > now() - make_interval(mins => v_stale) THEN
      v_gps_policy := CASE s.state WHEN 'PERMISSION_DENIED' THEN (v_policy->>'onPermissionDenied')::boolean ELSE (v_policy->>'onGpsUnavailable')::boolean END
                      AND (NOT v_wfh OR (v_policy->>'wfhGpsLoss')::boolean);
      IF NOT v_gps_policy THEN CONTINUE; END IF;
    END IF;
    PERFORM ab_set_state(r.employee_id, r.id, 'STALE', CASE WHEN v_wfh THEN 'WFH' ELSE 'OFFICE' END);
    -- last_contact_at was not a device contact: restore it
    UPDATE employee_tracking_state SET last_contact_at = s.last_contact_at WHERE employee_id = r.employee_id;
    v_res := ab_start_auto_break(r.id, 'AUTO_TRACKING', 'TRACKING_STALE', v_since + make_interval(mins => v_grace),
                                 jsonb_build_object('last_fresh_location_at', s.last_fresh_fix_at, 'stale_minutes', v_stale));
    IF v_res->>'action' = 'STARTED' THEN v_started := v_started + 1; END IF;
  END LOOP;

  RETURN jsonb_build_object('checked', v_checked, 'started', v_started, 'closed_at_shift_end', v_closed, 'ran_at', now());
END $$;

COMMIT;
