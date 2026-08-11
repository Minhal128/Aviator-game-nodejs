/**
 * /api/v1/daily-bonus — calendar state + claim + double-with-ad (§8.1).
 * All routes requireAuth; dedupe/atomicity live in DailyBonusService.
 */
import { Router } from 'express';
import { z } from 'zod';
import { authedUserId, requireAuth } from '../middleware/auth.js';
import type { AuthService } from '../services/AuthService.js';
import type { DailyBonusService } from '../services/DailyBonusService.js';

const doubleSchema = z.object({
  /** v1 trust flag — replaced by AdMob SSV in Sprint 3c (see service note). */
  adCompleted: z.boolean(),
});

export function createDailyBonusRouter(auth: AuthService, dailyBonus: DailyBonusService): Router {
  const router = Router();
  router.use(requireAuth(auth));

  router.get('/', async (req, res) => {
    res.json(await dailyBonus.getState(authedUserId(req)));
  });

  router.post('/claim', async (req, res) => {
    res.json(await dailyBonus.claim(authedUserId(req)));
  });

  router.post('/claim-double', async (req, res) => {
    const body = doubleSchema.parse(req.body);
    res.json(await dailyBonus.claimDouble(authedUserId(req), body));
  });

  return router;
}
