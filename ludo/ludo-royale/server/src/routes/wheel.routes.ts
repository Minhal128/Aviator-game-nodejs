/**
 * /api/v1/wheel — Lucky Wheel state + spin (§7.8, promoted to v1.0).
 * All routes requireAuth; the daily limit, weighted pick and prize
 * atomicity live in WheelService. /spin shares the claims rate bucket
 * (mounted in api.app.ts) like every other reward endpoint.
 */
import { Router } from 'express';
import { authedUserId, requireAuth } from '../middleware/auth.js';
import type { AuthService } from '../services/AuthService.js';
import type { WheelService } from '../services/WheelService.js';

export function createWheelRouter(auth: AuthService, wheel: WheelService): Router {
  const router = Router();
  router.use(requireAuth(auth));

  router.get('/', async (req, res) => {
    res.json(await wheel.getState(authedUserId(req)));
  });

  router.post('/spin', async (req, res) => {
    res.json(await wheel.spin(authedUserId(req)));
  });

  return router;
}
