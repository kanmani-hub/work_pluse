import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { allowedOrigins, env } from './config/env.js';
import { errorHandler } from './middleware/errorHandler.js';
import { authenticate } from './middleware/auth.js';

import healthRoutes from './routes/health.routes.js';
import cacheRoutes from './routes/cache.routes.js';
import payrollRoutes from './routes/payroll.routes.js';
import attendanceRoutes from './routes/attendance.routes.js';
import trackingRoutes from './routes/tracking.routes.js';

export function createApp(): Express {
  const app = express();

  // Security headers
  app.use(helmet());

  // CORS configuration
  app.use(
    cors({
      origin: (origin, callback) => {
        // Allow requests with no origin (e.g. mobile apps, curl, docker healthcheck)
        if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
          return callback(null, true);
        }
        return callback(null, true); // Dev-friendly permissive fallback
      },
      credentials: true,
    })
  );

  // Request logger
  if (env.NODE_ENV !== 'test') {
    app.use(morgan('short'));
  }

  // Body parsing
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Optional authentication context
  app.use(authenticate as any);

  // Mount API routes
  app.use('/api/health', healthRoutes);
  app.use('/api/cache', cacheRoutes);
  app.use('/api/payroll', payrollRoutes);
  app.use('/api/attendance', attendanceRoutes);
  app.use('/api/tracking', trackingRoutes);

  // Root welcome / info
  app.get('/', (req, res) => {
    res.json({
      service: 'WorkPulse Node.js + Redis Microservice',
      version: '1.0.0',
      status: 'active',
      docs: '/api/health',
      timestamp: new Date().toISOString(),
    });
  });

  // 404 catch-all
  app.use((req, res) => {
    res.status(404).json({
      error: 'Not Found',
      message: `Cannot ${req.method} ${req.originalUrl}`,
    });
  });

  // Central error handling
  app.use(errorHandler);

  return app;
}
