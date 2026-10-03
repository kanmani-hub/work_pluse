-- Enable Realtime for live tracking
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 
    FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' 
    AND tablename = 'employee_live_locations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE employee_live_locations;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 
    FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' 
    AND tablename = 'attendance'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE attendance;
  END IF;
END $$;
