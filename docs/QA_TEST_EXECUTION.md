# QA Test Execution (Fresh Cycle)

| Test ID | Test | Expected | Actual | Result | Evidence |
|---|---|---|---|---|---|
| AUTH-003 | Invalid credentials rejection | Invalid login credentials | Invalid login credentials | PASS | node scratch/phase7_test.cjs |
| DB-002 | Verify schema relationships (Existence) | Tables exist | Tables exist | PASS | node scratch/phase7_test.cjs |
| SEC-002 | RLS Blocks ANON on app_settings | Empty/Blocked | Empty (RLS Applied) | PASS | node scratch/phase7_test.cjs |
| SEC-003 | Edge Function unauthorized block | Unauthorized error | Missing Bearer token | PASS | node scratch/phase7_test.cjs |
| DB-001 | Employee cannot view other employee payroll | Blocked by RLS | N/A (Missing Test Data/Auth setup) | BLOCKED | Secret/Configuration Required |
| AUTH-001 | Admin valid login | Success | N/A (Missing Test Data/Auth setup) | BLOCKED | Secret/Configuration Required |
| AUTH-002 | Employee valid login | Success | N/A (Missing Test Data/Auth setup) | BLOCKED | Secret/Configuration Required |
