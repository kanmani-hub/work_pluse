-- Migration: 0015_auto_clock_out.sql

-- 1. Add clock_out_source column to distinguish AUTO vs MANUAL clock outs
ALTER TABLE attendance 
ADD COLUMN IF NOT EXISTS clock_out_source VARCHAR(50) DEFAULT 'MANUAL';

-- 2. Create the core function to process auto-clock-outs securely on the server side
CREATE OR REPLACE FUNCTION process_auto_clock_out()
RETURNS integer AS $$
DECLARE
    settings JSONB;
    v_auto_enabled BOOLEAN;
    v_grace_hours INTEGER;
    v_mode VARCHAR;
    v_global_break_mins INTEGER;
    
    rec RECORD;
    v_shift_start TIME;
    v_shift_end TIME;
    v_crosses_midnight BOOLEAN;
    
    v_shift_start_dt TIMESTAMPTZ;
    v_shift_end_dt TIMESTAMPTZ;
    v_deadline TIMESTAMPTZ;
    v_clock_out_time TIMESTAMPTZ;
    
    v_actual_break_mins INTEGER;
    v_allowed_break_mins INTEGER;
    v_break_overrun INTEGER;
    v_total_duration_hrs DECIMAL(10,4);
    v_effective_hrs DECIMAL(10,4);
    v_effective_mins INTEGER;
    v_required_mins INTEGER;
    v_overtime INTEGER;
    v_early_logout INTEGER;
    v_new_status VARCHAR;
    v_is_half_day BOOLEAN;
    
    processed_count INTEGER := 0;
