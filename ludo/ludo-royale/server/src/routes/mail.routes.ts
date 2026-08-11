/**
 * /api/v1/mail — inbox (lazy broadcast materialization), mark-read and
 * attachment claim (§8.1). Delete/archive lands with the admin composer
 * sprint (3c).
 */
import { Router } from 'express';
import { z } from 'zod';
import { authedUserId, requireAuth } from '../middleware/auth.js';
import type { AuthService } from '../services/AuthService.js';
import type { MailService } from '../services/MailService.js';

const idParam = z.object({ id: z.coerce.number().int().positive() });
const pageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  beforeId: z.coerce.number().int().positive().optional(),
});

export function createMailRouter(auth: AuthService, mail: MailService): Router {
  const router = Router();
  router.use(requireAuth(auth));

  router.get('/', async (req, res) => {
    const query = pageQuery.parse(req.query);
    res.json(await mail.getInbox(authedUserId(req), query));
  });

  router.post('/:id/read', async (req, res) => {
    const { id } = idParam.parse(req.params);
    await mail.markRead(authedUserId(req), id);
    res.status(204).end();
  });

  router.post('/:id/claim', async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.json(await mail.claimAttachment(authedUserId(req), id));
  });

  return router;
}
