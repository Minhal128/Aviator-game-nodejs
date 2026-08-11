/**
 * /api/v1/profile — authenticated profile read (§8.1): user + wallet +
 * xp/level (with the next-level threshold for the progress bar).
 * PATCH profile and the public-profile endpoint arrive in Sprint 3b.
 */
import { Router } from 'express';
import { authedUserId, requireAuth } from '../middleware/auth.js';
import type { AuthService } from '../services/AuthService.js';
import type { XpService } from '../services/XpService.js';

export function createProfileRouter(auth: AuthService, xp: XpService): Router {
  const router = Router();

  router.get('/', requireAuth(auth), async (req, res) => {
    const userId = authedUserId(req);
    const user = await auth.publicUser(userId);
    const nextLevelAt = await xp.nextLevelAt(user.level);
    res.json({
      user,
      wallet: { coins: user.coins, gems: user.gems },
      xp: { current: user.xp, level: user.level, nextLevelAt },
    });
  });

  return router;
}
