# 🟢 WorkPulse HR — Project Documentation

> A full-featured, premium Human Resource Management System (HRMS) built with **React 19**, **TypeScript**, **Vite**, and **React Router v7**.
>
> 🚀 **STATUS: PROTOTYPE COMPLETE**

WorkPulse HR is designed with a unique **"Command Center"** aesthetic. It moves away from generic dashboard templates and provides a highly-responsive, premium, dark-and-light-mode capable UI designed for enterprise monitoring and employee self-service.

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

## 🎨 Design & Architecture Highlights

- **WorkPulse Command Center UI:** A highly customized semantic design system (`var(--primary)`, `var(--bg-surface)`, etc.) ensuring a unified look.
- **Global Theme Support:** Flawless transition between **Dark Mode** (Deep Navy/Purple/Cyan) and **Light Mode** (Clean White/Slate/Primary).
- **Responsive Mastery:** Fully liquid layouts using CSS Grid, Flexbox wrapping, and `clamp()` typography to prevent horizontal overflow on mobile devices.
- **Micro-Animations:** Skeleton loaders, drawer slide-ins, and button hover states to make the interface feel alive.
- **High-Contrast Readability:** Strictly enforced WCAG-compliant contrast ratios across all medium text, dropdowns, and forms.

---

## 📁 Project Structure

```text
work_pluse/
├── index.html                        # Entry HTML
├── package.json
├── vite.config.ts
├── tsconfig.json
└── src/
    ├── main.tsx                      # React root mount
    ├── App.tsx                       # Route definitions
    ├── App.css                       # Global component & responsive styles
    ├── index.css                     # Semantic CSS variables & base tokens
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

### Route Structure
| Role     | Base Path     | Layout                  |
|----------|---------------|-------------------------|
| Admin/HR | `/admin/*`    | `AppLayout` (admin)     |
| Employee | `/employee/*` | `AppLayout` (employee)  |

---

## 🛡️ Admin / HR Pages (16 Modules)

### 1. 📊 Admin Dashboard (`/admin/dashboard`)
- KPI Cards: Total Employees, Present, WFH, On Leave, Late, Absent.
- Period filter: Today / This Week / This Month.
- Live Employee Status Table with interactive side-drawers for employee details.

### 2. 📍 Live Tracking (`/admin/live-tracking`)
- **Command Center Map:** A UI simulator for tracking active employees globally.
- Features simulated GPS location dots and real-time status updates for field employees.

### 3. 👥 Employees (`/admin/employees`)
- Employee list with search, filter by department/status.
- Employee cards with avatar, designation, department, and contact info.

### 4. 🏢 Departments & 🏬 Offices (`/admin/departments`, `/admin/offices`)
- Add / Edit / Delete departments and branch locations.
- Location-based Geofence settings (radiuses) for office boundaries.

### 5. ⏰ Shifts & 📅 Roster (`/admin/shifts`, `/admin/roster`)
- Manage shifts (Morning, General, Evening, Night) with grace periods and breaks.
- Interactive shift roster to assign employees by day/week.

### 6. 📋 Attendance (`/admin/attendance`)
- Daily attendance records for all employees.
- Filters by date, department, status. Manual check-in override.

### 7. 🏠 WFH, 🗓️ Leave, & 🕐 Permission
- Centralized approval systems for WFH requests, sick/casual leaves, and late permissions.
- Drawer-based UI to approve/reject with mandatory reasoning.

### 8. 💰 Payroll (`/admin/payroll`)
- Financial overview grid (Gross, Deductions, Net) utilizing responsive typography.
- Salary breakdown table for generating monthly slips.

### 9. ⚙️ Settings, 📈 Reports, & 📜 Audit Logs
- Fully responsive settings configurations (working hours, payroll cycles, geofence toggles).
- System-wide action logs tracking "who did what, when".

### 10. 📷 Face Registration (`/admin/face-registration`)
- Prototype biometric enrollment interface.
- Includes a live camera feed simulator with toggleable UI states (Lighting issues, no face, successful capture).

---

## 👤 Employee Self-Service Pages (7 Modules)

### 1. 📊 Employee Dashboard (`/employee/dashboard`)
- **Interactive Security Simulator:** Prototypes the Geofence and Face Verification steps required to punch in.
- Lets employees test overriding geolocation to observe system behavior.

### 2. 📋 My Attendance (`/employee/attendance`)
- Timeline view of daily punches, hours worked, and overtime tracking.

### 3. 🏠 WFH, 🗓️ Leave, & 🕐 Permissions
- Request forms to apply for remote work, time off, or late arrivals.
- Status tracking grids for pending vs approved requests.

### 4. 💰 Payroll & 🧾 Payslip (`/employee/payroll`, `/employee/payslip`)
- Monthly salary summary with printable, highly-formatted payslip views.

---

## 🔔 Notifications
- A shared `/notifications` route for both Admin and Employee portals.
- Read/Unread toggles and interactive notification cards.

---

## 💻 Getting Started

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build
```

The application is deployed as a static Single Page Application (SPA) utilizing Vite and React Router. Mock data and React State handle all data storage, making it instantly demoable without a backend infrastructure.