BEGIN
    -- Get global app settings from the single config row
    SELECT settings->'app' INTO settings FROM app_settings WHERE id = '00000000-0000-0000-0000-000000000001';
    
    -- Parse settings
    v_auto_enabled := COALESCE((settings->>'autoClockOut')::BOOLEAN, true);
    IF NOT v_auto_enabled THEN
        RETURN 0;
    END IF;
    
    v_grace_hours := COALESCE((settings->>'autoClockOutGraceHours')::INTEGER, 4);
    v_mode := COALESCE(settings->>'autoClockOutMode', 'after_grace_period');
    v_global_break_mins := COALESCE((settings->>'breakDurationMins')::INTEGER, 60);

    -- Loop through OPEN attendance records that should be clocked out
    FOR rec IN 
        SELECT a.id, a.employee_id, a.attendance_date, a.clock_in_at, a.required_hours, a.status,
               st.start_time, st.end_time, st.crosses_midnight, st.break_duration_minutes
        FROM attendance a
        LEFT JOIN shift_templates st ON a.shift_template_id = st.id
        WHERE a.clock_out_at IS NULL AND a.status IN ('WORKING', 'ON_BREAK', 'LATE', 'HALF_DAY')
    LOOP
        -- Determine shift boundaries
        v_shift_start := COALESCE(rec.start_time, '09:00:00'::TIME);
        v_shift_end := COALESCE(rec.end_time, '18:00:00'::TIME);
        v_crosses_midnight := COALESCE(rec.crosses_midnight, false);
        
        -- Calculate exact shift start and end datetime
        v_shift_start_dt := rec.attendance_date + v_shift_start;
        IF v_crosses_midnight THEN
            v_shift_end_dt := (rec.attendance_date + 1) + v_shift_end;
        ELSE
            v_shift_end_dt := rec.attendance_date + v_shift_end;
        END IF;

        -- Determine the deadline for auto-clock-out
        v_deadline := v_shift_end_dt + (v_grace_hours * interval '1 hour');
        
        -- Check if we have passed the deadline
        IF NOW() >= v_deadline THEN
        
            -- The employee is forcibly clocked out at the deadline (or shift end if configured differently)
            -- As per requirements, if they stayed open up to the deadline without clocking out,
            -- we clock them out exactly at the deadline (or shift end). Let's use v_deadline as their exact clock-out time 
            -- or shift end based on mode. Actually, typically auto clock out sets their clock out to their shift end.
            -- Let's set it to deadline time to give them exactly the grace period, or shift end if they wanted that.
            -- Wait, if it's "After Grace Period", use v_deadline.
            IF v_mode = 'at_shift_end' THEN
                v_clock_out_time := v_shift_end_dt;
            ELSE
                v_clock_out_time := v_deadline;
            END IF;

            -- 1. Close any open breaks
            UPDATE attendance_breaks
            SET ended_at = v_clock_out_time,
                duration_minutes = EXTRACT(EPOCH FROM (v_clock_out_time - started_at)) / 60
            WHERE attendance_id = rec.id AND ended_at IS NULL;

            -- 2. Calculate actual break minutes
            SELECT COALESCE(SUM(duration_minutes), 0) INTO v_actual_break_mins
            FROM attendance_breaks
            WHERE attendance_id = rec.id;
            
            v_allowed_break_mins := COALESCE(rec.break_duration_minutes, v_global_break_mins);
            v_break_overrun := GREATEST(0, v_actual_break_mins - v_allowed_break_mins);
            
            -- 3. Calculate working hours
            v_total_duration_hrs := EXTRACT(EPOCH FROM (v_clock_out_time - rec.clock_in_at)) / 3600.0;
            v_effective_hrs := GREATEST(0, v_total_duration_hrs - (v_actual_break_mins / 60.0));
            v_effective_mins := FLOOR(v_effective_hrs * 60);
            v_required_mins := FLOOR(rec.required_hours * 60);
            
            v_early_logout := 0;
            v_overtime := 0;
            
            IF v_effective_mins < v_required_mins THEN
                v_early_logout := v_required_mins - v_effective_mins;
            ELSIF v_effective_mins > v_required_mins THEN
                v_overtime := v_effective_mins - v_required_mins;
            END IF;
            
            v_status := 'COMPLETED';
            v_is_half_day := false;
            
            IF v_effective_mins < (v_required_mins * 0.5) THEN
                v_is_half_day := true;
                v_status := 'HALF_DAY';
            END IF;
            
            -- 4. Update the attendance record
            UPDATE attendance
            SET clock_out_at = v_clock_out_time,
                clock_out_source = 'AUTO',
                is_auto_logged_out = true,
                worked_hours = ROUND(v_effective_hrs, 2),
                break_minutes = v_actual_break_mins,
                break_overrun_minutes = v_break_overrun,
                early_logout_minutes = v_early_logout,
                overtime_minutes = v_overtime,
                is_half_day = v_is_half_day,
                status = v_status,
                updated_at = NOW()
            WHERE id = rec.id;

            -- 5. Log the event
            INSERT INTO attendance_events (attendance_id, employee_id, event_type, event_at, source, metadata)
            VALUES (rec.id, rec.employee_id, 'AUTO_LOGOUT', v_clock_out_time, 'SYSTEM', '{"reason": "Exceeded auto-clock-out grace period"}');

            -- 6. Log notification securely
            INSERT INTO notifications (recipient_employee_id, notification_type, title, message, action_url, is_read)
            VALUES (
                rec.employee_id, 
                'ATTENDANCE', 
                'Automatically Clocked Out', 
                'Your attendance was automatically clocked out because your shift ended and you did not clock out manually.', 
                '/employee/attendance', 
                false
            );

            processed_count := processed_count + 1;
        END IF;
    END LOOP;
    
    RETURN processed_count;
END;
$$ LANGUAGE plpgsql;

-- 3. Schedule the cron job (Requires pg_cron extension)
-- Note: Superuser privileges are required to create extensions. 
-- In Supabase, you can enable pg_cron in Database -> Extensions.
-- Once enabled, the following will run every 15 minutes.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'
  ) THEN
    -- Schedule the auto clock out process every 15 minutes
    PERFORM cron.schedule('auto-clock-out', '*/15 * * * *', 'SELECT process_auto_clock_out()');
  END IF;
END $$;
