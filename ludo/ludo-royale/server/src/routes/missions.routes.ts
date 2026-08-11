/**
 * /api/v1/missions — daily missions + claim (§8.1). Progress is pushed by
 * the game server (MatchService → MissionService), never by the client.
 */
import { Router } from 'express';
import { z } from 'zod';
import { authedUserId, requireAuth } from '../middleware/auth.js';
import type { AuthService } from '../services/AuthService.js';
import type { MissionService } from '../services/MissionService.js';

const idParam = z.object({ id: z.coerce.number().int().positive() });

export function createMissionsRouter(auth: AuthService, missions: MissionService): Router {
  const router = Router();
  router.use(requireAuth(auth));

  router.get('/', async (req, res) => {
    res.json({ missions: await missions.getMissions(authedUserId(req)) });
  });

  router.post('/:id/claim', async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.json(await missions.claim(authedUserId(req), id));
  });

  return router;
}
