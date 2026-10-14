# WorkPulse - HR Management System

A full-stack, role-based HR platform built with **React 19 + TypeScript + Vite** on the frontend and **Supabase** (PostgreSQL + Row-Level Security) on the backend. Designed for mobile-first deployment via **Capacitor (Android)** and progressive web app (PWA) support.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Tech Stack](#2-tech-stack)
3. [Roles and Access Control](#3-roles-and-access-control)
4. [Completed Features](#4-completed-features)
   - 4.1 [Authentication and Security](#41-authentication-and-security)
   - 4.2 [Admin Portal](#42-admin-portal)
   - 4.3 [Employee Portal](#43-employee-portal)
   - 4.4 [Attendance System](#44-attendance-system)
   - 4.5 [Break Management](#45-break-management)
   - 4.6 [Shift and Roster System](#46-shift-and-roster-system)
   - 4.7 [Leave Management](#47-leave-management)
   - 4.8 [WFH Work From Home](#48-wfh-work-from-home)
   - 4.9 [Permission Management](#49-permission-management)
   - 4.10 [Overtime Management](#410-overtime-management)
   - 4.11 [Payroll System](#411-payroll-system)
   - 4.12 [Live Tracking](#412-live-tracking)
   - 4.13 [Face Recognition](#413-face-recognition)
   - 4.14 [Departments and Offices](#414-departments-and-offices)
   - 4.15 [Notifications](#415-notifications)
   - 4.16 [Reports and Export](#416-reports-and-export)
   - 4.17 [Audit Logs](#417-audit-logs)
   - 4.18 [Settings](#418-settings)
5. [Database Schema](#5-database-schema)
6. [Project Architecture](#6-project-architecture)
7. [Service Layer](#7-service-layer)
8. [Testing](#8-testing)
9. [Environment Setup](#9-environment-setup)
10. [Scripts and Utilities](#10-scripts-and-utilities)
11. [Deployment](#11-deployment)

---

## 1. Project Overview

**WorkPulse** is an enterprise-grade HR Management System that handles the full employee lifecycle from clock-in/clock-out and shift scheduling to payroll processing, leave approvals, and real-time GPS tracking. It supports three distinct user roles with separate portals, all backed by Supabase Row-Level Security (RLS) policies to ensure strict data isolation.

---

## 2. Tech Stack

| Layer | Technology |
|---|---|
| **Frontend Framework** | React 19 with TypeScript |
| **Build Tool** | Vite 8 |
| **Routing** | React Router DOM v7 |
| **Backend / Database** | Supabase (PostgreSQL + Auth + Storage + Realtime) |
| **Styling** | Vanilla CSS (custom design system in App.css, index.css, responsive.css) |
| **Icons** | Lucide React |
| **PDF Generation** | jsPDF + jspdf-autotable |
| **Excel Export** | SheetJS (xlsx) |
| **Maps** | Leaflet.js + Google Maps JS API Loader |
| **Mobile** | Capacitor v8 (Android) |
| **Push Notifications** | Capacitor Push Notifications |
| **PWA** | vite-plugin-pwa |
| **Linting** | OXLint |
| **Unit Testing** | Vitest |
| **E2E Testing** | Playwright |

---

## 3. Roles and Access Control

WorkPulse enforces three canonical roles. Every client-side check goes through `src/lib/roles.ts`, mirroring the Supabase RLS `get_auth_role()` function.

| Role | Portal | Capabilities |
|---|---|---|
| `ADMIN` | `/admin/*` | Full access to all modules, employee management, payroll, settings |
| `HR` | `/admin/*` | All admin features except system-level settings |
| `EMPLOYEE` | `/employee/*` | Self-service: attendance, leave, WFH, permission, overtime, payroll, payslip, profile |

**Role Aliases Supported:** `SYSTEM ADMIN -> ADMIN`, `HR MANAGER -> HR`, `HR/STAFF -> HR`

---

## 4. Completed Features

### 4.1 Authentication and Security

- **Login Page** (`/login`) - Email/password authentication via Supabase Auth with animated UI
- **Reset Password** (`/reset-password`) - Supabase magic-link password reset flow
- **Change Password** (`/change-password`) - Post-login forced password change
- **Protected Routes** - `ProtectedRoute` component wraps all portals; redirects unauthorised users to `/login`
- **Auth Context** (`AuthContext.tsx`) - Global auth state with session persistence, role resolution, and auto-redirect
- **Theme Context** (`ThemeContext.tsx`) - Light/dark mode support across the app
- **Error Boundary** (`ErrorBoundary.tsx`) - Top-level React error boundary for graceful crash handling
- **RLS-hardened database** - 32 migration files enforce row-level security on every table

---

### 4.2 Admin Portal

All routes prefixed `/admin/*`, accessible by `ADMIN` and `HR` roles.

| Route | Page | Description |
|---|---|---|
| `/admin/dashboard` | Dashboard.tsx | KPI summary cards, attendance overview, real-time counters |
| `/admin/live-tracking` | LiveTracking.tsx | Real-time employee GPS map with Leaflet + activity logs |
| `/admin/employees` | Employees.tsx | Full employee CRUD, salary editor, face registration trigger |
| `/admin/departments` | Departments.tsx | Department management with employee count |
| `/admin/offices` | Offices.tsx | Office/branch management with geofence radius config |
| `/admin/shifts` | Shifts.tsx | Shift template CRUD (name, in/out times, grace period) |
| `/admin/roster` | Roster.tsx | Monthly calendar roster: assign shifts to employees per day |
| `/admin/attendance` | Attendance.tsx | View/filter all attendance records; approve/reject corrections |
| `/admin/breaks` | Breaks.tsx | Monitor all employee break records |
| `/admin/wfh` | Wfh.tsx | Review and approve/reject WFH requests |
| `/admin/leave` | Leave.tsx | Review and approve/reject leave applications |
| `/admin/permission` | Permission.tsx | Review and approve/reject permission requests |
| `/admin/overtime` | Overtime.tsx | Review and approve/reject overtime claims |
| `/admin/payroll` | Payroll.tsx | Full payroll processing, payment safety guards, salary management |
| `/admin/reports` | Reports.tsx | Exportable attendance, payroll and leave reports (PDF + Excel) |
| `/admin/notifications` | Notifications.tsx | In-app notification centre with read/unread state |
| `/admin/audit-logs` | AuditLogs.tsx | Immutable audit trail of all admin actions |
| `/admin/settings` | Settings.tsx | App-wide settings (company name, grace periods, payroll rules) |
| `/admin/face-registration` | FaceRegistration.tsx | AWS Rekognition face enrolment for employees |

---

### 4.3 Employee Portal

All routes prefixed `/employee/*`, accessible by `EMPLOYEE` role only.

| Route | Page | Description |
|---|---|---|
| `/employee/dashboard` | Dashboard.tsx | Personal attendance stats, recent activity, quick-action buttons |
| `/employee/attendance` | Attendance.tsx | Clock in/out with geofence + face verification, attendance history |
| `/employee/breaks` | Breaks.tsx | Start/end breaks, view break history and durations |
| `/employee/wfh` | Wfh.tsx | Submit, view and track WFH requests |
| `/employee/leave` | Leave.tsx | Apply for leave, view leave balance, track approval status |
| `/employee/permission` | Permission.tsx | Submit short-duration permission requests |
| `/employee/overtime` | Overtime.tsx | Log overtime hours with reason, track admin approval |
| `/employee/payroll` | Payroll.tsx | View current month payroll summary |
| `/employee/payslip` | Payslip.tsx | Download payslips as PDF for any period |
| `/employee/profile` | Profile.tsx | View and update personal profile |
| `/employee/notifications` | Notifications.tsx | Personal notification feed |

---

### 4.4 Attendance System

**Core Services:** `src/services/attendance/`

- **Clock In / Clock Out** - Geofence-enforced (office radius check), face-verification gate before clocking
- **Auto Clock-Out** - Supabase scheduled function auto-closes unclosed sessions at midnight
- **Shift-Aware Rules** (`adminAttendanceRules.ts`) - Late/early arrival classification relative to assigned shift time with configurable grace period
- **Attendance Cards** (`employeeAttendanceCards.ts`) - Summary card data (days present, absent, late, WFH, leave)
- **Employee Dashboard Rules** (`employeeDashboardRules.ts`) - Streak counters, working-hours trend, personal KPIs
- **Admin Records** (`adminAttendanceService.ts`) - Paginated admin view with multi-field filtering
- **KPI Detail Modal** (`components/attendance/KpiDetailModal.tsx`) - Drill-down modal for dashboard KPI cards
- **Records Modal** (`components/common/RecordsModal.tsx`) - Reusable records table modal with pagination

---

### 4.5 Break Management

**Core Service:** `src/services/attendance/breakService.ts`

- **Break Rules** (`breakRules.ts`) - Maximum break count and duration enforcement per shift policy
- **Break Summary Rules** (`breakSummaryRules.ts`) - Aggregated break totals per day/week
- **Auto Break** - Rule engine for automatic break deduction when policy requires
- **Admin Breaks Page** - Full tabular view of all employee breaks with date/employee filters
- **Employee Breaks Page** - Start/stop break timer, personal history with total duration

---

### 4.6 Shift and Roster System

**Core Services:** `src/services/shifts/`

- **Shift Templates** (`shiftService.ts`) - Create/edit named shifts with start_time, end_time, grace_minutes
- **Shift Assignments** (`shiftAssignmentRules.ts`) - Assign templates to employees; supports bulk assignment
- **Monthly Roster** (`rosterService.ts`) - Calendar-based roster: each cell is an employee x date with an assigned shift or day-off
- **Roster Persistence** - Roster rows survive employee reassignments
- **Employee Roster RLS** - Employees can read their own roster rows only
- **Roster Card Rules** (`rosterCardRules.ts`) - Summary counts: working days, offs, unassigned per month
- **Roster Dates** (`rosterDates.ts`) - Utility to enumerate working/holiday dates in a month range

---

### 4.7 Leave Management

**Core Service:** `src/services/leave/leaveService.ts`

- Submit leave with type (Annual, Sick, Casual, etc.), date range, and reason
- Admin approval/rejection with comment
- Leave balance tracking (allocated vs. consumed)
- Employee view: pending, approved, rejected filter tabs
- Admin Rules (`leaveAdminRules.ts`) - Overlap detection, balance enforcement, summary aggregation
- Request Timeline component (`RequestTimeline.tsx`) - Visual approval-step stepper

---

### 4.8 WFH Work From Home

**Service:** `src/services/wfh/`

- WFH request with date, reason, and expected tasks
- Admin review queue with bulk approve/reject
- RLS-protected: Employees can only see and manage their own WFH records
- Employee WFH page shows request history and current status badge

---

### 4.9 Permission Management

**Service:** `src/services/permission/`

- Short-duration permission requests (e.g., leave office from 14:00-15:00)
- Admin approval queue
- Employee view with approval status and history

---

### 4.10 Overtime Management

**Service:** `src/services/overtime/`

- Employee logs overtime date, hours, and justification
- Admin approves/rejects with an optional comment
- Approved overtime feeds into payroll calculation
- Admin Overtime page displays all requests with status filter
- Employee Overtime page shows personal log and approval status

---

### 4.11 Payroll System

**Core Services:** `src/services/payroll/` (19 files)

| File | Purpose |
|---|---|
| `payrollService.ts` | Master payroll engine - generates monthly payroll per employee |
| `payrollRules.ts` | Deduction/addition rules (late deductions, OT additions, leave adjustments) |
| `payrollDataService.ts` | Aggregates raw attendance/leave/OT data for payroll computation |
| `salaryService.ts` | Employee salary CRUD (base salary, allowances, deductions) |
| `payrollSettingsService.ts` | Company-wide payroll config (payable days, rounding, OT multiplier) |
| `attendanceClassification.ts` | Classifies each attendance day as Present/Absent/Late/Half-day for payroll |
| `dailyMetricDetails.ts` | Per-day breakdown of hours, deductions, and OT bonuses |
| `payrollAuditService.ts` | Logs every payroll run and change for audit trail |
| `payslipService.ts` | Generates payslip data structures for PDF rendering |
| `payrollCardRules.ts` | KPI card data: total payable, total deductions, headcount |

**Admin Payroll Page features:**

- Month picker with per-employee payroll table
- Payment safety guards (double-payment prevention)
- Mark individual employees as paid
- Salary Editor modal
- Daily metric drill-down modal
- Payslip preview and PDF export

**Employee Payroll and Payslip Pages:**

- Monthly summary with deduction breakdown
- Payslip download as PDF per month

---

### 4.12 Live Tracking

**Core Services:** `src/services/location/` (12 files)

- **Real-time GPS** - Employees broadcast location via Supabase Realtime
- **Geofence Stability** (`geofenceStability.ts`) - Debounce logic to avoid rapid in/out geofence flapping
- **Location Rules** (`locationRules.ts`) - Classify location as in office, out of office, or en route
- **Live Tracking Rules** (`liveTrackingRules.ts`) - Status aggregation: active, idle, offline per employee
- **Live Activity Logs** (`liveActivityRules.ts`) - Timestamped location event log per employee
- **Location Autocomplete** (`locationAutocomplete.ts`) - Google Maps Places API autocomplete for office address setup
- **Leaflet Live Map** (`components/tracking/LeafletLiveMap.tsx`) - OpenStreetMap map with employee markers and office circle overlay
- **Live Activity Component** (`components/tracking/LiveActivityLogs.tsx`) - Scrollable activity log panel
- **Live Tracking KPI Modal** (`components/tracking/LiveTrackingKpiModal.tsx`) - Per-employee stats: today distance, time in office, time out

---

### 4.13 Face Recognition

**Core Service:** `src/services/face/faceService.ts`

- **Provider** (`faceVerificationProvider.ts`) - AWS Rekognition integration for face comparison
- **Face Registration Page** (`admin/FaceRegistration.tsx`) - Webcam capture + upload to AWS for employee enrolment
- **Verification Gate** - Face match required before clock-in is accepted
- **Setup Script** (`setup_face_aws.cjs`) - AWS Rekognition collection initialisation and IAM role guide
- **Database Schema** - face_embeddings table with encrypted storage

---

### 4.14 Departments and Offices

**Departments** (`admin/Departments.tsx`):

- Full CRUD with employee count per department
- RLS: Only admins can mutate department records

**Offices** (`admin/Offices.tsx`):

- Branch/office CRUD with GPS coordinates and geofence radius (in meters)
- Address autocomplete via Google Maps Places API
- Progressive RLS hardening across multiple migrations

---

### 4.15 Notifications

**Core Services:** `src/services/notifications/`

| File | Purpose |
|---|---|
| `notificationService.ts` | CRUD for in-app notifications; mark as read, delete |
| `notificationRules.ts` | Rules for which events trigger which notification types |
| `pushNotificationService.ts` | Capacitor Push Notifications integration for mobile |

- Postgres trigger fires push notification on new record insert
- Device tokens table stores FCM/APNS tokens per user
- Shared Notifications Page for both admin and employee portals
- Mark individual or all-read, delete, filter by type and read status

---

### 4.16 Reports and Export

**Core Services:** `src/services/reports/` + `src/services/export/`

- Report types: Attendance Summary, Leave Analysis, Payroll Summary, Overtime Report
- Date range picker
- **Export to PDF** via jsPDF + autotable
- **Export to Excel** via SheetJS (xlsx)

---

### 4.17 Audit Logs

**Core Service:** `src/services/audit/`

- Immutable audit log table - records actor, action, target, timestamp
- Payroll-specific audit writes via `payrollAuditService.ts`
- Admin Audit Logs Page: searchable and filterable log table, filter by action type, date range, actor

---

### 4.18 Settings

**Core Service:** `src/services/settings/`

- Key-value app settings table for company-wide configuration
- RLS: Only admin roles can update settings
- Persisted Setting Toggle component syncs to app_settings table

**Admin Settings Page covers:**

- Company name and logo
- Default grace period for late arrivals
- Payroll configuration (OT multiplier, payable days per month, rounding mode)
- Face verification toggle
- Auto clock-out toggle
- Geofence radius defaults

---

## 5. Database Schema

WorkPulse uses 32 sequential Supabase migrations:

| Migration | Description |
|---|---|
| `0001_core_schema.sql` | profiles, roles, departments, offices tables |
| `0002_shift_roster_schema.sql` | shift_templates, shift_assignments, roster tables |
| `0003_attendance_break_schema.sql` | attendance_records, break_records tables |
| `0004_wfh_leave_permission_schema.sql` | wfh_requests, leave_requests, permission_requests tables |
| `0005_salary_payroll_payslip_schema.sql` | salaries, payroll_records, payslips tables |
| `0006_face_security_schema.sql` | face_embeddings table |
| `0007_location_live_tracking_schema.sql` | location_logs, live_tracking realtime table |
| `0008_notifications_audit_schema.sql` | notifications, audit_logs tables |
| `0009_security_hardening.sql` | Comprehensive RLS policies for all tables |
| `0010-0014` | Targeted RLS fixes for offices, shift assignments |
| `0015_auto_clock_out.sql` | Cron job for automatic midnight clock-out |
| `0015_resolve_employee_email.sql` | Helper function to resolve employee emails from auth |
| `20260929-20261012` | Incremental RLS patches, payroll extensions, realtime, push notifications, roster persistence |

---

## 6. Project Architecture

```
src/
├── App.tsx                  # Root router with lazy-loaded routes
├── ErrorBoundary.tsx        # Top-level error catcher
├── main.tsx                 # React DOM entry point
├── App.css / index.css      # Global design system and tokens
├── responsive.css           # Breakpoint-based responsive overrides
│
├── context/
│   ├── AuthContext.tsx      # Auth state, role, session management
│   └── ThemeContext.tsx     # Dark/light mode
│
├── lib/
│   ├── roles.ts             # Canonical role constants and helpers
│   ├── routeAccess.ts       # Route permission matrix
│   ├── config.ts            # App-level config constants
│   └── supabase.ts          # Supabase client initialisation
│
├── hooks/
│   └── useDepartments.ts    # Department data fetching hook
│
├── types/
│   └── database.ts          # Full TypeScript types for all DB tables (40 KB)
│
├── components/
│   ├── layout/              # AppLayout, Header, Sidebar, ProtectedRoute
│   ├── attendance/          # KpiDetailModal
│   ├── common/              # RecordsModal (reusable table modal)
│   ├── maps/                # LiveTrackingMap
│   ├── tracking/            # LeafletLiveMap, LiveActivityLogs, LiveTrackingKpiModal
│   ├── payroll/             # DailyMetricModal
│   ├── requests/            # RequestTimeline (approval stepper)
│   ├── settings/            # PersistedSettingToggle
│   ├── auth/                # Auth-related sub-components
│   ├── PayslipDocument.tsx  # PDF-renderable payslip component
│   ├── SalaryEditor.tsx     # Inline salary edit modal
│   └── QaControlPanel.tsx   # QA/dev panel (hidden in production)
│
├── pages/
│   ├── Login.tsx / ResetPassword.tsx / ChangePassword.tsx
│   ├── Notifications.tsx    # Shared notification page
│   ├── admin/               # 18 admin-specific pages
│   └── employee/            # 10 employee self-service pages
│
└── services/                # Business logic layer (pure functions + Supabase calls)
    ├── attendance/          # 19 files: clock rules, break rules, dashboard rules
    ├── payroll/             # 19 files: payroll engine, rules, audit
    ├── location/            # 12 files: GPS, geofence, live tracking
    ├── shifts/              # 14 files: shift templates, roster, assignment rules
    ├── leave/               # 3 files: leave service and admin rules
    ├── notifications/       # 4 files: in-app and push notifications
    ├── reports/             # 5 files: report aggregation and export
    ├── face/                # 2 files: AWS Rekognition integration
    ├── settings/            # App settings service
    ├── wfh/                 # WFH service
    ├── permission/          # Permission service
    ├── overtime/            # Overtime service
    ├── employees/           # Employee CRUD service
    ├── department/          # Department service
    ├── audit/               # Audit log writes
    ├── realtime/            # Supabase realtime subscription helpers
    ├── export/              # PDF/Excel export utilities
    ├── qa/                  # QA control helpers
    └── supabase/            # Supabase admin client helpers
```

---

## 7. Service Layer

The service layer is intentionally separated from UI components. Each service directory follows a consistent pattern:

- `*Service.ts` - Primary Supabase data operations (fetch, insert, update, delete)
- `*Rules.ts` - Pure business logic functions with no I/O (easily unit-tested)
- `*.test.ts` - Vitest unit tests covering rules with real edge cases

This separation means payroll calculations, leave validation, and break rules can all be tested without a Supabase connection.

---

## 8. Testing

### Unit Tests (Vitest)

Run with: `npm test`

Tests are co-located alongside service files:

| Test File | Coverage |
|---|---|
| `attendanceServiceShift.test.ts` | Shift-aware clock-in/out rules |
| `adminAttendanceRules.test.ts` | Late/early classification, grace periods |
| `breakRules.test.ts` | Break count/duration enforcement |
| `breakSummaryRules.test.ts` | Daily/weekly break aggregation |
| `autoBreakRules.test.ts` | Automatic break deduction |
| `clockRules.test.ts` | Clock validation edge cases |
| `currentAttendance.test.ts` | Active session detection |
| `employeeAttendanceCards.test.ts` | Card summary calculations |
| `employeeDashboardRules.test.ts` | Dashboard KPI computations |
| `attendanceClassification.test.ts` | Payroll attendance day classification |
| `dailyMetricDetails.test.ts` | Per-day payroll metric breakdown |
| `payrollRules.test.ts` | Deduction/addition rule engine |
| `payrollCardRules.test.ts` | Payroll KPI card values |
| `payrollClientRules.test.ts` | Client-side payroll display rules |
| `payrollDailyRate.test.ts` | Daily rate calculation |
| `payrollDailyReport.test.ts` | Daily payroll report aggregation |
| `payrollDataService.test.ts` | Payroll data fetch and shape |
| `payrollPaymentSafety.test.ts` | Double-payment prevention guards |
| `liveTrackingRules.test.ts` | GPS status classification |
| `liveActivityRules.test.ts` | Activity log rule engine |
| `locationRules.test.ts` | Geofence in/out rules |
| `rosterService.test.ts` | Roster CRUD operations |
| `rosterRules.test.ts` | Roster business rules |
| `rosterAssignmentFlow.test.ts` | End-to-end assignment workflow |
| `monthlyRosterRules.test.ts` | Monthly summary rules |
| `rosterCardRules.test.ts` | Roster KPI card calculations |
| `rosterDates.test.ts` | Date utility functions |
| `shiftAssignmentRules.test.ts` | Shift assignment validation |
| `reportRules.test.ts` | Report aggregation logic |
| `reportCardRules.test.ts` | Report card KPI rules |
| `notificationRules.test.ts` | Notification trigger rules |
| `leaveAdminRules.test.ts` | Leave approval business logic |
| `roles.test.ts` | Role normalisation and access helpers |
| `routeAccess.test.ts` | Route permission matrix |
| `RecordsModal.test.tsx` | Records modal component rendering |

### E2E Tests (Playwright)

Run with: `npm run test:e2e`

| Test File | Coverage |
|---|---|
| `tests/auto_break_e2e.spec.ts` | Full auto-break clock-in to break to clock-out flow |

---

## 9. Environment Setup

### Prerequisites

- Node.js 20+
- npm 10+
- Supabase project (or local Supabase CLI)

### Installation

```bash
git clone <repo-url>
cd work_pluse-main
npm install
```

### Environment Variables

Copy `.env.example` to `.env` and fill in:

```env
VITE_SUPABASE_URL=https://<your-project>.supabase.co
VITE_SUPABASE_ANON_KEY=<your-anon-key>
```

For QA environment, use `.env.qa.example` as a template.

### Running the Dev Server

```bash
npm run dev
```

App runs at `http://localhost:5173`

### Database Migrations

Apply all migrations to your Supabase project:

```bash
npx supabase db push
```

Or apply individually from `supabase/migrations/` in numbered order.

---

## 10. Scripts and Utilities

| Script | Purpose |
|---|---|
| `seed_qa.js` | Seed QA environment with test employees and attendance records |
| `seed_admin.sql` | Bootstrap the first admin user |
| `create_admin.js` | CLI tool to create an admin account |
| `setup_face_aws.cjs` | AWS Rekognition collection setup for face recognition |
| `patch_attendance.py` | Bulk patch attendance records (data migration) |
| `patch_employees.py` | Bulk patch employee profiles |
| `patch_payroll.py` | Bulk patch payroll records |
| `patch_leave.py` | Bulk patch leave records |
| `patch_wfh.py` | Bulk patch WFH records |
| `patch_roster.py` | Bulk patch roster assignments |
| `patch_live_tracking.py` | Bulk patch live tracking entries |
| `patch_permission.py` | Bulk patch permission records |
| `diagnose_offices_rls.cjs` | Diagnose RLS issues on the offices table |
| `check_admin.cjs` | Verify admin role assignment |
| `clean_db_final.sql` | Full database cleanup script |
| `remove_hardcoded.cjs` | Replace hardcoded values with env vars |

---

## 11. Deployment

### Web (Vercel)

A `vercel.json` is included with SPA rewrite rules. Deploy with:

```bash
npm run build
vercel deploy ./dist
```

### Android (Capacitor)

```bash
npm run build
npx cap sync android
npx cap open android
```

Capacitor config is in `capacitor.config.ts`.

### PWA

PWA support is enabled via `vite-plugin-pwa`. Icons are in the `icons/` and `public/` directories. The app is installable on mobile browsers.

---

## License

Private - All rights reserved.
