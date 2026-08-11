/**
 * /api/v1/friends — list + requests by referral code + daily coin gift
 * (§7.7). All routes requireAuth; /gift shares the claims rate bucket
 * (mounted in api.app.ts) like every other reward endpoint.
 */
import { Router } from 'express';
import { z } from 'zod';
import { authedUserId, requireAuth } from '../middleware/auth.js';
import type { AuthService } from '../services/AuthService.js';
import type { FriendsService } from '../services/FriendsService.js';

const requestSchema = z.object({ code: z.string().trim().min(4).max(16) });
const respondSchema = z.object({
  requestId: z.number().int().positive(),
  accept: z.boolean(),
});
const removeSchema = z.object({ friendId: z.number().int().positive() });
const giftSchema = z.object({ friendId: z.number().int().positive().optional() });

export function createFriendsRouter(auth: AuthService, friends: FriendsService): Router {
  const router = Router();
  router.use(requireAuth(auth));

  router.get('/', async (req, res) => {
    res.json(await friends.overview(authedUserId(req)));
  });

  router.post('/request', async (req, res) => {
    const body = requestSchema.parse(req.body);
    res.json(await friends.request(authedUserId(req), body.code));
  });

  router.post('/respond', async (req, res) => {
    const body = respondSchema.parse(req.body);
    res.json(await friends.respond(authedUserId(req), body.requestId, body.accept));
  });

  router.post('/remove', async (req, res) => {
    const body = removeSchema.parse(req.body);
    res.json(await friends.remove(authedUserId(req), body.friendId));
  });

  router.post('/gift', async (req, res) => {
    const body = giftSchema.parse(req.body ?? {});
    res.json(await friends.gift(authedUserId(req), body.friendId));
  });

  return router;
}
