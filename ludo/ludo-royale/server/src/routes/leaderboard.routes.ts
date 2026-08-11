/**
 * /api/v1/leaderboard — top-N + my rank (§8.1). v1.0 scope is global; the
 * country scope ships with country capture in profiles (v1.1).
 */
import { Router } from 'express';
import { z } from 'zod';
import { authedUserId, requireAuth } from '../middleware/auth.js';
import type { AuthService } from '../services/AuthService.js';
import type { LeaderboardService } from '../services/LeaderboardService.js';

const querySchema = z.object({
  period: z.enum(['weekly', 'alltime']).default('weekly'),
  limit: z.coerce.number().int().min(1).max(100).default(100),
});

export function createLeaderboardRouter(auth: AuthService, leaderboard: LeaderboardService): Router {
  const router = Router();
  router.use(requireAuth(auth));

  router.get('/', async (req, res) => {
    const query = querySchema.parse(req.query);
    res.json(await leaderboard.getView(query.period, authedUserId(req), query.limit));
  });

  return router;
}
