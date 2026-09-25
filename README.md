# 🟢 WorkPulse HR — Project Documentation

> A full-featured Human Resource Management System (HRMS) built with **React 19**, **TypeScript**, **Vite**, and **React Router v7**.

---

## 🚀 Tech Stack

| Technology        | Version   | Purpose                        |
|-------------------|-----------|--------------------------------|
| React             | ^19.2.8   | UI Framework                   |
| TypeScript        | ~6.0.2    | Type Safety                    |
| Vite              | ^8.3.0    | Build Tool & Dev Server        |
| React Router DOM  | ^7.18.4   | Client-side Routing            |
| Lucide React      | ^1.48.0   | Icon Library                   |
| Inter (Google Fonts) | —      | Typography                     |

---

## 📁 Project Structure

```
work_pluse/
├── index.html                        # Entry HTML (WorkPulse HR)
├── package.json
├── vite.config.ts
├── tsconfig.json
└── src/
    ├── main.tsx                      # React root mount
    ├── App.tsx                       # Route definitions
    ├── App.css                       # Global component styles
    ├── index.css                     # CSS variables & base tokens
    ├── assets/                       # Static assets
    ├── components/
    │   └── layout/
    │       ├── AppLayout.tsx         # Shared layout wrapper
    │       ├── Sidebar.tsx           # Role-based navigation sidebar
    │       └── Header.tsx            # Top header bar
    └── pages/
        ├── Login.tsx                 # Login page (role selector)
        ├── Notifications.tsx         # Shared notifications page
        ├── admin/                    # 16 Admin/HR pages
        │   ├── Dashboard.tsx
        │   ├── LiveTracking.tsx
        │   ├── Employees.tsx
        │   ├── Departments.tsx
        │   ├── Offices.tsx
        │   ├── Shifts.tsx
        │   ├── Roster.tsx
        │   ├── Attendance.tsx
        │   ├── Wfh.tsx
        │   ├── Leave.tsx
        │   ├── Permission.tsx
        │   ├── Payroll.tsx
        │   ├── Reports.tsx
        │   ├── Settings.tsx
        │   ├── AuditLogs.tsx
        │   └── FaceRegistration.tsx
        └── employee/                 # 7 Employee self-service pages
            ├── Dashboard.tsx
            ├── Attendance.tsx
            ├── Wfh.tsx
            ├── Leave.tsx
            ├── Permission.tsx
            ├── Payroll.tsx
            └── Payslip.tsx
```

---

## 🔐 Authentication & Routing

### Login Page (`/login`)
- Role selector: **Employee**, **HR**, **Admin**
- Employee ID + Password fields with show/hide toggle
- Simulated API call with loading spinner
- Redirects: `employee` → `/employee/dashboard`, `hr`/`admin` → `/admin/dashboard`
- Error handling for empty fields / invalid credentials

### Route Structure

| Role     | Base Path     | Layout                  |
|----------|---------------|-------------------------|
| Admin/HR | `/admin/*`    | `AppLayout` (admin)     |
| Employee | `/employee/*` | `AppLayout` (employee)  |

---

## 🧩 Shared Layout Components

### `AppLayout.tsx`
- Wraps all authenticated pages
- Passes `role` prop (`admin` | `employee`) to sidebar
- Renders `<Header>` + `<Sidebar>` + `<Outlet>`

### `Sidebar.tsx`
- Role-based navigation links
- **Admin menu groups:**
  - **Menu:** Dashboard, Attendance, WFH, Leave, Permissions, Payroll
  - **Administration:** Employees, Departments, Offices, Shifts, Shift Roster, Reports, Settings
- **Employee menu:** Dashboard, My Attendance, WFH Requests, Leave Requests, Permissions, Payslips, My Profile
- Logout button → navigates to `/login`
- Mobile overlay support (`isOpen` state)
- Active link highlighting via `NavLink`

### `Header.tsx`
- Top navigation bar
- Hamburger menu for mobile sidebar toggle
- Notification bell with badge
- User avatar / profile area

---

## 🛡️ Admin / HR Pages (16 Pages)

