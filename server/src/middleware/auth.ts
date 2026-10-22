import type { Request, Response, NextFunction } from 'express';
import { getSupabase } from '../services/supabase.js';
import { env } from '../config/env.js';

export interface AuthenticatedUser {
  id: string;
  email?: string;
  employee_id?: string;
  role: string;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}

export async function authenticate(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next();
  }

  const token = authHeader.split(' ')[1];
  if (!token) {
    return next();
  }

  // Development & test bypass for isolated local test runners
  if (env.NODE_ENV === 'test' || env.NODE_ENV === 'development') {
    if (token === 'dev-admin-token') {
      req.user = { id: 'dev-admin', role: 'admin', employee_id: 'EMP-ADMIN' };
      return next();
    }
    if (token === 'dev-employee-token') {
      req.user = { id: 'dev-emp', role: 'employee', employee_id: 'EMP-001' };
      return next();
    }
  }

  const supabase = getSupabase();
  if (!supabase) {
    // If Supabase is not configured, do not grant admin access to arbitrary tokens
    console.warn('[AuthMiddleware] Supabase not configured: cannot verify bearer token');
    return next();
  }

  try {
    const { data, error } = await supabase.auth.getUser(token);
    if (!error && data?.user) {
      req.user = {
        id: data.user.id,
        email: data.user.email,
        role: data.user.app_metadata?.role || data.user.user_metadata?.role || 'employee',
        employee_id: data.user.user_metadata?.employee_id || data.user.id,
      };
    }
    next();
  } catch (err: any) {
    console.warn('[AuthMiddleware] Token verification failed:', err.message);
    next();
  }
}

/**
 * Authentication guard middleware: Requires a valid authenticated user
 */
export function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  if (!req.user) {
    res.status(401).json({
      status: 401,
      error: 'Unauthorized',
      message: 'Authentication token is required to access this endpoint',
    });
    return;
  }
  next();
}

/**
 * Role-based authorization guard middleware
 */
export function requireRole(...allowedRoles: string[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        status: 401,
        error: 'Unauthorized',
        message: 'Authentication token is required',
      });
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({
        status: 403,
        error: 'Forbidden',
        message: `Access denied. Requires one of the following roles: [${allowedRoles.join(', ')}]`,
      });
      return;
    }

    next();
  };
}
