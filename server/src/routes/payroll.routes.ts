import { Router } from 'express';
import { z } from 'zod';
import { payrollCacheService } from '../services/payrollCacheService.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

// Protect payroll reports & invalidations: authorized HR / Admin only
router.use(requireAuth, requireRole('admin', 'super_admin', 'hr'));

const dailyReportQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
  departmentId: z.string().optional(),
  officeId: z.string().optional(),
});

const invalidateSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format').optional(),
  all: z.boolean().optional(),
});

/**
 * GET /api/payroll/daily-report - Cached daily deduction and impact calculation
 */
router.get('/daily-report', async (req, res, next) => {
  try {
    const parse = dailyReportQuerySchema.safeParse(req.query);
    if (!parse.success) {
      res.status(400).json({ error: 'Invalid query parameters', details: parse.error.format() });
      return;
    }

    const report = await payrollCacheService.getDailyDeductionReport({
      date: parse.data.date,
      departmentId: parse.data.departmentId,
      officeId: parse.data.officeId,
    });

    res.json(report);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/payroll/invalidate - Invalidate cached payroll data
 */
router.post('/invalidate', async (req, res, next) => {
  try {
    const parse = invalidateSchema.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({ error: 'Invalid parameters', details: parse.error.format() });
      return;
    }

    let count = 0;
    if (parse.data.all) {
      count = await payrollCacheService.invalidateAll();
    } else if (parse.data.date) {
      count = await payrollCacheService.invalidateDate(parse.data.date);
    } else {
      res.status(400).json({ error: 'Must provide either date or all=true' });
      return;
    }

    res.json({
      status: 'ok',
      invalidatedKeysCount: count,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
