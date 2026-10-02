-- 20261002092500_attendance_payroll_extensions.sql

-- Add tracking for break overruns and overtime
ALTER TABLE attendance 
ADD COLUMN IF NOT EXISTS break_overrun_minutes INTEGER DEFAULT 0 CHECK (break_overrun_minutes >= 0),
ADD COLUMN IF NOT EXISTS overtime_minutes INTEGER DEFAULT 0 CHECK (overtime_minutes >= 0),
ADD COLUMN IF NOT EXISTS absence_minutes INTEGER DEFAULT 0 CHECK (absence_minutes >= 0);

-- Update payroll items to include break overruns
-- No schema change needed for payroll_items as item_type and item_name are flexible
