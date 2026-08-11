/**
 * Rate-limit buckets (ARQUITECTURA §8.6). express-rate-limit with the
 * in-memory store — single-node default; SCALE_MODE=redis swaps the store in
 * a later sprint. All limits are constructor-tunable so tests can shrink
 * windows without env backdoors.
 */
import { rateLimit, type RateLimitRequestHandler } from 'express-rate-limit';
import { createHash } from 'node:crypto';
import { API_ERR } from '../services/errors.js';

export interface RateLimitConfig {
  /** POST /auth/guest — per IP (§8.6: 10/h). */
  guestPerHour: number;
  /** POST /auth/refresh — per session token, IP fallback (§8.6: 30/h). */
  refreshPerHour: number;
  /** Global /api umbrella per IP (§8.6: 300/min). */
  globalPerMinute: number;
  /**
   * Purchase/claim endpoints — per IP (§8.6: 30/min). The REAL dedupes are
   * the UNIQUE origin rows; this only blunts hammering.
   */
  claimsPerMinute: number;
}

export const DEFAULT_RATE_LIMITS: RateLimitConfig = {
  guestPerHour: 10,
  refreshPerHour: 30,
  globalPerMinute: 300,
  claimsPerMinute: 30,
};

const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

const errBody = { error: { code: API_ERR.RATE_LIMIT, message: 'too many requests' } };

export interface RateLimiters {
  guest: RateLimitRequestHandler;
  refresh: RateLimitRequestHandler;
  global: RateLimitRequestHandler;
  claims: RateLimitRequestHandler;
}

export function buildRateLimiters(config: Partial<RateLimitConfig> = {}): RateLimiters {
  const cfg = { ...DEFAULT_RATE_LIMITS, ...config };
  const common = {
    standardHeaders: true as const,
    legacyHeaders: false,
    message: errBody,
  };
  return {
    guest: rateLimit({ ...common, windowMs: HOUR_MS, limit: cfg.guestPerHour }),
    refresh: rateLimit({
      ...common,
      windowMs: HOUR_MS,
      limit: cfg.refreshPerHour,
      // The custom key generator intentionally falls back to req.ip; skip the
      // library's ip-key validations (they assume IP-only keys).
      validate: false,
      // Key by the presented refresh token (hashed — never store raw tokens),
      // so one hammering session cannot exhaust a shared NAT IP.
      keyGenerator: (req) => {
        const token = (req.body as { refresh?: unknown } | undefined)?.refresh;
        if (typeof token === 'string' && token.length > 0) {
          return createHash('sha256').update(token).digest('hex').slice(0, 32);
        }
        return req.ip ?? 'unknown';
      },
    }),
    global: rateLimit({ ...common, windowMs: MINUTE_MS, limit: cfg.globalPerMinute }),
    claims: rateLimit({ ...common, windowMs: MINUTE_MS, limit: cfg.claimsPerMinute }),
  };
}
