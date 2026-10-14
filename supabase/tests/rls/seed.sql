-- Synthetic test data only.
-- roles ADMIN/HR/EMPLOYEE are created by the migrations; re-key them to fixed ids for the tests
UPDATE roles SET id='00000000-0000-0000-0000-0000000000a1' WHERE name='ADMIN';
UPDATE roles SET id='00000000-0000-0000-0000-0000000000a2' WHERE name='HR';
UPDATE roles SET id='00000000-0000-0000-0000-0000000000a3' WHERE name='EMPLOYEE';
-- auth users
INSERT INTO auth.users (id, email) VALUES
 ('11111111-1111-1111-1111-111111111111','realadmin@example.com'),
 ('22222222-2222-2222-2222-222222222222','hr@example.com'),
 ('33333333-3333-3333-3333-333333333333','emp@example.com'),
 ('44444444-4444-4444-4444-444444444444','admin@gmail.com'),
 ('55555555-5555-5555-5555-555555555555','emp2@example.com');
INSERT INTO employees (id, employee_code, first_name, last_name, email, joining_date, role_id, status, phone, date_of_birth) VALUES
 ('e1111111-1111-1111-1111-111111111111','A-1','Real','Admin','realadmin@example.com','2026-01-01','00000000-0000-0000-0000-0000000000a1','ACTIVE','900','1980-01-01'),
 ('e2222222-2222-2222-2222-222222222222','H-1','Hana','HR','hr@example.com','2026-01-01','00000000-0000-0000-0000-0000000000a2','ACTIVE','901','1985-01-01'),
 ('e3333333-3333-3333-3333-333333333333','E-1','Eli','Emp','emp@example.com','2026-01-01','00000000-0000-0000-0000-0000000000a3','ACTIVE','902','1990-01-01'),
 ('e5555555-5555-5555-5555-555555555555','E-2','Eva','Two','emp2@example.com','2026-01-01','00000000-0000-0000-0000-0000000000a3','ACTIVE','903','1991-01-01');
INSERT INTO profiles (id, auth_user_id, employee_id, role_id, is_active) VALUES
 ('f1111111-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111111','e1111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-0000000000a1',true),
 ('f2222222-2222-2222-2222-222222222222','22222222-2222-2222-2222-222222222222','e2222222-2222-2222-2222-222222222222','00000000-0000-0000-0000-0000000000a2',true),
 ('f3333333-3333-3333-3333-333333333333','33333333-3333-3333-3333-333333333333','e3333333-3333-3333-3333-333333333333','00000000-0000-0000-0000-0000000000a3',true),
 ('f5555555-5555-5555-5555-555555555555','55555555-5555-5555-5555-555555555555','e5555555-5555-5555-5555-555555555555','00000000-0000-0000-0000-0000000000a3',true);
-- NOTE: admin@gmail.com (4444...) deliberately has NO profile: models the "deleted account re-registered by a stranger" case.
-- One shift assignment for the EMPLOYEE (used by the shift_assignments visibility tests).
INSERT INTO shift_templates (id, name, code, shift_type, start_time, end_time, required_hours)
VALUES ('5a000000-0000-0000-0000-000000000001','Test General','TST-GEN','FIXED','09:00','18:00',8);
INSERT INTO shift_assignments (employee_id, shift_template_id, effective_date, assignment_type)
VALUES ('e3333333-3333-3333-3333-333333333333','5a000000-0000-0000-0000-000000000001','2026-10-01','PERMANENT');
