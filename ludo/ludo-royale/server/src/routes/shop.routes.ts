/**
 * /api/v1/shop — catalog + virtual-currency purchase (§8.1 /shop/purchase).
 * IAP purchases do NOT pass here (webhook route, §8.3 — Sprint 3c).
 */
import { Router } from 'express';
import { z } from 'zod';
import { authedUserId, requireAuth } from '../middleware/auth.js';
import type { AuthService } from '../services/AuthService.js';
import type { ShopService } from '../services/ShopService.js';

const purchaseSchema = z.object({
  sku: z.string().min(1).max(40),
});

export function createShopRouter(auth: AuthService, shop: ShopService): Router {
  const router = Router();
  router.use(requireAuth(auth));

  router.get('/', async (_req, res) => {
    res.json({ items: await shop.getCatalog() });
  });

  router.post('/purchase', async (req, res) => {
    const body = purchaseSchema.parse(req.body);
    res.json(await shop.buy(authedUserId(req), body.sku));
  });

  return router;
}