### 1. 📊 Admin Dashboard (`/admin/dashboard`)
- KPI Cards: Total Employees, Present, WFH, On Leave, Late, Absent, Permissions, Early Departure
- Period filter: Today / This Week / This Month
- Live Employee Status Table — working status, shift, mode (OFFICE/WFH), check-in time, hours worked, break time, location verification
- Employee Detail Drawer on row click
- Pending Approval Panels: WFH, Leave, Permission — with approve/reject + reason modal
- Toast notifications on approve/reject
- Loading skeleton animation on period change

### 📍 Live Tracking (`/admin/live-tracking`)
- Simulated real-time employee monitoring on a CSS-based map
- Monitor current working status, break, WFH, and geofence alerts
- Prototype tracking simulator to dynamically test states

### 2. 👥 Employees (`/admin/employees`)
- Employee list with search, filter by department/status
- Add / Edit / View employee details
- Employee cards with avatar, designation, department, contact info
- Status badges (Active, Inactive, On Leave)

### 3. 🏢 Departments (`/admin/departments`)
- Department list with head and employee count
- Add / Edit / Delete departments
- Department detail with employee listing

### 4. 🏬 Offices (`/admin/offices`)
- Office/branch management
- Add / Edit / Delete office locations
- Location-based attendance zone settings

### 5. ⏰ Shifts (`/admin/shifts`)
- Shift management (Morning, General, Evening, Night)
- Add / Edit / Delete shifts
- Shift timing, break time, grace period configuration
- Employee assignment to shifts

### 6. 📅 Shift Roster (`/admin/roster`)
- Weekly/monthly roster calendar view
- Assign employees to shifts by day
- Bulk shift assignment and export

### 7. 📋 Attendance (`/admin/attendance`)
- Daily attendance records for all employees
- Filter by date, department, status
- Manual check-in / check-out entry
- Attendance status: Present, Absent, Late, Half-Day, WFH
- Export to CSV/Excel

### 8. 🏠 WFH Management (`/admin/wfh`)
- WFH request list with employee details
- Filter by status (Pending, Approved, Rejected)
- Approve / Reject with reason

### 9. 🗓️ Leave Management (`/admin/leave`)
- Leave request list (all employees)
- Leave types: Sick Leave, Casual Leave, Earned Leave, etc.
- Approve / Reject with reason
- Leave balance tracking per employee

### 10. 🕐 Permission Management (`/admin/permission`)
- Late arrival / early departure permission requests
- Filter by date, employee, status
- Approve / Reject workflow

### 11. 💰 Payroll (`/admin/payroll`)
- Monthly payroll processing for all employees
- Salary breakdown: Basic, HRA, Allowances, Deductions, PF, ESI, TDS
- Net pay calculation
- Payroll status: Draft, Processed, Paid
- Bulk payroll generation and pay slip generation

### 12. 📈 Reports (`/admin/reports`)
- Attendance, Leave, WFH, and Payroll reports
- Custom date range filters
- Export functionality (CSV / PDF)
- Charts and analytics

### 13. ⚙️ Settings (`/admin/settings`)
- Company profile settings
- Working days/hours, leave policy, notification preferences
- Timezone and localization configuration

### 14. 📜 Audit Logs (`/admin/audit-logs`)
- System-wide action logs
- Filter by user, action type, date range
- Entries: who did what, when, and from where

### 15. 📷 Face Registration (`/admin/face-registration`)
- Employee face enrollment for biometric attendance
- Camera integration for face capture
- Face data management and registration status tracking

---

## 👤 Employee Self-Service Pages (7 Pages)

### 1. 📊 Employee Dashboard (`/employee/dashboard`)
- Personal KPIs: Today's status, hours worked, leave balance, attendance %
- This month's attendance calendar
- Recent activity feed and pending requests status
- Quick action buttons (Apply Leave, Request WFH, etc.)

### 2. 📋 My Attendance (`/employee/attendance`)
- Personal attendance history with calendar view
- Day-wise status: Present, Absent, Late, Half-Day, WFH
- Check-in/out times, hours worked, overtime
- Monthly summary stats

### 3. 🏠 WFH Requests (`/employee/wfh`)
- Apply new WFH request (date, reason, type: Full/Half Day)
- WFH request history with status tracking
- Cancel pending requests and WFH balance display

