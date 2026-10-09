/**
 * Employee notification rules: one set of types, message builders and duplicate keys.
 * Used by notificationService.notifyEmployee() from the existing services; no second
 * notification system. Pure functions (unit-tested).
 */
import { COMPANY_TIMEZONE } from '../../utils/companyDate';

export const NOTIFICATION_TYPES = [
  'ATTENDANCE', 'LEAVE', 'PERMISSION', 'WFH', 'OVERTIME', 'PAYROLL', 'PAYSLIP',
  'AUTOMATIC_BREAK', 'GEOFENCE', 'SHIFT', 'PROFILE', 'SECURITY', 'ANNOUNCEMENT',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export interface EmployeeNotification {
  notification_type: NotificationType;
  title: string;
  message: string;
  action_url: string | null;
  priority: 'LOW' | 'NORMAL' | 'HIGH';
  entity_type: string | null;
  entity_id: string | null;
  /** Same action → same key → only one notification (double click, tabs, retries). */
  dedupe_key: string;
}

// ---------- formatting ----------
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** '2026-10-10' → '10 Oct 2026' */
export function formatDay(date: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date || '');
  if (!m) return date || '';
  return `${m[3]} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}
/** '14:00:00' → '2:00 PM' */
export function formatClock(time: string | null | undefined): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(time || '');
  if (!m) return time || '';
  const h = Number(m[1]);
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
}
export const formatPeriod = (month: number, year: number) => `${MONTHS_LONG[(Number(month) - 1 + 12) % 12]} ${year}`;
const dateRange = (start: string, end?: string | null) => (!end || end === start ? formatDay(start) : `${formatDay(start)} to ${formatDay(end)}`);
const remarkText = (remarks?: string | null) => (remarks && remarks.trim() ? ` Remarks: ${remarks.trim()}` : '');
const statusWord = (s: string) => s.toLowerCase();
const Title = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

type ReviewStatus = 'APPROVED' | 'REJECTED' | 'CANCELLED';

// ---------- requests ----------
export function leaveReviewed(p: { id: string; status: ReviewStatus; startDate: string; endDate?: string | null; leaveType?: string | null; isHalfDay?: boolean; remarks?: string | null }): EmployeeNotification {
  const type = p.leaveType ? `${p.leaveType} ` : '';
  return {
    notification_type: 'LEAVE',
    title: `Leave ${Title(p.status)}`,
    message: `Your ${type}leave request for ${dateRange(p.startDate, p.endDate)}${p.isHalfDay ? ' (half day)' : ''} has been ${statusWord(p.status)}.${remarkText(p.remarks)}`,
    action_url: '/employee/leave', priority: p.status === 'APPROVED' ? 'NORMAL' : 'HIGH',
    entity_type: 'leave_requests', entity_id: p.id, dedupe_key: `leave:${p.id}:${p.status}`,
  };
}
export function wfhReviewed(p: { id: string; status: ReviewStatus; date: string; remarks?: string | null }): EmployeeNotification {
  return {
    notification_type: 'WFH',
    title: `WFH ${Title(p.status)}`,
    message: `Your WFH request for ${formatDay(p.date)} has been ${statusWord(p.status)}.${remarkText(p.remarks)}`,
    action_url: '/employee/wfh', priority: p.status === 'APPROVED' ? 'NORMAL' : 'HIGH',
    entity_type: 'wfh_requests', entity_id: p.id, dedupe_key: `wfh:${p.id}:${p.status}`,
  };
}
export function permissionReviewed(p: { id: string; status: ReviewStatus; date: string; start?: string | null; end?: string | null; remarks?: string | null }): EmployeeNotification {
  const window = p.start && p.end ? ` from ${formatClock(p.start)} to ${formatClock(p.end)}` : '';
  return {
    notification_type: 'PERMISSION',
    title: `Permission ${Title(p.status)}`,
    message: `Your permission request for ${formatDay(p.date)}${window} has been ${statusWord(p.status)}.${remarkText(p.remarks)}`,
    action_url: '/employee/permission', priority: p.status === 'APPROVED' ? 'NORMAL' : 'HIGH',
    entity_type: 'permission_requests', entity_id: p.id, dedupe_key: `permission:${p.id}:${p.status}`,
  };
}

// ---------- payroll ----------
export function payrollStatusChanged(p: { id: string; status: string; month: number; year: number }): EmployeeNotification | null {
  const period = formatPeriod(p.month, p.year);
  const text: Record<string, [string, string]> = {
    APPROVED: ['Payroll Approved', `Your payroll for ${period} has been approved.`],
    CLOSED: ['Payroll Finalized', `Your payroll for ${period} has been finalized.`],
  };
  const t = text[p.status];
  if (!t) return null; // internal steps (DRAFT, CALCULATED, UNDER_REVIEW, PAYMENT_PENDING) are not announced
  return {
    notification_type: 'PAYROLL', title: t[0], message: t[1], action_url: '/employee/payroll', priority: 'NORMAL',
    entity_type: 'payroll', entity_id: p.id, dedupe_key: `payroll:${p.id}:${p.status}`,
  };
}
export function salaryPaid(p: { id: string; month: number; year: number }): EmployeeNotification {
  return {
    notification_type: 'PAYROLL', title: 'Salary Paid',
    message: `Your salary for ${formatPeriod(p.month, p.year)} has been paid.`,
    action_url: '/employee/payroll', priority: 'NORMAL',
    entity_type: 'payroll', entity_id: p.id, dedupe_key: `payroll:${p.id}:PAID`,
  };
}
export function payslipAvailable(p: { payrollId: string; month: number; year: number }): EmployeeNotification {
  return {
    notification_type: 'PAYSLIP', title: 'Payslip Available',
    message: `Your ${formatPeriod(p.month, p.year)} payslip is now available.`,
    action_url: '/employee/payslip', priority: 'NORMAL',
    entity_type: 'payroll', entity_id: p.payrollId, dedupe_key: `payslip:${p.payrollId}`,
  };
}

// ---------- automatic break / geofence (employee's own) ----------
export function autoBreakStarted(p: { breakId: string }): EmployeeNotification {
  return {
    notification_type: 'AUTOMATIC_BREAK', title: 'Automatic Break Started',
    message: 'You have left the office geofence. Your working timer is paused.',
    action_url: '/employee/dashboard', priority: 'NORMAL',
    entity_type: 'attendance_breaks', entity_id: p.breakId, dedupe_key: `break:${p.breakId}:START`,
  };
}
export function autoBreakEnded(p: { breakId: string; minutes?: number | null }): EmployeeNotification {
  const d = typeof p.minutes === 'number' ? ` Break duration: ${p.minutes} min.` : '';
  return {
    notification_type: 'AUTOMATIC_BREAK', title: 'Automatic Break Ended',
    message: `You have returned to the office. Your working timer has resumed.${d}`,
    action_url: '/employee/dashboard', priority: 'NORMAL',
    entity_type: 'attendance_breaks', entity_id: p.breakId, dedupe_key: `break:${p.breakId}:END`,
  };
}
export function autoBreakClosedAtClockOut(p: { breakId: string; attendanceId: string }): EmployeeNotification {
  return {
    notification_type: 'AUTOMATIC_BREAK', title: 'Attendance Closed',
    message: 'Your active automatic break was closed when you clocked out.',
    action_url: '/employee/attendance', priority: 'NORMAL',
    entity_type: 'attendance_breaks', entity_id: p.breakId, dedupe_key: `break:${p.breakId}:CLOCK_OUT`,
  };
}
/** Only for confirmed transitions that did NOT already produce a break notification. */
export function geofenceTransition(p: { eventId: string; to: 'INSIDE' | 'OUTSIDE' }): EmployeeNotification {
  return p.to === 'OUTSIDE'
    ? { notification_type: 'GEOFENCE', title: 'Left Office Geofence', message: 'You have left the office geofence. Automatic break may start.', action_url: '/employee/dashboard', priority: 'NORMAL', entity_type: 'geofence_events', entity_id: p.eventId, dedupe_key: `geofence:${p.eventId}` }
    : { notification_type: 'GEOFENCE', title: 'Returned to Office', message: 'You have returned to the office geofence.', action_url: '/employee/dashboard', priority: 'NORMAL', entity_type: 'geofence_events', entity_id: p.eventId, dedupe_key: `geofence:${p.eventId}` };
}

// ---------- shift / profile / security ----------
export function shiftAssigned(p: { assignmentId: string; shiftId: string; shiftName: string; start?: string | null; end?: string | null; effectiveDate: string }): EmployeeNotification {
  const timing = p.start && p.end ? ` (${formatClock(p.start)} – ${formatClock(p.end)})` : '';
  return {
    notification_type: 'SHIFT', title: 'Shift Updated',
    message: `Your shift has been updated to ${p.shiftName}${timing} from ${formatDay(p.effectiveDate)}.`,
    action_url: '/employee/attendance', priority: 'NORMAL',
    entity_type: 'shift_assignments', entity_id: p.assignmentId, dedupe_key: `shift:${p.assignmentId}:${p.shiftId}`,
  };
}
export function shiftTimingChanged(p: { shiftId: string; shiftName: string; start: string; end: string }): EmployeeNotification {
  return {
    notification_type: 'SHIFT', title: 'Shift Timing Changed',
    message: `${p.shiftName} timing has been updated to ${formatClock(p.start)} – ${formatClock(p.end)}.`,
    action_url: '/employee/attendance', priority: 'HIGH',
    entity_type: 'shift_templates', entity_id: p.shiftId, dedupe_key: `shift-timing:${p.shiftId}:${p.start}-${p.end}`,
  };
}
export type ProfileField = 'department' | 'office' | 'role' | 'designation';
const FIELD_LABEL: Record<ProfileField, string> = { department: 'department', office: 'office assignment', role: 'role', designation: 'designation' };
export function profileChanged(p: { employeeId: string; field: ProfileField; newValue: string; newId: string | null }): EmployeeNotification {
  return {
    notification_type: p.field === 'role' ? 'SECURITY' : 'PROFILE',
    title: p.field === 'role' ? 'Account Role Updated' : `${FIELD_LABEL[p.field].charAt(0).toUpperCase()}${FIELD_LABEL[p.field].slice(1)} Updated`,
    message: `Your ${FIELD_LABEL[p.field]} has been updated to ${p.newValue}.`,
    action_url: '/employee/profile', priority: p.field === 'role' ? 'HIGH' : 'NORMAL',
    entity_type: 'employees', entity_id: p.employeeId, dedupe_key: `profile:${p.employeeId}:${p.field}:${p.newId ?? p.newValue}`,
  };
}
/** Fields an admin edit can change that matter to the employee: only real changes notify. */
export function changedProfileFields(before: Record<string, any> | null, after: Record<string, any>): ProfileField[] {
  if (!before) return [];
  const map: [ProfileField, string][] = [['department', 'department_id'], ['office', 'office_id'], ['role', 'role_id'], ['designation', 'designation']];
  return map.filter(([, col]) => col in after && (after[col] ?? null) !== (before[col] ?? null)).map(([f]) => f);
}
export function passwordChanged(p: { employeeId: string; atIso: string }): EmployeeNotification {
  return {
    notification_type: 'SECURITY', title: 'Password Changed',
    message: 'Your account password was changed. If this was not you, contact your administrator immediately.',
    action_url: '/employee/profile', priority: 'HIGH',
    entity_type: 'employees', entity_id: p.employeeId, dedupe_key: `password:${p.employeeId}:${p.atIso.slice(0, 16)}`,
  };
}

// ---------- employee UI ----------
const CATEGORY: Record<string, string> = {
  ATTENDANCE: 'Attendance', AUTOMATIC_BREAK: 'Attendance', GEOFENCE: 'Attendance', LEAVE: 'Leave', PERMISSION: 'Permission', WFH: 'WFH',
  OVERTIME: 'Attendance', PAYROLL: 'Payroll', PAYSLIP: 'Payroll', SHIFT: 'Shift', PROFILE: 'Profile', SECURITY: 'Security', ANNOUNCEMENT: 'Announcement',
};
const PRIORITY: Record<string, string> = { URGENT: 'Critical', HIGH: 'High', NORMAL: 'Normal', LOW: 'Normal' };

export interface NotificationRowLike {
  id: string; notification_type: string; title: string; message: string; priority?: string | null;
  is_read: boolean; read_at?: string | null; action_url?: string | null; created_at: string;
}

/** Database row → item shown in the Notifications page (Today / This Week / Earlier in IST). */
export function toNotificationItem(row: NotificationRowLike, nowMs: number, timeZone = COMPANY_TIMEZONE) {
  const created = new Date(row.created_at);
  const dayKey = (ms: number) => new Date(ms).toLocaleDateString('en-CA', { timeZone });
  const diffDays = Math.round((Date.parse(dayKey(nowMs)) - Date.parse(dayKey(created.getTime()))) / 86_400_000);
  const category = CATEGORY[row.notification_type] ?? 'General';
  return {
    id: row.id,
    raw: row,
    title: row.title,
    message: row.message,
    type: row.notification_type,
    category,
    priority: PRIORITY[(row.priority || 'NORMAL').toUpperCase()] ?? 'Normal',
    read: !!row.is_read,
    date: diffDays <= 0 ? 'Today' : diffDays < 7 ? 'This Week' : 'Earlier',
    time: created.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone }),
    fullDate: created.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric', timeZone }),
    actionRoute: row.action_url || '#',
    relatedModule: category,
  };
}

/** Merge fetched/realtime rows: one entry per id (realtime + refetch after reconnect never duplicate), newest first. */
export function mergeNotificationRows<T extends { id: string; created_at: string }>(current: T[], incoming: T[]): T[] {
  const byId = new Map<string, T>();
  for (const r of current) byId.set(r.id, r);
  for (const r of incoming) byId.set(r.id, { ...(byId.get(r.id) || {}), ...r });
  return [...byId.values()].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
}
export const unreadCount = (rows: { is_read: boolean }[]) => rows.filter(r => !r.is_read).length;

// ---------- overtime (Requested OT ≠ Approved OT: the message states the APPROVED hours) ----------
const hoursText = (h: number) => `${Number(h)} ${Number(h) === 1 ? 'hour' : 'hours'}`;
export function overtimeReviewed(p: { id: string; status: 'APPROVED' | 'REJECTED'; workDate: string; approvedHours?: number | null; requestedHours?: number | null; remarks?: string | null }): EmployeeNotification {
  const approved = p.status === 'APPROVED';
  const partly = approved && p.requestedHours != null && p.approvedHours != null && Number(p.approvedHours) < Number(p.requestedHours)
    ? ` (requested ${hoursText(p.requestedHours)})` : '';
  return {
    notification_type: 'OVERTIME',
    title: approved ? 'Overtime Approved' : 'Overtime Rejected',
    message: approved
      ? `Your overtime request for ${formatDay(p.workDate)} has been approved for ${hoursText(Number(p.approvedHours))}${partly}.${remarkText(p.remarks)}`
      : `Your overtime request for ${formatDay(p.workDate)} has been rejected.${remarkText(p.remarks)}`,
    action_url: '/employee/overtime', priority: approved ? 'NORMAL' : 'HIGH',
    entity_type: 'overtime_requests', entity_id: p.id, dedupe_key: `overtime:${p.id}:${p.status}`,
  };
}
