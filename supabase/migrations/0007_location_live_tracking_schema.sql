-- 0007_location_live_tracking_schema.sql

-- 1. LOCATION VERIFICATION EVENTS
CREATE TABLE location_verification_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
    attendance_id UUID REFERENCES attendance(id) ON DELETE SET NULL,
    office_id UUID REFERENCES offices(id) ON DELETE SET NULL,
    verification_type VARCHAR(50) NOT NULL, -- CLOCK_IN, CLOCK_OUT, LOCATION_CHECK, GEOFENCE_ENTRY, GEOFENCE_EXIT
    result VARCHAR(50) NOT NULL, -- INSIDE, OUTSIDE, UNKNOWN, LOCATION_DENIED, LOCATION_UNAVAILABLE, LOW_ACCURACY, ERROR
    latitude DECIMAL(10,8) CHECK (latitude >= -90 AND latitude <= 90),
    longitude DECIMAL(11,8) CHECK (longitude >= -180 AND longitude <= 180),
    accuracy_meters DECIMAL(10,2) CHECK (accuracy_meters IS NULL OR accuracy_meters >= 0),
    distance_from_office_meters DECIMAL(10,2) CHECK (distance_from_office_meters IS NULL OR distance_from_office_meters >= 0),
    geofence_radius_meters INTEGER CHECK (geofence_radius_meters IS NULL OR geofence_radius_meters > 0),
    verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    source VARCHAR(50) NOT NULL, -- WEB, MOBILE, SYSTEM
    failure_reason TEXT,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. EMPLOYEE LIVE LOCATIONS
CREATE TABLE employee_live_locations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID UNIQUE NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    attendance_id UUID REFERENCES attendance(id) ON DELETE SET NULL,
    office_id UUID REFERENCES offices(id) ON DELETE SET NULL,
    latitude DECIMAL(10,8) NOT NULL CHECK (latitude >= -90 AND latitude <= 90),
    longitude DECIMAL(11,8) NOT NULL CHECK (longitude >= -180 AND longitude <= 180),
    accuracy_meters DECIMAL(10,2) CHECK (accuracy_meters IS NULL OR accuracy_meters >= 0),
    distance_from_office_meters DECIMAL(10,2) CHECK (distance_from_office_meters IS NULL OR distance_from_office_meters >= 0),
    location_status VARCHAR(50) NOT NULL, -- INSIDE_GEOFENCE, OUTSIDE_GEOFENCE, LOCATION_UNAVAILABLE, LOCATION_DENIED, LOW_ACCURACY, WFH, OFFLINE
    location_context VARCHAR(50) NOT NULL, -- OFFICE, WFH, UNKNOWN
    is_tracking BOOLEAN NOT NULL DEFAULT false,
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    source VARCHAR(50) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. EMPLOYEE LOCATION HISTORY
CREATE TABLE employee_location_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    attendance_id UUID REFERENCES attendance(id) ON DELETE SET NULL,
    office_id UUID REFERENCES offices(id) ON DELETE SET NULL,
    latitude DECIMAL(10,8) NOT NULL CHECK (latitude >= -90 AND latitude <= 90),
    longitude DECIMAL(11,8) NOT NULL CHECK (longitude >= -180 AND longitude <= 180),
    accuracy_meters DECIMAL(10,2) CHECK (accuracy_meters IS NULL OR accuracy_meters >= 0),
    distance_from_office_meters DECIMAL(10,2) CHECK (distance_from_office_meters IS NULL OR distance_from_office_meters >= 0),
    location_status VARCHAR(50) NOT NULL,
    location_context VARCHAR(50) NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    source VARCHAR(50) NOT NULL,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. GEOFENCE EVENTS
CREATE TABLE geofence_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    attendance_id UUID REFERENCES attendance(id) ON DELETE SET NULL,
    office_id UUID REFERENCES offices(id) ON DELETE SET NULL,
    event_type VARCHAR(50) NOT NULL, -- ENTERED, EXITED
    latitude DECIMAL(10,8) CHECK (latitude >= -90 AND latitude <= 90),
    longitude DECIMAL(11,8) CHECK (longitude >= -180 AND longitude <= 180),
    distance_from_office_meters DECIMAL(10,2) CHECK (distance_from_office_meters IS NULL OR distance_from_office_meters >= 0),
    geofence_radius_meters INTEGER CHECK (geofence_radius_meters IS NULL OR geofence_radius_meters > 0),
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    source VARCHAR(50) NOT NULL,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- TIMESTAMPS TRIGGERS
CREATE TRIGGER update_employee_live_locations_updated_at BEFORE UPDATE ON employee_live_locations FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- INDEXES
CREATE INDEX idx_location_verification_events_employee ON location_verification_events(employee_id);
CREATE INDEX idx_location_verification_events_attendance ON location_verification_events(attendance_id);
CREATE INDEX idx_location_verification_events_office ON location_verification_events(office_id);
CREATE INDEX idx_location_verification_events_type ON location_verification_events(verification_type);
CREATE INDEX idx_location_verification_events_result ON location_verification_events(result);
CREATE INDEX idx_location_verification_events_verified_at ON location_verification_events(verified_at);

CREATE INDEX idx_employee_live_locations_employee ON employee_live_locations(employee_id);
CREATE INDEX idx_employee_live_locations_attendance ON employee_live_locations(attendance_id);
CREATE INDEX idx_employee_live_locations_office ON employee_live_locations(office_id);
CREATE INDEX idx_employee_live_locations_status ON employee_live_locations(location_status);
CREATE INDEX idx_employee_live_locations_last_seen ON employee_live_locations(last_seen_at);

CREATE INDEX idx_employee_location_history_employee ON employee_location_history(employee_id);
CREATE INDEX idx_employee_location_history_attendance ON employee_location_history(attendance_id);
CREATE INDEX idx_employee_location_history_office ON employee_location_history(office_id);
CREATE INDEX idx_employee_location_history_recorded_at ON employee_location_history(recorded_at);

CREATE INDEX idx_geofence_events_employee ON geofence_events(employee_id);
CREATE INDEX idx_geofence_events_attendance ON geofence_events(attendance_id);
CREATE INDEX idx_geofence_events_office ON geofence_events(office_id);
CREATE INDEX idx_geofence_events_type ON geofence_events(event_type);
CREATE INDEX idx_geofence_events_occurred_at ON geofence_events(occurred_at);

-- ROW LEVEL SECURITY (RLS)
ALTER TABLE location_verification_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_live_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_location_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE geofence_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated users to read location_verification_events" ON location_verification_events FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated users to read employee_live_locations" ON employee_live_locations FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated users to read employee_location_history" ON employee_location_history FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated users to read geofence_events" ON geofence_events FOR SELECT TO authenticated USING (true);

