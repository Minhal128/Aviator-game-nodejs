/**
 * Central error handler. ApiError → its status + stable code (client maps
 * codes to i18n); zod issues → 400 ERR_VALIDATION with field details;
 * anything else → 500 with NO internals leaked (§9), logged server-side.
 */
import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { log } from '../logger.js';
import { API_ERR, ApiError } from '../services/errors.js';

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof ApiError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: API_ERR.VALIDATION,
        message: 'invalid request body',
        details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
    });
    return;
  }
  // body-parser JSON syntax errors carry a status; treat as client fault.
  const status = (err as { status?: number }).status;
  if (typeof status === 'number' && status >= 400 && status < 500) {
    res.status(status).json({ error: { code: API_ERR.VALIDATION, message: 'malformed request' } });
    return;
  }
  log.error('unhandled api error', {
    path: req.path,
    message: err instanceof Error ? err.message : String(err),
  });
  res.status(500).json({ error: { code: API_ERR.INTERNAL, message: 'internal error' } });
};
