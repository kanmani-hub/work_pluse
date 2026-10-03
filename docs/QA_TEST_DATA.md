# QA Test Environment & Test Data (Fresh Cycle)

## Environment Used
- Remote Production-Connected Supabase Project (Isolated QA Data Only)
- Safely seeded via programmatic scripts ensuring no destructive DB resets or exposure of service role keys.

## Test Accounts Created (Password: Password123!)
- **QA Admin:** qa.admin@workpulse.test (ID: EMP-QA-ADM)
- **QA HR:** qa.hr@workpulse.test (ID: EMP-QA-HR)
- **QA Employee 1:** qa.employee1@workpulse.test (ID: EMP-QA-001)
- **QA Employee 2:** qa.employee2@workpulse.test (ID: EMP-QA-002)

## Test Data Identifiers
- Department: "QA Department"
- Office: "QA Office"
- Attendance: Inserted programmatically for EMP1 and EMP2 on 2026-10-01.

## Cleanup Status
Data was safely inserted alongside existing records. All QA identifiers begin with `qa.` or `EMP-QA-` for easy future cleanup if requested. Production data was completely untouched.
