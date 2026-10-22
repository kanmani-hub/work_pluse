import { Router } from 'express';
import { z } from 'zod';
import { cacheService } from '../redis/cacheService.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

const invalidateSchema = z.object({
  pattern: z.string().min(1),
});

// Protect all cache management endpoints: admin / super_admin only
router.use(requireAuth, requireRole('admin', 'super_admin'));

/**
 * GET /api/cache/stats - Retrieve Redis cache hit/miss statistics and memory info
 */
router.get('/stats', async (req, res, next) => {
  try {
    const stats = await cacheService.getStats();
    res.json({
      status: 'ok',
      stats,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/cache/invalidate - Invalidate keys matching a pattern
 */
router.post('/invalidate', async (req, res, next) => {
  try {
    const parse = invalidateSchema.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({ error: 'Missing or invalid pattern parameter' });
      return;
    }

    const deletedCount = await cacheService.delByPattern(parse.data.pattern);
    res.json({
      status: 'ok',
      pattern: parse.data.pattern,
      deletedKeysCount: deletedCount,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/cache/flush - Invalidate all application cache keys
 */
router.post('/flush', async (req, res, next) => {
  try {
    const deletedCount = await cacheService.flushPrefix();
    cacheService.resetCounters();
    res.json({
      status: 'ok',
      message: 'All application cache keys flushed',
      deletedKeysCount: deletedCount,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
