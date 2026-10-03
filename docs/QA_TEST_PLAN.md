# QA Test Plan - WorkPulse HR (Fresh Cycle)

## 1. Scope
This test plan covers the completely fresh End-to-End QA cycle for the WorkPulse HR web application. It includes all backend (Supabase/Edge Functions) and frontend (React/Vite) functionalities.

## 2. Objectives
- Validate that all core HR business rules (Payroll, Leave, Attendance) behave according to spec.
- Ensure strict Role-Based Access Control (RLS) is maintained.
- Guarantee the application meets enterprise quality standards for security, performance, and usability.

## 3. Test Levels
- **Component Testing:** Individual UI components.
- **API/Integration Testing:** Supabase Edge Functions and DB interactions.
- **System/End-to-End Testing:** Full user journeys (e.g., complete lifecycle from clock-in to payroll generation).

## 4. Test Types
Functional, API, Database, RLS, Security, Integration, E2E, Regression, Accessibility, Responsive, Cross-Browser, Performance, Load, Stress, Scalability, Capacity, Reliability, Availability, Recoverability, Resource Utilization, Usability, Maintainability, Compatibility, Interoperability, Data Integrity, Portability, Deployment, Observability, UAT, Production Smoke.

## 5. Environment
- **Development/Test:** Vite localhost, staging Supabase project (if available).
- **Target Prod:** Vercel (Frontend), Supabase (Backend/DB).

## 6. Test Data
- Test Admin accounts, HR, and Employee profiles.
- Mock location data for Geofence validation.
- Valid/Invalid face images for AWS Rekognition test.

## 7. Entry Criteria
- Application compiles without errors.
- Test environments are provisioned.
- Fresh cycle artifacts and documentation are approved.

## 8. Exit Criteria
- 100% of defined Test Cases executed.
- 0 CRITICAL or HIGH defects remaining.
- All non-functional metrics (Performance, Security) captured and passed.

## 9. Defect Severity & Lifecycle
- **CRITICAL:** Total outage, security breach, payroll corruption.
- **HIGH:** Major workflow blocked (e.g., Attendance broken).
- **MEDIUM:** Feature partially broken with a workaround.
- **LOW:** Cosmetic, minor UI glitches.
- **Lifecycle:** New -> Assigned -> In Progress -> Fixed -> Retesting -> Closed.

## 10. Evidence Requirements
- Screen recordings / screenshots for UI flows.
- Playwright trace.zips for E2E automation.
- Network HAR files / console logs for API failures.
- No PASS status can be granted without physical test artifacts.

## 11. Release Criteria
- Overall Quality Score >= 85
- Functional Quality >= 90
- Security >= 90
- Reliability >= 85
- Performance >= 85
- Data Integrity >= 95
- Critical defects = 0
- Critical security defects = 0
- High security defects = 0
- Critical E2E workflows PASS
- Production smoke testing PASS
- UAT completed/approved
- No unresolved release-blocking defects
