import { Router } from 'express';
import { z } from 'zod';
import { createRateLimiter } from '../redis/rateLimiter.js';

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
  // Keyed by the verified caller, never by a value from the request body (which could be rotated to
  // dodge the limit, or used to exhaust another employee's limit).
  keyGenerator: (req) => {
    return (req as any).user?.employee_id || (req as any).user?.id || req.ip || 'anonymous';
  },
  message: 'Punch rate limit exceeded. Please wait a minute before clocking again.',
});

/**
 * POST /api/attendance/punch - Process clock-in/clock-out protected by Distributed Mutex Lock & Rate Limiter
 */
/**
 * POST /api/attendance/punch
 *
 * Security fix MS-2 / MS-3: this endpoint used to write attendance with the service-role key, with
 * column and table names that do not exist (work_date, clock_in, clock_out, ...), with a client-supplied
 * timestamp, and without the database's clock-out / automatic-break safeguards
 * (close_auto_break_for_clock_out, the attendance guards that trust service_role). It also reported
 * "recorded" in mock mode without saving anything.
 *
 * Clock-in / clock-out require the WorkPulse app flow (shift resolution, geofence / face verification,
 * automatic-break closing) that is not implemented in this service. Until it is, the endpoint validates
 * the request and the caller, then answers 501 and writes nothing.
 */
router.post('/punch', requireAuth as any, punchRateLimiter, async (req: AuthenticatedRequest, res, next) => {
  try {
    const parse = punchSchema.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({ error: 'Validation error', details: parse.error.format() });
      return;
    }

    const { employeeId } = parse.data;
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

    res.status(501).json({
      status: 501,
      error: 'Not Implemented',
      message: 'Clock-in and clock-out are recorded through the WorkPulse app. Nothing was saved.',
    });
  } catch (err) {
    next(err);
  }
});

export default router;
