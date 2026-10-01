-- 0001_core_schema.sql
-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. ROLES TABLE
CREATE TABLE roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) UNIQUE NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. DEPARTMENTS TABLE
CREATE TABLE departments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) UNIQUE NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. OFFICES TABLE
CREATE TABLE offices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    address TEXT,
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    geofence_radius INTEGER DEFAULT 200, -- stored in meters
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. EMPLOYEES TABLE
CREATE TABLE employees (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_code VARCHAR(50) UNIQUE NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    phone VARCHAR(50),
    date_of_birth DATE,
    joining_date DATE NOT NULL,
    department_id UUID REFERENCES departments(id) ON DELETE RESTRICT,
    office_id UUID REFERENCES offices(id) ON DELETE RESTRICT,
    role_id UUID REFERENCES roles(id) ON DELETE RESTRICT,
    designation VARCHAR(255),
    employment_type VARCHAR(50), -- e.g., FULL_TIME, PART_TIME, CONTRACT, INTERN
    status VARCHAR(50) DEFAULT 'ACTIVE', -- e.g., ACTIVE, INACTIVE, ON_NOTICE, TERMINATED
    profile_photo_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. PROFILES TABLE (Links Supabase Auth to Employee & Role)
CREATE TABLE profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    auth_user_id UUID NOT NULL UNIQUE, -- Foreign key conceptually referencing auth.users(id)
    employee_id UUID REFERENCES employees(id) ON DELETE RESTRICT,
    role_id UUID REFERENCES roles(id) ON DELETE RESTRICT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- TIMESTAMPS: Add triggers for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_roles_updated_at BEFORE UPDATE ON roles FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
CREATE TRIGGER update_departments_updated_at BEFORE UPDATE ON departments FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
CREATE TRIGGER update_offices_updated_at BEFORE UPDATE ON offices FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
CREATE TRIGGER update_employees_updated_at BEFORE UPDATE ON employees FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- INDEXES
CREATE INDEX idx_employees_code ON employees(employee_code);
CREATE INDEX idx_employees_email ON employees(email);
CREATE INDEX idx_employees_department_id ON employees(department_id);
CREATE INDEX idx_employees_office_id ON employees(office_id);
CREATE INDEX idx_employees_role_id ON employees(role_id);
CREATE INDEX idx_profiles_auth_user_id ON profiles(auth_user_id);
CREATE INDEX idx_profiles_employee_id ON profiles(employee_id);

-- ROW LEVEL SECURITY (RLS)
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE offices ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Basic RLS Policies
-- For now, allow authenticated users to read core data, but restrict writes.
CREATE POLICY "Allow authenticated users to read roles" ON roles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated users to read departments" ON departments FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated users to read offices" ON offices FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated users to read employees" ON employees FOR SELECT TO authenticated USING (true);

-- Allow users to read their own profile based on auth_user_id
CREATE POLICY "Allow users to read their own profile" ON profiles FOR SELECT TO authenticated USING (auth.uid() = auth_user_id);

-- SEED DATA
INSERT INTO roles (name, description) VALUES
    ('ADMIN', 'System Administrator with full access'),
    ('HR', 'Human Resources with employee management access'),
    ('EMPLOYEE', 'Standard employee access');

INSERT INTO departments (name, description) VALUES
    ('Engineering', 'Software Development and IT'),
    ('HR', 'Human Resources and Operations'),
    ('Finance', 'Accounting and Finance'),
    ('Operations', 'Business Operations');

INSERT INTO offices (name, address, latitude, longitude, geofence_radius) VALUES
    ('Chennai Office', 'Chennai, Tamil Nadu, India', 13.0827, 80.2707, 200);

