/**
 * requireAuth — player JWT middleware (ARQUITECTURA §3 middleware/auth.ts).
 * Verifies the Bearer access token (HS256, aud 'player') and exposes
 * req.userId to downstream handlers. Admin auth (aud 'admin') is a separate
 * middleware in Sprint 3b.
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { AuthService } from '../services/AuthService.js';
import { API_ERR, ApiError } from '../services/errors.js';

declare module 'express-serve-static-core' {
  interface Request {
    /** Set by requireAuth after JWT verification. */
    userId?: number;
  }
}

export function requireAuth(auth: AuthService): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      next(new ApiError(401, API_ERR.INVALID_TOKEN, 'missing Bearer token'));
      return;
    }
    try {
      const { userId } = await auth.verifyAccess(header.slice('Bearer '.length).trim());
      req.userId = userId;
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** Read the userId set by requireAuth; throws if the route forgot the guard. */
export function authedUserId(req: Request): number {
  if (req.userId === undefined) {
    throw new ApiError(401, API_ERR.INVALID_TOKEN, 'route is missing requireAuth');
  }
  return req.userId;
}
