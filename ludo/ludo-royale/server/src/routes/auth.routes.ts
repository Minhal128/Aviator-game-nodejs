/**
 * /api/v1/auth — guest-first auth endpoints (ARQUITECTURA §8.1/§8.2).
 * register/login (account upgrade) land in Sprint 3b; guest/refresh/logout
 * are the Sprint 3a foundation the game client already needs.
 */
import { Router, type Request } from 'express';
import { z } from 'zod';
import type { AuthService } from '../services/AuthService.js';
import { authedUserId, requireAuth } from '../middleware/auth.js';

const guestSchema = z.object({
  /** Device UUID from the client (§7.1 lr_users.device_id). */
  deviceId: z.string().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/),
  /** Optional display name; falls back to Player_xxxxx when absent/invalid. */
  name: z.string().max(24).optional(),
});

const registerSchema = z.object({
  email: z.string().trim().email().max(190),
  password: z.string().min(8).max(72),
});

const loginSchema = registerSchema;

const refreshSchema = z.object({
  refresh: z.string().min(16).max(512),
});

function requestContext(req: Request): { ip?: string; deviceInfo?: string } {
  const ua = req.headers['user-agent'];
  return {
    ip: req.ip,
    deviceInfo: typeof ua === 'string' ? ua.slice(0, 190) : undefined,
  };
}

export function createAuthRouter(auth: AuthService): Router {
  const router = Router();

  router.post('/guest', async (req, res) => {
    const body = guestSchema.parse(req.body);
    const { user, tokens, created } = await auth.guestLogin(body, requestContext(req));
    res.status(created ? 201 : 200).json({ ...tokens, user, created });
  });

  router.post('/register', requireAuth(auth), async (req, res) => {
    const body = registerSchema.parse(req.body);
    const user = await auth.registerEmail(authedUserId(req), body.email, body.password);
    res.json({ user });
  });

  router.post('/login', async (req, res) => {
    const body = loginSchema.parse(req.body);
    const out = await auth.loginEmail(body.email, body.password, requestContext(req));
    res.json({ ...out.tokens, user: out.user });
  });

  router.post('/refresh', async (req, res) => {
    const body = refreshSchema.parse(req.body);
    const tokens = await auth.refresh(body.refresh, requestContext(req));
    res.json(tokens);
  });

  router.post('/logout', async (req, res) => {
    const body = refreshSchema.parse(req.body);
    await auth.logout(body.refresh);
    res.status(204).end();
  });

  return router;
}