### 4. 🗓️ Leave Requests (`/employee/leave`)
- Apply new leave request (type, date range, reason)
- Leave balance per type (Sick, Casual, Earned)
- Leave request history and cancel pending requests

### 5. 🕐 Permissions (`/employee/permission`)
- Apply for late arrival / early departure permission
- Permission history with status, duration, and reason

### 6. 💰 Payroll (`/employee/payroll`)
- Monthly salary summary
- Salary breakdown: earnings vs deductions
- Month-over-month comparison

### 7. 🧾 Payslip (`/employee/payslip`)
- Detailed payslip: Basic Pay, HRA, Allowances, Bonus, PF, ESI, Tax, TDS
- Net Pay calculation
- Print / Download payslip as PDF

---

## 🔔 Notifications (Shared)
- Categorized notifications: Approvals, Rejections, Reminders, Announcements
- Mark as read / unread
- Notification timestamp and type icons

---

## 🎨 Design System

- **Font:** Inter (Google Fonts) — weights 300, 400, 500, 600, 700
- **CSS Variables:** `--primary-600`, `--gray-50` to `--gray-900`, `--success`, `--warning`, `--danger`

| Class               | Usage                               |
|---------------------|-------------------------------------|
| `.card`             | White card container with shadow    |
| `.nav-item`         | Sidebar navigation link             |
| `.nav-item.active`  | Active route highlight              |
| `.sidebar`          | Left sidebar panel                  |
| `.sidebar-overlay`  | Mobile backdrop overlay             |

---

## ▶️ Running the Project

```bash
# Install dependencies
npm install

# Start development server
npm run dev
# → http://localhost:5173

# Build for production
npm run build

# Preview production build
npm run preview

# Lint
npm run lint
```

---

## 📌 Current Status

### ✅ Completed (23 Pages + Layout)

- [x] Project scaffolding (Vite + React 19 + TypeScript)
- [x] Global design system (CSS variables, typography, card/layout classes)
- [x] Login page with role-based routing (Admin / HR / Employee)
- [x] Shared AppLayout with Sidebar & Header
- [x] Role-based sidebar navigation (admin vs employee)
- [x] Mobile responsive sidebar with overlay
- [x] **Admin Dashboard** — KPIs, live status table, pending approvals (WFH/Leave/Permission)
- [x] **Admin Live Tracking** — simulated real-time employee monitoring
- [x] **Admin Employees** — full employee management
- [x] **Admin Departments** — department CRUD
- [x] **Admin Offices** — office/branch management
- [x] **Admin Shifts** — shift configuration
- [x] **Admin Shift Roster** — roster scheduling calendar
- [x] **Admin Attendance** — company-wide attendance tracking
- [x] **Admin WFH** — WFH request management
- [x] **Admin Leave** — leave request management
- [x] **Admin Permission** — permission request management
- [x] **Admin Payroll** — payroll processing
- [x] **Admin Reports** — analytics & exports
- [x] **Admin Settings** — system configuration
- [x] **Admin Audit Logs** — action trail
- [x] **Admin Face Registration** — biometric face enrollment
- [x] **Employee Dashboard** — personal HR summary
- [x] **Employee Attendance** — personal attendance history
- [x] **Employee WFH** — WFH request submission & tracking
- [x] **Employee Leave** — leave application & tracking
- [x] **Employee Permission** — permission requests
- [x] **Employee Payroll** — salary summary
- [x] **Employee Payslip** — detailed pay slip view
- [x] **Notifications** — shared notification center (admin & employee)

### 🔜 Planned / In Progress

- [ ] Employee Profile page (`/employee/profile`) — placeholder only
- [ ] Real backend API integration (currently mock data)
- [ ] Biometric face recognition processing
- [ ] Real-time notifications via WebSocket
- [ ] PDF export for payslips and reports
- [ ] Dark mode toggle
- [ ] Multi-language / i18n support
- [ ] JWT-based authentication with RBAC

---

## 👨‍💻 Author

**WorkPulse HR** — Built by Prasath / KANZ team.

*Last updated: September 2026*

---

## 🧪 Prototype Limitations
* WorkPulse HR Final UI/UX Prototype QA — Complete
* Mock data only
* Mock GPS/geofence
* Mock face verification
* Mock tracking simulator
* No backend
* No database
* No WebSocket
