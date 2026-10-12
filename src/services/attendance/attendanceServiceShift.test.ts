import { describe, it, expect, vi, beforeEach } from 'vitest';
import { attendanceService } from './attendanceService';
import { supabase } from '../../lib/supabase';

vi.mock('../../lib/supabase', () => {
  return {
    supabase: {
      auth: {
        getUser: vi.fn(),
      },
      from: vi.fn(),
    },
  };
});

vi.mock('../audit/auditService', () => ({
  auditService: {
    recordAuditLog: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock('../notifications/notificationService', () => ({
  notificationService: {
    notifyEmployee: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock('../settings/globalSettingsService', () => ({
  globalSettingsService: {
    loadSettings: vi.fn().mockResolvedValue({
      app: { gracePeriodMins: 15, timezone: 'Asia/Kolkata' },
    }),
  },
}));

describe('attendanceService - Shift Resolution & Dashboard Flow', () => {
  const hemanthEmpId = 'emp-016';
  const otherEmpId = 'emp-099';
  const authUserId = 'auth-hemanth-uuid';

  const morningShift = {
    id: 'st-morning',
    name: 'Morning Shift',
    start_time: '06:00:00',
    end_time: '14:00:00',
    required_hours: 8,
    grace_period_minutes: 10,
  };

  const generalShift = {
    id: 'st-general',
    name: 'General Shift',
    start_time: '09:00:00',
    end_time: '18:00:00',
    required_hours: 8,
    grace_period_minutes: 15,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getShiftForDate', () => {
    it('returns published roster assignment for Monday 12th', async () => {
      const fromMock = vi.fn().mockImplementation((table: string) => {
        if (table === 'roster_assignments') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({
                  data: [
                    {
                      id: 'ra-12',
                      employee_id: hemanthEmpId,
                      assignment_date: '2026-10-12',
                      day_type: 'WORK',
                      work_mode: 'OFFICE',
                      shift_template_id: 'st-morning',
                      shift_templates: morningShift,
                      rosters: { id: 'ros-1', status: 'PUBLISHED', start_date: '2026-10-12', end_date: '2026-10-18' },
                    },
                  ],
                  error: null,
                }),
              }),
            }),
          };
        }
        return {};
      });
      (supabase.from as any) = fromMock;

      const res = await attendanceService.getShiftForDate(hemanthEmpId, '2026-10-12');

      expect(res.error).toBeNull();
      expect(res.source).toBe('ROSTER');
      expect(res.isWeekOff).toBe(false);
      expect(res.rosterAssignmentId).toBe('ra-12');
      expect(res.data).toEqual({
        ...morningShift,
        work_mode: 'OFFICE',
        roster_assignment_id: 'ra-12',
      });
    });

    it('returns published roster assignment for Tuesday 13th with WFH work mode', async () => {
      const fromMock = vi.fn().mockImplementation((table: string) => {
        if (table === 'roster_assignments') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({
                  data: [
                    {
                      id: 'ra-13',
                      employee_id: hemanthEmpId,
                      assignment_date: '2026-10-13',
                      day_type: 'WORK',
                      work_mode: 'WFH',
                      shift_template_id: 'st-general',
                      shift_templates: generalShift,
                      rosters: { id: 'ros-1', status: 'PUBLISHED', start_date: '2026-10-12', end_date: '2026-10-18' },
                    },
                  ],
                  error: null,
                }),
              }),
            }),
          };
        }
        return {};
      });
      (supabase.from as any) = fromMock;

      const res = await attendanceService.getShiftForDate(hemanthEmpId, '2026-10-13');

      expect(res.error).toBeNull();
      expect(res.source).toBe('ROSTER');
      expect(res.isWeekOff).toBe(false);
      expect(res.rosterAssignmentId).toBe('ra-13');
      expect(res.data?.work_mode).toBe('WFH');
      expect(res.data?.id).toBe('st-general');
    });

    it('returns isWeekOff: true when published roster marks the day as WEEK_OFF', async () => {
      const fromMock = vi.fn().mockImplementation((table: string) => {
        if (table === 'roster_assignments') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({
                  data: [
                    {
                      id: 'ra-sun',
                      employee_id: hemanthEmpId,
                      assignment_date: '2026-10-18',
                      day_type: 'WEEK_OFF',
                      work_mode: 'OFFICE',
                      shift_template_id: null,
                      shift_templates: null,
                      rosters: { id: 'ros-1', status: 'PUBLISHED' },
                    },
                  ],
                  error: null,
                }),
              }),
            }),
          };
        }
        return {};
      });
      (supabase.from as any) = fromMock;

      const res = await attendanceService.getShiftForDate(hemanthEmpId, '2026-10-18');

      expect(res.error).toBeNull();
      expect(res.isWeekOff).toBe(true);
      expect(res.data).toBeNull();
      expect(res.source).toBe('ROSTER');
      expect(res.rosterAssignmentId).toBe('ra-sun');
    });

    it('ignores DRAFT roster and falls back to permanent shift assignment', async () => {
      const fromMock = vi.fn().mockImplementation((table: string) => {
        if (table === 'roster_assignments') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({
                  data: [
                    {
                      id: 'ra-draft',
                      employee_id: hemanthEmpId,
                      assignment_date: '2026-10-12',
                      day_type: 'WORK',
                      shift_templates: morningShift,
                      rosters: { id: 'ros-draft', status: 'DRAFT' },
                    },
                  ],
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === 'shift_assignments') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                lte: vi.fn().mockReturnValue({
                  or: vi.fn().mockReturnValue({
                    order: vi.fn().mockReturnValue({
                      limit: vi.fn().mockReturnValue({
                        maybeSingle: vi.fn().mockResolvedValue({
                          data: {
                            id: 'sa-perm',
                            employee_id: hemanthEmpId,
                            effective_date: '2026-09-01',
                            end_date: null,
                            shift_template_id: 'st-general',
                            shift_templates: generalShift,
                          },
                          error: null,
                        }),
                      }),
                    }),
                  }),
                }),
              }),
            }),
          };
        }
        return {};
      });
      (supabase.from as any) = fromMock;

      const res = await attendanceService.getShiftForDate(hemanthEmpId, '2026-10-12');

      expect(res.error).toBeNull();
      expect(res.source).toBe('PERMANENT');
      expect(res.data?.id).toBe('st-general');
      expect(res.isWeekOff).toBe(false);
    });

    it('returns source: NONE and data: null when no published roster or permanent shift exists', async () => {
      const fromMock = vi.fn().mockImplementation((table: string) => {
        if (table === 'roster_assignments') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({ data: [], error: null }),
              }),
            }),
          };
        }
        if (table === 'shift_assignments') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                lte: vi.fn().mockReturnValue({
                  or: vi.fn().mockReturnValue({
                    order: vi.fn().mockReturnValue({
                      limit: vi.fn().mockReturnValue({
                        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                      }),
                    }),
                  }),
                }),
              }),
            }),
          };
        }
        return {};
      });
      (supabase.from as any) = fromMock;

      const res = await attendanceService.getShiftForDate(hemanthEmpId, '2026-10-12');

      expect(res.error).toBeNull();
      expect(res.source).toBe('NONE');
      expect(res.data).toBeNull();
      expect(res.isWeekOff).toBe(false);
    });

    it('gracefully returns error when roster query fails', async () => {
      const fromMock = vi.fn().mockImplementation((table: string) => {
        if (table === 'roster_assignments') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({ data: null, error: { message: 'Database connection error' } }),
              }),
            }),
          };
        }
        return {};
      });
      (supabase.from as any) = fromMock;

      const res = await attendanceService.getShiftForDate(hemanthEmpId, '2026-10-12');

      expect(res.error).toBeInstanceOf(Error);
      expect(res.error?.message).toContain('Roster assignment query failed');
      expect(res.data).toBeNull();
    });
  });

  describe('getCurrentShift', () => {
    it('returns unauthorized when no session is present', async () => {
      (supabase.auth.getUser as any) = vi.fn().mockResolvedValue({ data: { user: null }, error: null });

      const res = await attendanceService.getCurrentShift('2026-10-12');
      expect(res.error?.message).toBe('Unauthorized');
      expect(res.data).toBeNull();
    });

    it('resolves shift for logged-in employee', async () => {
      (supabase.auth.getUser as any) = vi.fn().mockResolvedValue({
        data: { user: { id: authUserId } },
        error: null,
      });

      const fromMock = vi.fn().mockImplementation((table: string) => {
        if (table === 'profiles') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { employee_id: hemanthEmpId },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === 'roster_assignments') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({
                  data: [
                    {
                      id: 'ra-12',
                      employee_id: hemanthEmpId,
                      assignment_date: '2026-10-12',
                      day_type: 'WORK',
                      work_mode: 'OFFICE',
                      shift_template_id: 'st-morning',
                      shift_templates: morningShift,
                      rosters: { id: 'ros-1', status: 'PUBLISHED' },
                    },
                  ],
                  error: null,
                }),
              }),
            }),
          };
        }
        return {};
      });
      (supabase.from as any) = fromMock;

      const res = await attendanceService.getCurrentShift('2026-10-12');

      expect(res.error).toBeNull();
      expect(res.data?.id).toBe('st-morning');
      expect(res.data?.name).toBe('Morning Shift');
      expect(res.isWeekOff).toBe(false);
    });
  });

  describe('clockIn with Roster Shift Integration', () => {
    it('blocks clock-in when today is scheduled as a Week Off in published roster', async () => {
      (supabase.auth.getUser as any) = vi.fn().mockResolvedValue({
        data: { user: { id: authUserId } },
        error: null,
      });

      const fromMock = vi.fn().mockImplementation((table: string) => {
        if (table === 'profiles') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: { employee_id: hemanthEmpId }, error: null }),
              }),
            }),
          };
        }
        if (table === 'attendance') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                in: vi.fn().mockResolvedValue({ data: [], error: null }),
              }),
            }),
          };
        }
        if (table === 'roster_assignments') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({
                  data: [
                    {
                      id: 'ra-off',
                      employee_id: hemanthEmpId,
                      assignment_date: '2026-10-12',
                      day_type: 'WEEK_OFF',
                      shift_templates: null,
                      rosters: { status: 'PUBLISHED' },
                    },
                  ],
                  error: null,
                }),
              }),
            }),
          };
        }
        return {};
      });
      (supabase.from as any) = fromMock;

      const res = await attendanceService.clockIn({ localDateStr: '2026-10-12' });

      expect(res.error).toBeInstanceOf(Error);
      expect(res.error?.message).toContain('Today is scheduled as a Week Off');
      expect(res.data).toBeNull();
    });

    it('attaches shift_template_id and roster_assignment_id to attendance on successful clock-in', async () => {
      (supabase.auth.getUser as any) = vi.fn().mockResolvedValue({
        data: { user: { id: authUserId } },
        error: null,
      });

      let insertedAttendance: any = null;

      const fromMock = vi.fn().mockImplementation((table: string) => {
        if (table === 'profiles') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: { employee_id: hemanthEmpId }, error: null }),
              }),
            }),
          };
        }
        if (table === 'attendance') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                in: vi.fn().mockResolvedValue({ data: [], error: null }),
              }),
            }),
            insert: vi.fn().mockImplementation((payload: any) => {
              insertedAttendance = payload;
              return {
                select: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: { id: 'att-123', ...payload },
                    error: null,
                  }),
                }),
              };
            }),
          };
        }
        if (table === 'roster_assignments') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({
                  data: [
                    {
                      id: 'ra-12',
                      employee_id: hemanthEmpId,
                      assignment_date: '2026-10-12',
                      day_type: 'WORK',
                      work_mode: 'OFFICE',
                      shift_template_id: 'st-morning',
                      shift_templates: morningShift,
                      rosters: { status: 'PUBLISHED' },
                    },
                  ],
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === 'attendance_events') {
          return {
            insert: vi.fn().mockResolvedValue({ data: null, error: null }),
          };
        }
        return {
          insert: vi.fn().mockResolvedValue({ data: null, error: null }),
        };
      });
      (supabase.from as any) = fromMock;

      const res = await attendanceService.clockIn({ localDateStr: '2026-10-12' });

      expect(res.error).toBeNull();
      expect(insertedAttendance).toBeTruthy();
      expect(insertedAttendance.employee_id).toBe(hemanthEmpId);
      expect(insertedAttendance.shift_template_id).toBe('st-morning');
      expect(insertedAttendance.roster_assignment_id).toBe('ra-12');
    });
  });
});
