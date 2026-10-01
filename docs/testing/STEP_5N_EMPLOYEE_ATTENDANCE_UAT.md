# End-to-End Employee Attendance UAT (Step 5N)

**Date**: 2026-09-28
**Environment**: Local (Vite, Supabase)
**Scope**: Employee lifecycle and attendance tracking End-to-End validation.

---

### Test Case Execution Summary

| #  | Test Case | Expected Result | Actual Result | Status | Evidence/Notes |
|----|-----------|-----------------|---------------|--------|----------------|
| 1 | **Employee creation** | Admin creates a new employee from the UI, and both a profile record and an `auth.users` authentication record are provisioned. | The UI successfully inserts a record into the `public.employees` table, but there is no mechanism (Edge Function, Database Trigger, or API hook) implemented to create the required `auth.users` identity. | **FAIL** | Code review of `employeeService.ts` and `Employees.tsx` shows only a standard table insert. |
| 2 | **Office assignment** | Admin can successfully associate an employee with a specific office. | The UI properly triggers `employeeService.updateEmployee` setting the `office_id`, storing it in the database. | **PASS** | Tested assigning an office; verified the ID successfully propagates to Supabase. |
| 3 | **Shift assignment** | Admin assigns a valid shift template to an employee. | The UI displays a toast reading `"Shift assigned locally (API pending)"` and does not persist to `shift_assignments` table in Supabase. | **FAIL** | Implementation explicitly marked as deferred in `Employees.tsx` line 160. |
| 4 | **Employee login** | Newly created employee logs into the system to access their dashboard. | Unable to log in. No `auth.users` record was created by step 1. Manual Supabase CLI/Node script registration failed due to Supabase project Email Rate Limits (`status: 429`). | **BLOCKED** | Blocked by missing auth integration (Test 1) and Supabase rate limits on manual workarounds. |
| 5 | **Role protection** | Employee account cannot access admin routes. | Cannot log in as an employee. | **BLOCKED** | Blocked by Test 4. |
| 6 | **GPS permission** | Browser requests Geolocation upon opening Dashboard. | Cannot access Employee Dashboard. | **BLOCKED** | Blocked by Test 4. |
| 7 | **Inside geofence** | Clock in is permitted when coordinates match office radius. | Cannot test natively. | **BLOCKED** | Blocked by Test 4. |
| 8 | **Outside geofence** | Clock in is denied outside office radius. | Cannot test natively. | **BLOCKED** | Blocked by Test 4. |
| 9 | **Face verification** | Triggers facial verification prior to Clock-In/Out. | The underlying `faceService.ts` logs indicate `"Real face provider configuration is pending. (Provider NOT_CONFIGURED)."`. The system defaults to a bypass simulator. | **BLOCKED** | Face Provider Not Configured. |
| 10 | **Clock In** | Valid location and face verification results in an `attendance` table record. | Cannot access Employee Dashboard without an account. | **BLOCKED** | Blocked by Test 4. |
| 11 | **Duplicate Clock In** | Subsequent clock-in attempts are rejected gracefully. | Cannot test natively. | **BLOCKED** | Blocked by Test 4. |
| 12 | **Break** | Break events are recorded to `attendance_breaks`. | Cannot test natively. | **BLOCKED** | Blocked by Test 4. |
| 13 | **Clock Out** | Validates location/face and signs off active attendance record. | Cannot test natively. | **BLOCKED** | Blocked by Test 4. |
| 14 | **Duplicate Clock Out** | Prevented gracefully. | Cannot test natively. | **BLOCKED** | Blocked by Test 4. |
| 15 | **Attendance history** | Shows accurate daily attendance details. | Cannot test natively. | **BLOCKED** | Blocked by Test 4. |
| 16 | **Admin realtime attendance** | Admin views real-time status updates without manual reload. | Cannot trigger employee events. | **BLOCKED** | Blocked by Test 4. |
| 17 | **Live tracking** | GPS tracking periodically updates `employee_live_locations`. | Cannot test natively. | **BLOCKED** | Blocked by Test 4. |
| 18 | **Geofence events** | Records geofence transitions to `geofence_events`. | Cannot test natively. | **BLOCKED** | Blocked by Test 4. |
| 19 | **WFH** | Exempted from office geofence checks if WFH is approved. | Cannot test natively. | **BLOCKED** | Blocked by Test 4. |
| 20 | **RLS/security** | Supabase data policies prevent cross-tenant/unauthorized access. | RLS policies are physically present in `0009_security_hardening.sql` properly restricting access via `public.get_auth_role()`. | **PASS** | Verified via SQL migration file code review. |
| 21 | **Responsive testing** | Employee Dashboard scales cleanly to mobile dimensions. | Cannot test natively. | **BLOCKED** | Blocked by Test 4. |
| 22 | **Build/typecheck/lint** | `npm run build` succeeds without TS issues. | Encountered JSX errors in previous step; successfully patched. Final `npm run build` exits with code `0`. | **PASS** | Logs confirmed. |

---

### Final Summary

- **Passed tests**: 3 (Office Assignment, RLS policies, Build Validation)
- **Failed tests**: 2 (Employee creation, Shift assignment API)
- **Blocked tests**: 17
- **Remaining issues**:
  - The application lacks a mechanism to automatically provision Supabase Auth credentials when an Admin adds an employee from the UI. Without this, employees cannot log in.
  - Shift assignment from the Admin UI is completely mocked out ("API Pending").
  - The biometric/face verification module is not bound to a real provider and defaults to an unsecure simulator.
- **Exact next action**:
  - Implement a Supabase Edge Function (or Admin Service Role API backend) to handle creating both the `auth.users` credential and `public.employees` profile simultaneously during Admin -> Add Employee.
  - Implement the API binding for `handleAssignShift` in `Employees.tsx` to communicate with the `shift_assignments` table.
