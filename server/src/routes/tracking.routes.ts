import { Router } from 'express';
import { z } from 'zod';
import { geoService } from '../redis/geoService.js';
import { trackingBufferService } from '../services/trackingBufferService.js';
import { requireAuth, requireRole, type AuthenticatedRequest } from '../middleware/auth.js';

const router = Router();

const pingSchema = z.object({
  employeeId: z.string().min(1),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracy: z.number().optional(),
  speed: z.number().optional(),
  heading: z.number().optional(),
  batteryLevel: z.number().optional(),
  timestamp: z.string().optional(),
});

const nearbyQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  radiusMeters: z.coerce.number().default(500),
});

/**
 * POST /api/tracking/ping - Fast GPS ingest into Redis Geospatial index and persistence buffer
 */
router.post('/ping', requireAuth as any, async (req: AuthenticatedRequest, res, next) => {
  try {
    const parse = pingSchema.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({ error: 'Invalid location payload', details: parse.error.format() });
      return;
    }

    const { employeeId } = parse.data;
    const userRole = req.user?.role || 'employee';
    const userEmpId = req.user?.employee_id || req.user?.id;

    if (userRole !== 'admin' && userRole !== 'super_admin' && userEmpId !== employeeId) {
      res.status(403).json({
        status: 403,
        error: 'Forbidden',
        message: 'Cannot report GPS location for another employee',
      });
      return;
    }

    const payload = {
      ...parse.data,
      timestamp: parse.data.timestamp || new Date().toISOString(),
    };

    const queued = await trackingBufferService.ingestPing(payload);

    res.json({
      status: queued ? 'ok' : 'degraded',
      receivedAt: payload.timestamp,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/tracking/employee/:employeeId - Get employee's real-time position from Redis
 */
router.get('/employee/:employeeId', requireAuth as any, async (req: AuthenticatedRequest, res, next) => {
  try {
    const employeeId = String(req.params.employeeId);
    const userRole = req.user?.role || 'employee';
    const userEmpId = req.user?.employee_id || req.user?.id;

    // Only allow managers/admins or the employee themselves to view real-time location
    const isSelf = userEmpId === employeeId;
    const isPrivileged = ['admin', 'super_admin', 'manager'].includes(userRole);

    if (!isSelf && !isPrivileged) {
      res.status(403).json({
        status: 403,
        error: 'Forbidden',
        message: 'Cannot view live location of other employees',
      });
      return;
    }

    const location = await geoService.getEmployeeLocation(employeeId);

    if (!location) {
      res.status(404).json({ error: 'No live tracking data found for employee' });
      return;
    }

    res.json(location);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/tracking/nearby - Query employees within radius using Redis GEORADIUS
 */
router.get('/nearby', requireAuth as any, requireRole('admin', 'super_admin', 'manager') as any, async (req, res, next) => {
  try {
    const parse = nearbyQuerySchema.safeParse(req.query);
    if (!parse.success) {
      res.status(400).json({ error: 'Invalid coordinates', details: parse.error.format() });
      return;
    }

    const { lat, lng, radiusMeters } = parse.data;
    const nearby = await geoService.findEmployeesNearby(lat, lng, radiusMeters);

    res.json({
      center: { latitude: lat, longitude: lng },
      radiusMeters,
      count: nearby.length,
      employees: nearby,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/tracking/flush - Manually trigger flush of buffered GPS breadcrumbs to DB
 */
router.post('/flush', requireAuth as any, requireRole('admin', 'super_admin') as any, async (req, res, next) => {
  try {
    const count = await trackingBufferService.flushBreadcrumbs();
    res.json({
      status: 'ok',
      flushedCount: count,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
