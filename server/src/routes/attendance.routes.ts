import { Router } from 'express';
import { z } from 'zod';
import { createRateLimiter } from '../redis/rateLimiter.js';
import { lockService } from '../redis/lockService.js';
import { payrollCacheService } from '../services/payrollCacheService.js';
import { getSupabase } from '../services/supabase.js';

import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js';

const router = Router();

const punchSchema = z.object({
  employeeId: z.string().min(1),
  workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  timestamp: z.string().optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  punchType: z.enum(['check_in', 'check_out']),
});

// Strict rate limit: max 5 punch attempts per 60 seconds per employee
const punchRateLimiter = createRateLimiter({
  windowSeconds: 60,
  maxRequests: 5,
  keyPrefix: 'rl:punch:',
  keyGenerator: (req) => {
    return req.body?.employeeId || (req as any).user?.employee_id || req.ip || 'anonymous';
  },
  message: 'Punch rate limit exceeded. Please wait a minute before clocking again.',
});

/**
 * POST /api/attendance/punch - Process clock-in/clock-out protected by Distributed Mutex Lock & Rate Limiter
 */
router.post('/punch', requireAuth as any, punchRateLimiter, async (req: AuthenticatedRequest, res, next) => {
  try {
    const parse = punchSchema.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({ error: 'Validation error', details: parse.error.format() });
      return;
    }

    const { employeeId, workDate, punchType, latitude, longitude } = parse.data;

    // Authorization check: Employees may only clock in/out for themselves; Admins may clock on behalf
    const userRole = req.user?.role || 'employee';
    const userEmpId = req.user?.employee_id || req.user?.id;
    if (userRole !== 'admin' && userRole !== 'super_admin' && userEmpId !== employeeId) {
      res.status(403).json({
        status: 403,
        error: 'Forbidden',
        message: 'Cannot clock in/out on behalf of another employee',
      });
      return;
    }

    const nowIso = parse.data.timestamp || new Date().toISOString();

    // Acquire distributed lock for this employee's punch to avoid double-tapping race conditions
    const lockKey = `punch:${employeeId}:${workDate}`;
    const lockResult = await lockService.withLock(
      lockKey,
      async () => {
        const supabase = getSupabase();

        if (!supabase) {
          // Supabase mock fallback for testing
          return {
            mode: 'mock',
            employeeId,
            workDate,
            punchType,
            recordedAt: nowIso,
            status: 'recorded',
          };
        }

        // Database operation with Supabase
        if (punchType === 'check_in') {
          // Check if already checked in today
          const { data: existing } = await supabase
            .from('attendance')
            .select('id, clock_in')
            .eq('employee_id', employeeId)
            .eq('work_date', workDate)
            .maybeSingle();

          if (existing?.clock_in) {
            throw new Error(`Employee is already clocked in today at ${existing.clock_in}`);
          }

          const { data, error } = await supabase
            .from('attendance')
            .upsert({
              employee_id: employeeId,
              work_date: workDate,
              clock_in: nowIso,
              clock_in_latitude: latitude,
              clock_in_longitude: longitude,
              status: 'PRESENT',
            })
            .select()
            .single();

          if (error) throw error;
          return data;
        } else {
          // check_out
          const { data, error } = await supabase
            .from('attendance')
            .update({
              clock_out: nowIso,
              clock_out_latitude: latitude,
              clock_out_longitude: longitude,
            })
            .eq('employee_id', employeeId)
            .eq('work_date', workDate)
            .select()
            .single();

          if (error) throw error;
          return data;
        }
      },
      { ttlMs: 4000, retryAttempts: 2, retryDelayMs: 150 }
    );

    if (!lockResult.success) {
      res.status(409).json({
        error: 'Conflict',
        message: lockResult.error || 'Simultaneous punch in progress for this employee. Please wait.',
      });
      return;
    }

    // Invalidate payroll cache for this date so latest punches reflect immediately
    await payrollCacheService.invalidateDate(workDate);

    res.json({
      status: 'ok',
      punchType,
      data: lockResult.result,
    });
  } catch (err: any) {
    if (err.message?.includes('already clocked in')) {
      res.status(409).json({ error: err.message });
      return;
    }
    next(err);
  }
});

export default router;
