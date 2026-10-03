# QA Test Cases - WorkPulse HR (Fresh Cycle)

| Test ID | Module | Title | Category | Status |
|---|---|---|---|---|
| AUTH-001 | Authentication | Admin valid login | FUNCTIONAL | NOT TESTED |
| AUTH-002 | Authentication | Employee valid login | FUNCTIONAL | NOT TESTED |
| AUTH-003 | Authentication | Invalid credentials rejection | SECURITY | NOT TESTED |
| RBAC-001 | RBAC | Admin can access settings | SECURITY | NOT TESTED |
| RBAC-002 | RBAC | Employee denied settings access | SECURITY | NOT TESTED |
| EMP-001 | Employee | Create new employee profile | FUNCTIONAL | NOT TESTED |
| EMP-002 | Employee | View employee list (Admin) | FUNCTIONAL | NOT TESTED |
| DEP-001 | Departments | Create new department | FUNCTIONAL | NOT TESTED |
| OFF-001 | Offices | Create new office with geofence | FUNCTIONAL | NOT TESTED |
| SET-001 | Admin Settings | Toggle global Face Verification | INTEGRATION | NOT TESTED |
| ATT-001 | Attendance | Clock in successfully within geofence | FUNCTIONAL | NOT TESTED |
| ATT-002 | Attendance | Clock out successfully | FUNCTIONAL | NOT TESTED |
| GEO-001 | Geolocation | Reject clock in outside geofence | SECURITY | NOT TESTED |
| FACE-001 | Face Verification | Reject clock in for unregistered face | SECURITY | NOT TESTED |
| BRK-001 | Break | Start and end break properly | FUNCTIONAL | NOT TESTED |
| SHF-001 | Shifts | Apply custom shift to employee | FUNCTIONAL | NOT TESTED |
| LEV-001 | Leave | Request casual leave (Employee) | FUNCTIONAL | NOT TESTED |
| LEV-002 | Leave | Approve casual leave (Admin) | FUNCTIONAL | NOT TESTED |
| PER-001 | Permission | Request permission for 2 hours | FUNCTIONAL | NOT TESTED |
| WFH-001 | WFH | Request remote work | FUNCTIONAL | NOT TESTED |
| SND-001 | Sandwich | Validate LOP deduction for sandwich leave | BUSINESS RULE | NOT TESTED |
| PAY-001 | Payroll | Generate payroll for valid month | FUNCTIONAL | NOT TESTED |
| PAY-002 | Payroll | Verify LOP/Late deductions in payroll | BUSINESS RULE | NOT TESTED |
| PAY-003 | Payslip | View and download PDF Payslip | FUNCTIONAL | NOT TESTED |
| NOT-001 | Notifications | Trigger realtime notification on leave approve | INTEGRATION | NOT TESTED |
| DB-001 | Database/RLS | Employee cannot view other employee payroll | SECURITY | NOT TESTED |
| DB-002 | Database/RLS | Verify schema relationships | DATABASE | NOT TESTED |
| E2E-001 | E2E | Complete flow: Login -> Clock In -> Break -> Clock Out | E2E | NOT TESTED |
| E2E-002 | E2E | Complete flow: Leave Request -> Approval -> Payroll impact | E2E | NOT TESTED |
| PERF-001 | Performance | Vite Build Time & Output Size | PERFORMANCE | NOT TESTED |
| PERF-002 | Performance | API latency under <500ms | PERFORMANCE | NOT TESTED |
| SEC-001 | Security | Verify no hardcoded secrets in build | SECURITY | NOT TESTED |
